import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { NotFoundException } from '@nestjs/common/exceptions/not-found.exception';
import { Logger } from '@nestjs/common/services/logger.service';
import { ConfigService } from '@nestjs/config';
import { Contract, ethers, Event, EventFilter, Signer, Wallet } from 'ethers';
import { Result } from 'ethers/lib/utils';
import oracleContractAbi from './res/contract-abi-btcusd.json';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;

  constructor(private configService: ConfigService) {}

  initProvider(): void {
    const providerType = this.configService.get<string>('ETH_PROVIDER_TYPE');
    let provider = null;
    if (providerType === 'local') {
      provider = new ethers.providers.WebSocketProvider(this.configService.get<string>('ETH_PROVIDER_LOCAL_URL'));
    } else {
      const networkId = this.configService.get<string>('ETH_PROVIDER_NETWORK_ID');
      provider = ethers.getDefaultProvider(networkId, {
        etherscan: this.configService.get<string>('ETHERSCAN_API_KEY'),
        infura: {
          projectId: this.configService.get<string>('INFURA_PROJECT_ID'),
          projectSecret: this.configService.get<string>('INFURA_PROJECT_SECRET'),
        },
      });
    }
    this.provider = provider;
  }

  initSigner(random: boolean, provider?: ethers.providers.Provider): Signer {
    let signer = null;
    if (random) {
      signer = Wallet.createRandom().connect(provider || this.provider);
    } else {
      throw new NotFoundException('integrate wallet keys');
    }
    return signer;
  }

  logProviderConnection(provider?: ethers.providers.Provider) {
    const networkCon: Promise<ethers.providers.Network> = (provider || this.provider).getNetwork();
    networkCon
      .then((net) =>
        this.logger.log('Connected via ' + this.configService.get<string>('ETH_PROVIDER_TYPE')
          + ' to network "' + net.name + '" ID=' + net.chainId
        )
      )
      .catch((error) => {
        throw new Error('Failed to access the provider network\n' + error);
      });
  }

  /** instances of the ETH oracle contracts */
  private oracleContracts: Map<string, Contract>;
 
  getOracleContracts(): Map<string, Contract> {
    return this.oracleContracts;
  }

  /**
   * Instantiate a Chainlink EA Aggregator oracle contract, bound to ETH
   * @param addrOrName the contract ETH address or its ENS name
   * @param provider web3 provider for ETH
   * @returns
   */
  initContrqctChainlinkAggregator(
    addrOrName: string,
    provider: ethers.providers.Provider
  ): Contract {
    return new Contract(addrOrName, oracleContractAbi, provider);
  }

  //  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  async loadOracleLatestRoundData(
    key: string,
    contract: Contract,
    resultCollector?: Map<string, Result>
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
  listenToEvent(
    contract: Contract, 
    eventFilter: EventFilter
  ): void {
    contract.on(eventFilter, (result: any) => {
      this.logger.warn('HEARD something! ' + result);
    });

    try {
      const filter2: EventFilter = contract.filters.AnswerUpdated();
      this.logger.debug(
        'Initialized filter2: ' + filter2 + ' Address=' + filter2.address + ' Topic: ' + filter2.topics
      );
      contract.on(filter2, (current, roundId, updatedAt) => {
        this.logger.warn('Found an AnswerUpdated!!!! current=' + current + ' round=' + roundId + ' at=' + updatedAt);
      });
    } catch (error) {
      this.logger.error('Failed to listen on filter AnswerUpdated!\n'+error, error);
    }
  }

  // Listen to Event 'AnswerUpdated'
  // Topic0: 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f
  listenEventOracleAnswerUpdated(
    contractOracle: Contract, 
  ): void {
    const eventId = ethers.utils.id('AnswerUpdated(int256,uint256,uint256)');
    let eventFilterAnswerUpd: EventFilter = {
      //address: contractOracle.address,
      topics: [eventId]
    };
    this.listenToEvent(contractOracle, eventFilterAnswerUpd);
  }

}