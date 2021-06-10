import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';
import { ConfigService } from '@nestjs/config';

import { Contract, ethers, EventFilter } from 'ethers';
import { Result } from 'ethers/lib/utils';

import abiClAggregatorProxy from './res/EACAggregatorProxy.ABI.json';
import abiClAggregator from './res/AccessControlledOffchainAggregator.ABI.json';
import {
  configEthers,
  EEthersNetwork,
  EContractCastReason,
  ProviderNetwork,
  ETopics,
  ConversionConfig,
  convertContractInputValue,
  ValueType,
  ValueTypeDate,
  EResultFieldLatestRoundData,
  createTopicsDefault,
  getKafkaNativeInfo,
  getConfigKafka,
  RelaydKClient,
  RelaydKGroup,
  OracleData,
} from '@relayd/common';
import { EFeedSourceNetwork, FeedConfigSource, EFeedSourceType } from '@relayd/common';

import { Client } from '@nestjs/microservices/decorators/client.decorator';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { KafkaStreams } from 'kafka-streams';

import { PreconditionFailedException } from '@nestjs/common/exceptions/precondition-failed.exception';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { HttpStatus } from '@nestjs/common';
import { isDate, isDateString, isEthereumAddress, isMilitaryTime, isPositive, validate } from 'class-validator';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;

  @Client(getConfigKafka(RelaydKClient.ETH, RelaydKGroup.ETH))
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  constructor(private configService: ConfigService) { }

  async init(): Promise<void> {
    this.initProvider();
    this.logProviderConnection();

    const topics = [ETopics.CONTRACT, ETopics.CONTRACT_DATA, ETopics.ERROR];
    topics.forEach((pattern) => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    getKafkaNativeInfo(this.logger);

    await createTopicsDefault(this.clientKafka, this.logger);

    // this.streamFactory = new KafkaStreams(configKafkaNative);
    // this.initStreams();
  }

  async shutdown(signal: string) {
    this.logger.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"
    if (this.provider) this.provider.removeAllListeners();
    if (this.streamFactory) await this.streamFactory.closeAll();
    if (this.clientKafka)
      await this.clientKafka
        .close()
        .then(() => {
          this.logger.debug('ETH kClient closed');
        })
        .catch((error) => {
          throw new Error('Unexpected closure of ETH kClient\n' + error);
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
        throw new Error('Failed to connect to the ETH network\n' + error);
      });
  }

  logProviderConnection() {
    this.loadNetworkProviderInfo().then((info: ProviderNetwork) => {
      this.logger.log(
        "Connected to ETH via provider '" + info.type + "' to network '" + info.name + "' ID=" + info.chainId,
      );
    });
  }

  /**
   * Check if the contract ETH network matches with the one this ETH client is connecting to
   * @param contractNetwork
   * @returns
   */
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

  /**
   * Internal utility. Count the number of issues that happened in a recent (latest) serie
   * @param contractSource
   * @param issueType
   * @returns
   */
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

  /**
   * Cast a record about a contract config
   * @param feedConfigId
   * @param contractSource
   * @param reason
   */
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
              "Failed to cast Contract config '" + contractSource.contract + "' for '" + feedConfigId + "'\n" + error,
            );
          });
      })
      .catch((error: Error) => {
        throw new Error('Failed kafka client connection.\n' + error);
      });
  }

  /**
   * Process a source contract, depending on its config status
   * @param contractConfig target source contract config to be handled
   * @returns Updated source contract config to reflect any state changes
   */
  async handleSourceContract(contractConfig: FeedConfigSource): Promise<FeedConfigSource> {
    this.logger.debug(
      "Handling contract '" + contractConfig.contract + "' with status '" + contractConfig.status + "'",
    );
    switch (contractConfig.status) {
      case HttpStatus.PROCESSING:
        return this.validateSourceContract(contractConfig)
          .then((result: OracleData) => {
            return validate(result)
              .then((validationError) => {
                if (validationError && validationError.length > 0) {
                  contractConfig.status = HttpStatus.PARTIAL_CONTENT;
                  this.logger.warn("Contract '" + contractConfig.contract +
                    "' (" + contractConfig.type + ") is partially Valid. Status: " + contractConfig.status
                    + '\n' + JSON.stringify(validationError));
                } else {
                  contractConfig.status = HttpStatus.OK;
                  contractConfig.data = {
                    decimals: result.decimals,
                    value: result.value,
                    time: result.time
                  }
                  this.logger.log("Contract '" + contractConfig.contract + "' (" + contractConfig.type +
                    ") is Valid. Status: " + contractConfig.status);
                }
                return contractConfig;
              })
              .catch((error) => {throw new Error('Failed to validate output of \'' + contractConfig.contract + '\' validation\n'+error)});
          })
          .catch((error) => {
            contractConfig.status = HttpStatus.METHOD_NOT_ALLOWED;
            this.logger.warn('Validation failed for Source Contract ' + contractConfig.contract +
              '. Status: ' + contractConfig.status + '\n' + error,
            );
            return contractConfig;
          });
        break;
      case HttpStatus.OK:
        this.logger.warn('TODO Activate the contract polling, if not already done');
        break;
      case HttpStatus.NOT_FOUND:
      case HttpStatus.METHOD_NOT_ALLOWED:
      case HttpStatus.PARTIAL_CONTENT:
      default:
        throw new Error("Status '" + contractConfig.status + "' of Source contract '" +
          contractConfig.contract + "' is not supported",
        );
    }
    return contractConfig;
  }

  /**
   * Check the validity of a source contract, depending on its type
   */
  async validateSourceContract(contractConfig: FeedConfigSource): Promise<OracleData> {
    const address = contractConfig.contract;
    if (address == undefined || !isEthereumAddress(address)) throw new Error('Contract address is invalid: ' + address);

    const contractType = contractConfig.type;
    this.logger.debug("Validating contract '" + address + "' of type '" + contractType + "' with status '" + contractConfig.status);

    const pendingCheck: Promise<OracleData>[] = [];

    if (contractType == EFeedSourceType.CL_AGGR || contractType == EFeedSourceType.CL_AGGR_PROX) {
      const contract: Contract = this.initContractClAggregator(address);

      const contractDecimals: number = await this.loadContractDecimals(contract);

      const convertOpts: ConversionConfig = {
        decimals: contractDecimals,
        commify: false,
        date: ValueTypeDate.default,
      };

      if (contractType == EFeedSourceType.CL_AGGR_PROX) {
        const checkAggregatorProxy = this.loadClProxyContractAggregator(contract)
          .then((contractAggr: Contract) => {
            return this.loadContractLatestRoundData(contractAggr, convertOpts, true)
              .then((result: OracleData) => {
                return result;
              })
              .catch((error) => {
                throw new Error("Failed to fetch latestRoundData for ClAggregator '" + contractAggr.address +
                  "' of '" + address + "' (" + contractType + ')\n' + error);
              });
            // TODO check that events are available/emitted
          })
          .catch((error) => {
            throw new Error(
              "Failed to validate Aggregator of contract '" + address + "' (" + contractType + ')\n' + error,
            );
          });
        pendingCheck.push(checkAggregatorProxy);
      }

      const checkAggregator = this.loadContractLatestRoundData(contract, convertOpts, true)
        .then((result: OracleData) => {
          return result;
        })
        .catch((error) => {
          throw new Error('Failed to validate latestRoundData for ' + address + ' (' + contractType + ')\n' + error);
        });
      pendingCheck.push(checkAggregator);
    } else {
      throw new Error('Unsupported type of contract: ' + contractType);
    }

    return Promise.all(pendingCheck)
      .then((validResult: OracleData[]) => {
        const aggrRes: OracleData = {value: -1, time: ''};
        validResult.forEach((result) => {
          Object.assign(result, aggrRes);
        });
        this.logger.debug('Aggregated oracle data result: '+JSON.stringify(aggrRes));
        return aggrRes;
      })
      .catch((error) => {
        throw new Error('Failed to validate source contract\n' + JSON.stringify(contractConfig) + '\n' + error);
      });
  }

  /**
   * Load a contract decimals' value
   * @param contract target contract defining a decimals
   * @returns decimals value
   */
  async loadContractDecimals(contract: Contract): Promise<number> {
    return contract.functions
      .decimals()
      .then((result) => {
        this.logger.debug('Decimals for ' + contract.address + ': ' + result);
        return result;
      })
      .catch((error) => {
        throw new Error('Failed to fetch decimals for ' + contract.address + '\n' + error);
      });
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
  initContractClAggregator(
    addrOrName: string,
    type?: EFeedSourceType,
    provider?: ethers.providers.Provider,
  ): Contract {
    const abiContract = type == null || type == EFeedSourceType.CL_AGGR_PROX ? abiClAggregatorProxy : abiClAggregator;
    return new Contract(addrOrName, abiContract, provider || this.provider);
  }

  /**
   * Load the aggregator controller contract of a Chainlink EACAggregator Proxy contract
   * @param contract Chainlink EACAggregatorProxy contract (defining an 'aggregator')
   * @returns Chainlink AccessControlledOffchainAggregator contract
   */
  async loadClProxyContractAggregator(contract: Contract): Promise<Contract> {
    this.logger.debug("Fetching Aggregator contract of '" + contract.address + "'");
    return contract.functions
      .aggregator()
      .then((aggrAddrRaw) => {
        const aggrAddr: string = '' + aggrAddrRaw;
        if (!isEthereumAddress(aggrAddr)) {
          throw new Error('Invalid ClAggregator address: ' + aggrAddr);
        }
        return this.initContractClAggregator(aggrAddr, EFeedSourceType.CL_AGGR);
      })
      .catch((error) => {
        throw new Error("Failed to fetch Aggregator contract of '" + contract.address + "'\n" + error);
      });
  }

  /**
   * Load the latestRoundData of a Chainlink Aggregator contract
   * @param contract Chainlink EACAggregatorProxy or AccessControlledOffchainAggregator contract (defining 'latestRoundData')
   * @param convertOpts Convert or not the extracted values (default: false)
   * @param validate Validate or not the extracted values (default: false)
   * @returns contract latestRoundData data set
   */
  async loadContractLatestRoundData(
    contract: Contract,
    convertOpts?: ConversionConfig,
    validate?: boolean,
  ): Promise<OracleData> {
    this.logger.debug("Fetching latestRoundData of '" + contract.address + "'");
    return contract.functions
      .latestRoundData()
      .then((result: Result) => {
        const lastValueRaw = result[EResultFieldLatestRoundData.VALUE];
        const lastValue: number = convertContractInputValue(lastValueRaw, ValueType.PRICE, convertOpts);

        const lastValueTimeRaw = result[EResultFieldLatestRoundData.UPDATE_TIME];
        const lastValueTime: string = convertContractInputValue(lastValueTimeRaw, ValueType.DATE, convertOpts);

        this.logger.debug('Value retrieved from ' + contract.address + ": '" +
          lastValue + ' / ' + lastValueRaw + "' ("+typeof lastValue+") updated at " + lastValueTime + ' / ' + lastValueTimeRaw+ ' ('+typeof lastValueTime+')');
        
        if (validate && !isPositive(lastValue)) {
          throw new Error("Invalid value for field '" + EResultFieldLatestRoundData.VALUE +
            "' from contract '" + contract.address + "' latestRoundData: " + lastValue + ' / ' + lastValueRaw,
          );
        }
        if (validate && !(isDateString(lastValueTime) || isDate(lastValueTime))) {
          throw new Error('Invalid value for field \'' + EResultFieldLatestRoundData.UPDATE_TIME +
            '\' from contract \'' + contract.address + '\' latestRoundData: ' + lastValueTime + ' / ' + lastValueTimeRaw,
          );
        }
        return {
          value: lastValue,
          time: lastValueTime,
          decimals: convertOpts.decimals,
        };
      })
      .catch((error) => {
        throw new Error('Failed to fetch latestRoundData for ' + contract.address + ' \n' + error);
      });
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
