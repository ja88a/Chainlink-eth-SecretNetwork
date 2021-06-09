import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { NotFoundException } from '@nestjs/common/exceptions/not-found.exception';
//import { OnApplicationShutdown } from '@nestjs/common/interfaces/hooks/on-application-shutdown.interface';
import { Logger } from '@nestjs/common/services/logger.service';
import { ConfigService } from '@nestjs/config';
import { Contract, ethers, Event, EventFilter, Signer, Wallet } from 'ethers';
import { Result } from 'ethers/lib/utils';
import oracleContractAbi from '../res/AccessControlledOffchainAggregator.ABI.json';

export const CstPair = {
  BTCUSD: 'btcusd',
  ETHUSD: 'ethusd',
  LINKUSD: 'linkusd',
};
export const Decimals = {
  FIAT: 8,
  ETH: 18,
  DEFAULT: 18,
};

@Injectable()
export class EthConnectTestService {
  private readonly logger = new Logger(EthConnectTestService.name);

  constructor(private configService: ConfigService) {}

  initProvider(): ethers.providers.Provider {
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
    return provider;
  }

  async shutdown(signal: string) {
    console.warn('Shutting down ETH Service on signal ' + signal); // e.g. "SIGINT"
    if (this.oracleContracts)
      this.oracleContracts.forEach((contract: Contract) => {
        contract.removeAllListeners();
      });
    this.oracleContracts.clear();
    if (this.oracleContractData) this.oracleContractData.clear();
  }

  initSigner(provider: ethers.providers.Provider, random: boolean): Signer {
    let signer = null;
    if (random) {
      signer = Wallet.createRandom().connect(provider);
    } else {
      throw new NotFoundException('integrate wallet keys');
    }
    return signer;
  }

  logProviderConnection(provider: ethers.providers.Provider) {
    const networkCon: Promise<ethers.providers.Network> = provider.getNetwork();
    networkCon
      .then((net) =>
        this.logger.log(
          'Connected via ' +
            this.configService.get<string>('ETH_PROVIDER_TYPE') +
            ' to network "' +
            net.name +
            '" ID="' +
            net.chainId +
            '"',
        ),
      )
      .catch((error) => this.logger.error('Failed to access the provider network\n' + error, error));
  }

  /** Config map of ETH oracles' address, for a given network  */
  private contractAddr: Map<string, string>;

  /**
   * Default oracle contracts list
   * @param contractAddrExt optional external provisioning of the default oracle contracts
   */
  // mainnet: 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c, 'btc-usd.data.eth' https://data.chain.link/btc-usd https://etherscan.io/address/0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c
  // kovan: 0x6135b13325bfC4B00278B4abC5e20bbce2D6580e, https://kovan.etherscan.io/address/0x6135b13325bfC4B00278B4abC5e20bbce2D6580e#readContract
  // rinkeby: 0xECe365B379E1dD183B20fc5f022230C044d51404 EACAggregatorProxy
  //
  // mainnet: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419, 'eth-usd.data.eth', // https://etherscan.io/address/0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
  // kovan: 0x9326BFA02ADD2366b30bacB125260Af641031331
  // rinkeby: 0x8A753747A1Fa494EC906cE90E9f37563A8AF630e, https://rinkeby.etherscan.io/address/0x8A753747A1Fa494EC906cE90E9f37563A8AF630e
  //
  // mainnet: 0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c, 'link-usd.data.eth', https://etherscan.io/address/0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c
  // kovan: 0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0
  // rinkeby: 0xd8bD0a1cB028a31AA859A21A3758685a95dE4623, https://rinkeby.etherscan.io/address/0xd8bD0a1cB028a31AA859A21A3758685a95dE4623#readContract
  //
  initOracleContractList(network?: string, contractAddrExt?: Map<string, string>): void {
    if (contractAddrExt) {
      this.contractAddr = contractAddrExt;
    } else {
      this.contractAddr = new Map();
      switch (network) {
        case 'rinkeby':
          this.contractAddr.set(CstPair.BTCUSD, '0xECe365B379E1dD183B20fc5f022230C044d51404');
          this.contractAddr.set(CstPair.ETHUSD, '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e');
          //this.contractAddr.set(CstPair.LINKUSD, '0xd8bD0a1cB028a31AA859A21A3758685a95dE4623');
          break;
        case 'kovan':
          this.contractAddr.set(CstPair.BTCUSD, '0x6135b13325bfC4B00278B4abC5e20bbce2D6580e');
          this.contractAddr.set(CstPair.ETHUSD, '0x9326BFA02ADD2366b30bacB125260Af641031331');
          //this.contractAddr.set(CstPair.LINKUSD, '0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0');
          break;

        default:
          this.contractAddr.set(CstPair.BTCUSD, 'btc-usd.data.eth'); // 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c (EACAggregatorProxy)
          //          this.contractAddr.set(CstPair.BTCUSD, '0x7104ac4abcecf1680f933b04c214b0c491d43ecc'); // (AccessControlledOffchain, events: https://etherscan.io/address/0x7104ac4abcecf1680f933b04c214b0c491d43ecc#events)
          this.contractAddr.set(CstPair.ETHUSD, 'eth-usd.data.eth'); // 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419 (EACAggregatorProxy)
          //this.contractAddr.set(CstPair.LINKUSD, 'link-usd.data.eth'); // 0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c
          break;
      }
    }
  }

