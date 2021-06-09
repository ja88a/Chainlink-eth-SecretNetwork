import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';
import { ConfigService } from '@nestjs/config';

import { Contract, ethers, EventFilter } from 'ethers';
import { Result } from 'ethers/lib/utils';

import abiClAggregatorProxy from './res/EACAggregatorProxy.ABI.json';
import abiClAggregator from './res/AccessControlledOffchainAggregator.ABI.json';
import {
  configEthers,
  configKafka,
  EEthersNetwork,
  EContractCastReason,
  ProviderNetwork,
  ETopics,
} from '@relayd/common';
import { EFeedSourceNetwork, FeedConfigSource, EFeedSourceType, EResultFieldLatestRoundData } from '@relayd/common';

import { Client } from '@nestjs/microservices/decorators/client.decorator';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { KafkaStreams } from 'kafka-streams';

import { PreconditionFailedException } from '@nestjs/common/exceptions/precondition-failed.exception';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { HttpStatus } from '@nestjs/common';
import { isEthereumAddress, isPositive } from 'class-validator';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;

  @Client(configKafka)
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  constructor(private configService: ConfigService) {}

  async init(): Promise<void> {
    this.initProvider();
    this.logProviderConnection();
  }

  async shutdown(signal: string) {
    console.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"
    if (this.provider) this.provider.removeAllListeners();
    if (this.streamFactory) await this.streamFactory.closeAll();
    if (this.clientKafka)
      await this.clientKafka
        .close()
        .then(() => {
          this.logger.debug('ETH kClient closed');
        })
        .catch((error) => {
          throw new Error('Unexpected closure of ETH kClient\nError: ' + error);
        });
  }

  initProvider(): void {
    const providerType = this.configService.get<string>(configEthers.PROVIDER_TYPE);
    let provider = null;
    try {
      if (providerType === 'local') {
        provider = new ethers.providers.WebSocketProvider(
          this.configService.get<string>(configEthers.CUST_PROVIDER_URL),
        );
      } else {
        const networkId = this.configService.get<string>(configEthers.PROVIDER_NETWORK_ID);
        provider = ethers.getDefaultProvider(networkId, {
          etherscan: this.configService.get<string>(configEthers.ETHERSCAN_API_KEY),
          infura: {
            projectId: this.configService.get<string>(configEthers.INFURA_PROJECT_ID),
            projectSecret: this.configService.get<string>(configEthers.INFURA_PROJECT_SECRET),
          },
        });
      }
    } catch (error) {
      throw new PreconditionFailedException(error, 'Failed to establish a connection to ETH network');
    }
    this.provider = provider;
  }

  async loadNetworkProviderInfo(provider?: ethers.providers.Provider): Promise<ProviderNetwork> {
    const networkCon: Promise<ethers.providers.Network> = (provider || this.provider).getNetwork();
    return networkCon
      .then((net) => {
        //this.logger.debug('Provider network info: ' + JSON.stringify(net));
        return {
          name: net.name,
          chainId: net.chainId,
          type: this.configService.get<string>(configEthers.PROVIDER_TYPE),
        };
      })
      .catch((error) => {
        throw new Error('Failed to connect to the ETH network\nError: ' + error);
      });
  }

  logProviderConnection() {
    this.loadNetworkProviderInfo().then((info: ProviderNetwork) => {
      this.logger.log(
        "Connected to ETH via provider '" + info.type + "' to network '" + info.name + "' ID=" + info.chainId,
      );
    });
  }

  async checkNetworkMatch(contractNetwork: string): Promise<boolean> {
    const clientNetwork = (await this.loadNetworkProviderInfo()).name;
    let isCompatible: boolean;
    switch (contractNetwork) {
      case EFeedSourceNetwork.ETH_MAIN:
        isCompatible = clientNetwork == EEthersNetwork.ETH_MAIN;
        break;
      case EFeedSourceNetwork.ETH_TEST_KOVAN:
        isCompatible = clientNetwork == EEthersNetwork.ETH_TEST_KOVAN;
        break;
      case EFeedSourceNetwork.ETH_TEST_RINKEBY:
        isCompatible = clientNetwork == EEthersNetwork.ETH_TEST_RINKEBY;
        break;
      default:
        isCompatible = false;
        break;
    }
    return isCompatible;
  }

  countIssueRecentSerie(contractSource: FeedConfigSource, issueType: string) {
    let countIssue = 0;
    if (contractSource.issue) {
      contractSource.issue.forEach((issue) => {
        if (issue.value == issueType) countIssue++;
        else return;
      });
    }
    return countIssue;
  }

  /** Cast a record about a contract config */
  async castContractConfig(feedConfigId: string, contractSource: FeedConfigSource, reason?: EContractCastReason) {
    if (contractSource.issue == null) contractSource.issue = [];
    contractSource.issue.push({ source: 'EthConnect-' + (await this.loadNetworkProviderInfo()).name, value: reason });
    this.clientKafka
      .connect()
      .then((producer) => {
        producer
          .send({
            topic: ETopics.CONTRACT,
            messages: [
              {
                key: feedConfigId,
                value: JSON.stringify(contractSource), // TODO Review Serialization format
              },
            ],
          })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Contract record metadata: ' + JSON.stringify(element));
            });
          })
          .catch((error) => {
            throw new Error(
              "Failed to cast Contract config '" +
                contractSource.contract +
                "' for '" +
                feedConfigId +
                "'.\nError: " +
                error,
            );
          });
      })
      .catch((error: Error) => {
        throw new Error('Failed kafka client connection.\nError: ' + error);
      });
  }

  /**  */
  async handleSourceContract(contractConfig: FeedConfigSource): Promise<FeedConfigSource> {
    this.logger.debug(
      "Handling contract '" + contractConfig.contract + "' with status '" + contractConfig.status + "'",
    );
    switch (contractConfig.status) {
      case HttpStatus.NOT_FOUND:
        return this.validateContract(contractConfig).catch((error) => {
          this.logger.warn(
            'Validation failed for source contract ' + JSON.stringify(contractConfig) + '\nError: ' + error,
          );
          contractConfig.status = HttpStatus.METHOD_NOT_ALLOWED;
          return contractConfig;
        });
        break;
      case HttpStatus.OK:
        break;
      default:
        break;
    }
    return contractConfig;
  }

  /**
   * Check validity of a contract
   */
  async validateContract(contractConfig: FeedConfigSource): Promise<FeedConfigSource> {
    const address = contractConfig.contract;
    if (address == undefined || !isEthereumAddress(address)) throw new Error('Contract address is invalid: ' + address);

    const type = contractConfig.type;
    this.logger.debug(
      "Validating contract '" + address + "' of type '" + type + "' with status '" + contractConfig.status,
    );

    let lastValue = -1;
    let lastValueTime = -1;
    if (type == EFeedSourceType.CL_AGGR || type == EFeedSourceType.CL_AGGR_PROX) {
      const contract: Contract = this.initContractChainlinkAggregator(address);
      if (type == EFeedSourceType.CL_AGGR_PROX) {
        await contract.functions
          .aggregator()
          .then((aggrAddr) => {
            if (!isEthereumAddress(aggrAddr)) {
              throw new Error('Invalid Aggregator address: ' + aggrAddr);
            }
            const contractAggr: Contract = this.initContractChainlinkAggregator(aggrAddr, EFeedSourceType.CL_AGGR);
            contractAggr.functions
              .latestRoundData()
              .then((result: Result) => {
                const value: number = result[EResultFieldLatestRoundData.VALUE];
                this.logger.debug('Value retireved from ' + aggrAddr + ': ' + value);
                if (!isPositive(value)) {
                  throw new Error('Invalid value found retrieved from Aggregator ' + aggrAddr + ': ' + value);
                }
                return result;
              })
              .catch((error) => {
                throw new Error(
                  'Failed to fetch latestRoundData for ' +
                    EFeedSourceType.CL_AGGR +
                    ' ' +
                    aggrAddr +
                    '\nError: ' +
                    error,
                );
              });
          })
          .catch((error) => {
            throw new Error('Failed to fetch latestRoundData of ' + type + ' ' + address + '\nError: ' + error);
          });
      }
      return contract.functions
        .latestRoundData()
        .then((result: Result) => {
          lastValue = result[EResultFieldLatestRoundData.VALUE];
          lastValueTime = result[EResultFieldLatestRoundData.UPDATE_TIME];
          this.logger.debug('Value retrieved from ' + address + ": '" + lastValue + "' updated at " + lastValueTime);
          if (!isPositive(lastValue)) {
            throw new Error(
              'Invalid value for ' +
                EResultFieldLatestRoundData.VALUE +
                " of ClAggregator '" +
                address +
                "': " +
                lastValue,
            );
          }
          if (!isPositive(lastValueTime)) {
            throw new Error(
              'Invalid value for ' +
                EResultFieldLatestRoundData.UPDATE_TIME +
                ' of ClAggregator ' +
                address +
                ': ' +
                lastValueTime,
            );
          }
          // Stamping
          contractConfig.status = HttpStatus.OK;
          contractConfig.data = {
            value: lastValueTime,
            time: lastValueTime,
          };

          this.logger.log("Contract '" + address + "' of type '" + type + "' valid. Status: '" + contractConfig.status);
          return contractConfig;
        })
        .catch((error) => {
          throw new Error('Failed to fetch latestRoundData for ' + address + ' (' + type + ')\nError: ' + error);
        });
    } else {
      throw new Error('Unsupported type of contract: ' + type);
    }
  }

  /** instances of the ETH oracle contracts */
  private sourceContracts: Map<string, Contract>;

  getSourceContracts(): Map<string, Contract> {
    return this.sourceContracts;
  }

  /**
   * Instantiate a Chainlink EAC Aggregator Proxy or an Access Controlled Offchain Aggregator contract, bound to ETH
   * @param addrOrName the contract ETH address or its ENS name
   * @param type Optional specification of the contract type to associate its ABI. Default is 'EFeedSourceType.CL_AGGR_PROX'
   * @param provider Optional web3 provider for ETH
   * @returns ETH contract instance ready to connect onchain
   */
  initContractChainlinkAggregator(
    addrOrName: string,
    type?: EFeedSourceType,
    provider?: ethers.providers.Provider,
  ): Contract {
    const abiContract = type == null || type == EFeedSourceType.CL_AGGR_PROX ? abiClAggregatorProxy : abiClAggregator;
    return new Contract(addrOrName, abiContract, provider || this.provider);
  }

  //  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  async queryContractLatestRoundData(
    key: string,
    contract: Contract,
    resultCollector?: Map<string, Result>,
  ): Promise<Result> {
    return contract.functions
      .latestRoundData()
      .then((result: Result) => {
        resultCollector?.set(key, result);
        //this.logger.debug('latestRoundData for ' + key + ': ' + result);
        return result;
      })
      .catch((error) => {
        this.logger.error('Failed to fetch latestRoundData for ' + key + '\n' + error, error);
        return null;
      });
  }

  /**
   * Listen to Events emitted by a contract
   */
  listenToEvent(contract: Contract, eventFilter: EventFilter): void {
    contract.on(eventFilter, (result: any) => {
      this.logger.warn('HEARD something! ' + result);
    });

    try {
      const filter2: EventFilter = contract.filters.AnswerUpdated();
      this.logger.debug(
        'Initialized filter2: ' + filter2 + ' Address=' + filter2.address + ' Topic: ' + filter2.topics,
      );
      contract.on(filter2, (current, roundId, updatedAt) => {
        this.logger.warn('Found an AnswerUpdated!!!! current=' + current + ' round=' + roundId + ' at=' + updatedAt);
      });
    } catch (error) {
      this.logger.error('Failed to listen on filter AnswerUpdated!\n' + error, error);
    }
  }

  // Listen to Event 'AnswerUpdated'
  // Topic0: 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f
  listenEventOracleAnswerUpdated(contractOracle: Contract): void {
    const eventId = ethers.utils.id('AnswerUpdated(int256,uint256,uint256)');
    const eventFilterAnswerUpd: EventFilter = {
      //address: contractOracle.address,
      topics: [eventId],
    };
    this.listenToEvent(contractOracle, eventFilterAnswerUpd);
  }
}