  getContractAddrList(): Map<string, string> {
    return this.contractAddr;
  }

  /** instances of the ETH oracle contracts */
  private oracleContracts: Map<string, Contract>;

  /**
   * Instantiate the oracle contracts, bind them to ETH
   * @param provider web3 provider for ETH
   * @returns
   */
  initOracleContracts(provider: ethers.providers.Provider): Map<string, Contract> {
    //let contractRef: string[];
    if (!this.getContractAddrList()) this.initOracleContractList();

    this.oracleContracts = new Map<string, Contract>();
    this.getContractAddrList().forEach((value: string, key: string) => {
      this.logger.debug('Instantiating ETH contract "' + key + '" ' + value);
      this.oracleContracts.set(key, new Contract(value, oracleContractAbi, provider));
    });
    return this.oracleContracts;
  }

  getOracleContracts(): Map<string, Contract> {
    return this.oracleContracts;
  }

  /** Last loaded contracts' data set */
  // private oracleContractData: Map<string, Result>[] & { length: 3 };
  private oracleContractData: Map<string, Result> = new Map();

  /**
   * Load actual oracle values on chain
   * @param oracleContractMap optional provisioning of a list of oracle contracts, else the already initiatialized list is considered
   * @returns loaded ETH oracle contracts' data
   */
  async loadAllContractData(oracleContractMap?: Map<string, Contract>): Promise<Map<string, Result>> {
    if (!oracleContractMap) oracleContractMap = this.getOracleContracts();

    //const contractData: Map<string, Result> = new Map();

    const requests = [];
    oracleContractMap.forEach((value: Contract, key: string) => {
      requests.push(
        this.loadContractOracleLatestRoundData(key, value).then((result: Result) => {
          this.oracleContractData.set(key, result);
        }),
      );
    });

    return Promise.all(requests)
      .then(() => {
        return this.oracleContractData;
      })
      .catch((error) => {
        throw new Error('Failed to fetch all contracts data\nError: ' + error);
      });
  }

  //  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  async loadContractOracleLatestRoundData(key: string, contract: Contract): Promise<Result> {
    return contract.functions
      .latestRoundData()
      .then((result: Result) => {
        //this.logger.debug('latestRoundData for ' + key + ': ' + result);
        return result;
      })
      .catch((error) => {
        throw new Error('Failed to fetch latestRoundData for ' + key + '\nError: ' + error);
      });
  }

  getOracleContractData(): Map<string, Result> {
    return this.oracleContractData;
  }

  /**
   * Listening to Events on a contract
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

  /**
   * Query past events on a contract
   */
  async loadContractEvent(contract: Contract, eventId: string, overMaxPastBlock?: number): Promise<Event[]> {
    const blockNbLatest = await contract.provider.getBlockNumber();
    const fromBlockStart = blockNbLatest - (overMaxPastBlock > 0 ? overMaxPastBlock : 1000);

    // https://docs.ethers.io/v5/api/contract/contract/#Contract--events
    const oracleEventFilter: EventFilter = {
      //address: contractOracle.address,
      topics: [eventId],
    };

    this.logger.debug(
      'Load events AnswerUpdated on ' + contract.address + ' from block ' + fromBlockStart + ' eventId=' + eventId,
    );

    return await contract
      .queryFilter(oracleEventFilter, fromBlockStart)
      .then((result: Event[]) => {
        this.logger.log('Loaded events AnswerUpdated. Found ' + result?.length + ' matching events');
        return result;
      })
      .catch((error) => {
        throw new Error('Failed to load events AnswerUpdated\n' + error);
      });
  }

  // Query a contract for past Events with filtering on 'AnswerUpdated(int256,uint256,uint256)'
  // Topic0: 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f
  async loadEventAnswerUpdated(contractOracle: Contract, overMaxPastBlock?: number): Promise<Event[]> {
    const eventId = ethers.utils.id('AnswerUpdated(int256,uint256,uint256)');
    return this.loadContractEvent(contractOracle, eventId, overMaxPastBlock);
  }

  // prov.getBlockNumber().then((blockNum) => {
  //   this.logger.log('Query - current block is ' + blockNum);
  //   const contractOracleEvents = contractOracle.queryFilter(
  //     oracleLogEventFilter(contractAdr, oracleContractAbi, prov),
  //     blockNum - 100,
  //     blockNum - 1,
  //   );
  //   contractOracleEvents.then((events: ethers.Event[]) => {
  //     for (let i = events.length; --i > 0; ) {
  //       this.logger.debug('Event ' + i + ' ' + events[i]);
  //     }
  //   });
  // });

  /**
   * AnswerUpdated(int256,uint256,uint256) : current, roundId, updatedAt
   */
  async loadLogEventAnswerUpdated(
    contract: Contract,
    maxNbResults: number,
    overMaxNbBlocks?: number,
    nbBlockPerLogReq?: number,
  ): Promise<{ roundId: number; value: number; updatedAt: number }[]> {
    // interface of the ABI
    const iface = contract.interface;

    // counter for which block we're scraping starting at the most recent block
    let blockNumberIndex = 0;
    const blockNbLatest = await contract.provider.getBlockNumber();
    const olderBlockNb = blockNbLatest - (overMaxNbBlocks > 0 ? overMaxNbBlocks : 1000) - 1;
    const blockLotSize = nbBlockPerLogReq > 0 ? nbBlockPerLogReq : 5;

    // array for the logs
    let logs = [];
    const extractedEventData = [];

    // start from latest block number
    blockNumberIndex = blockNbLatest;

    this.logger.log(
      `Initiating Load of logged events for ${contract.address} with max ${maxNbResults} results over last ${overMaxNbBlocks} blocks`,
    );

    // while loop runs until there are as many responses as desired
    while (logs.length < maxNbResults && blockNumberIndex > olderBlockNb) {
      //      this.logger.debug('Querying logs from block '+(blockNumberIndex-blockLotSize+1)+' to '+blockNumberIndex);
      const data = await contract.provider
        .getLogs({
          address: contract.address,
          fromBlock: blockNumberIndex - (blockLotSize - 1),
          toBlock: blockNumberIndex,
        })
        .then((tempLogs: ethers.providers.Log[]) => {
          if (tempLogs.length > 0) {
            this.logger.debug(`Block ${blockNumberIndex} has ${tempLogs.length} LOG entries`);
            logs = logs && logs.length > 0 ? [...logs, ...tempLogs] : [...tempLogs];

            // AnswerUpdated events specific
            // returns an array with the decoded events
            const decodedEvents = logs.map((log) => {
              iface.decodeEventLog('AnswerUpdated', log.data);
            });
            if (decodedEvents) {
              decodedEvents.forEach((dEvent) => {
                this.logger.debug('Event# ' + dEvent);
              });
              const currentValue = decodedEvents.map((event) => {
                this.logger.debug('Event ' + event);
                if (event != null) event['values']['current'];
                else null;
              });
              //const roundId = decodedEvents.map((event) => event['values']['roundId']);
              //const updatedAt = decodedEvents.map((event) => event['values']['updatedAt']);

              //this.logger.log('Found logged event AnswerUpdated: current=' + currentValue + ' at=' + updatedAt + 'roundId=' + roundId);

              //return [roundId, currentValue, updatedAt];

              this.logger.log('Found logged event AnswerUpdated: current=' + currentValue);
              return [currentValue];
            } else return [];
          } else {
            return [];
          }
        })
        .catch((error) => {
          throw new Error('Failed to get Logs for ' + contract.address + '\n' + error);
        });
      blockNumberIndex -= blockLotSize;
      extractedEventData.push(data);
    }
    this.logger.debug('Logs retrieval Ended');
    return extractedEventData;
  }
}
// const oracleLogEventFilter = (contractAddress, erc20abi, _provider) => {
//   const iface = new ethers.utils.Interface(erc20abi.abi);
//   const logs = _provider.getLogs({
//     address: contractAddress,
//   });
//   const decodedEvents = logs.map((log) => {
//     iface.decodeEventLog('AnswerUpdated', log.data);
//   });
//   const currentValue = decodedEvents.map(
//     (event) => event['values']['current'],
//   );
//   // eslint-disable-next-line prettier/prettier
//   const roundId = decodedEvents.map(
//     (event) => event['values']['roundId'],
//   );
//   const updatedAt = decodedEvents.map(
//     (event) => event['values']['updatedAt'],
//   );
//   return [currentValue, roundId, updatedAt];
// };
