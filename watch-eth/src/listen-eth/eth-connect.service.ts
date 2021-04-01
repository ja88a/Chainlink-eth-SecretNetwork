import { Result } from '@ethersproject/abi';
import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, ethers, EventFilter } from 'ethers';
import oracleContractAbi from './res/contract-abi-btcusd.json';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  constructor(private configService: ConfigService) {}

  initProvider(): ethers.providers.Provider {
    const providerType = this.configService.get<string>('ETH_PROVIDER_TYPE');
    let provider = null;
    if (providerType === 'local') {
      provider = new ethers.providers.WebSocketProvider(
        this.configService.get<string>('ETH_PROVIDER_LOCAL_URL'),
      );
    } else {
      const networkId = this.configService.get<string>(
        'ETH_PROVIDER_NETWORK_ID',
      );
      provider = ethers.getDefaultProvider(networkId, {
        etherscan: this.configService.get<string>('ETHERSCAN_API_KEY'),
        infura: {
          projectId: this.configService.get<string>('INFURA_PROJECT_ID'),
          projectSecret: this.configService.get<string>(
            'INFURA_PROJECT_SECRET',
          ),
        },
      });
    }
    return provider;
  }

  initSigner(
    provider: ethers.providers.Provider,
    random: boolean,
  ): ethers.Signer {
    let signer = null;
    if (random) {
      signer = ethers.Wallet.createRandom().connect(provider);
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
      .catch((error) =>
        this.logger.error(
          'Failed to access the provider network\n' + error,
          error,
        ),
      );
  }

  initOracleContracts(
    provider: ethers.providers.Provider,
  ): Map<string, ethers.Contract> {
    const contractAddr: Record<string, string> = {
      // kovan: '0x6135b13325bfC4B00278B4abC5e20bbce2D6580e' // https://kovan.etherscan.io/address/0x6135b13325bfC4B00278B4abC5e20bbce2D6580e#readContract
      // rinkeby: 0xECe365B379E1dD183B20fc5f022230C044d51404 EACAggregatorProxy
      // mainnet: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', 'btc-usd.data.eth' // https://etherscan.io/address/0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c
      btcusd: '0xECe365B379E1dD183B20fc5f022230C044d51404',
      // kovan: 0x9326BFA02ADD2366b30bacB125260Af641031331
      // rinkeby: 0x8A753747A1Fa494EC906cE90E9f37563A8AF630e, https://rinkeby.etherscan.io/address/0x8A753747A1Fa494EC906cE90E9f37563A8AF630e
      // mainnet: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419, 'eth-usd.data.eth', // https://etherscan.io/address/0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
      ethusd: '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e',
      // kovan: 0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0
      // rinkeby: 0xd8bD0a1cB028a31AA859A21A3758685a95dE4623 // https://rinkeby.etherscan.io/address/0xd8bD0a1cB028a31AA859A21A3758685a95dE4623#readContract
      // mainnet: 0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c // https://etherscan.io/address/0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c
      linkusd: '0xd8bD0a1cB028a31AA859A21A3758685a95dE4623', // 'link-usd.data.eth',
    };

    const contractRef = [
      contractAddr.btcusd,
      contractAddr.ethusd,
      contractAddr.linkusd,
    ];

    /*     
    interface AggregatorInterface {
      function latestAnswer() external view returns (int256);
      function latestTimestamp() external view returns (uint256);
      function latestRound() external view returns (uint256);
      function getAnswer(uint256 roundId) external view returns (int256);
      function getTimestamp(uint256 roundId) external view returns (uint256);
      function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
      );
      event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
      event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);
    } 
    */
    // // Human-Readable ABI
    // const contractAbiHR: string[] = [
    //   // // Read-Only Functions
    //   'function latestAnswer() view returns (int256)',
    //   'function latestTimestamp() view returns (uint256)',
    //   'function latestRound() view returns (uint256)',
    //   'function getAnswer(uint256 roundId) view returns (int256)',
    //   'function getTimestamp(uint256 roundId) view returns (uint256)',
    //   'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
    //   // Events
    //   'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
    //   'event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt)',
    // ];

    const contractAbi = oracleContractAbi; //contractAbiHR; // oracleContractAbi

    const oracleContracts: Map<string, ethers.Contract> = new Map();
    contractRef.forEach((ref) => {
      this.logger.debug('Instantiating ETH contract ' + ref);
      oracleContracts.set(ref, new ethers.Contract(ref, contractAbi, provider));
    });

    // this.logger.debug(
    //   'Used Oracle Price feed Contract ABI:\n' +
    //     oracleContracts.get(contractRef[0]).interface.format(),
    // );

    return oracleContracts;
  }

  loadContractOracleValues(
    oracleContracts: Map<string, ethers.Contract>,
  ): Map<string, Result> {
    const contractsData: Map<string, Result> = new Map();

    oracleContracts.forEach((contract) => {
      // contract.functions
      //   .latestAnswer()
      //   .then((result: Result) => {
      //     this.logger.debug('Oracle latestAnswer: ' + result);
      //   })
      //   .catch((error) => {
      //     this.logger.error('Failed to fetch latestAnswer\n' + error, error);
      //   });

      //  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
      contract.functions
        .latestRoundData()
        .then((result: Result) => {
          contractsData.set(contract.address, result);
          this.logger.log('Oracle latestRoundData: ' + result);
        })
        .catch((error) => {
          this.logger.error('Failed to fetch latestRoundData\n' + error, error);
        });
    });
    return contractsData;

    // contractOracle
    //   .latestRoundData()
    //   .then((result: any) => {
    //     this.logger.warn('latestRoundData2: ' + result);
    //   })
    //   .catch((error) => {
    //     this.logger.error('Failed to fetch latestAnswer\n' + error, error);
    //   });
  }

  //
  // Filtering on Event 'AnswerUpdated'
  //
  filterOnOracleEvent(contractOracle: ethers.Contract): void {
    // https://docs.ethers.io/v5/api/contract/contract/#Contract--events
    const oracleEventFilter: EventFilter = {
      // address: contractOracle.address,
      topics: [ethers.utils.id('AnswerUpdated(int256,uint256,uint256)')],
    };

    contractOracle
      .queryFilter(oracleEventFilter)
      .then((result) => {
        this.logger.warn('EventFilter: ' + result);
      })
      .catch((error) => {
        this.logger.error('Failed to test EventFilter\n' + error, error);
      });
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

  //
  // Listening to Event 'AnswerUpdated'
  //
  listenOnOracleEvent(
    contractOracle: ethers.Contract,
    oracleEventFilter: ethers.EventFilter,
  ): void {
    contractOracle.on(oracleEventFilter, (result: any) => {
      this.logger.warn('Found something! ' + result);
    });

    try {
      const filter2: ethers.EventFilter = contractOracle.filters.AnswerUpdated();
      this.logger.debug(
        'Initialized filter2: ' +
          filter2 +
          ' Address=' +
          filter2.address +
          ' Topic: ' +
          filter2.topics,
      );
      contractOracle.on(filter2, (current, roundId, updatedAt) => {
        this.logger.warn(
          'Found an AnswerUpdated!!!! current=' +
            current +
            ' round=' +
            roundId +
            ' at=' +
            updatedAt,
        );
      });
    } catch (error) {
      this.logger.error('Failed to listen on filter AnswerUpdated!');
    }
  }

  /**
   * AnswerUpdated(int256,uint256,uint256) : current, roundId, updatedAt
   */
  loadOracleEventsAnswerUpdated(
    oracleContract: ethers.Contract,
    maxNbResults: number,
    maxNbBlocks: number,
  ): any {
    // creating the interface of the ABI
    const iface = oracleContract.interface;
    // array for the logs
    let logs = [];
    // counter for which block we're scraping starting at the most recent block
    let blockNumberIndex = 0;

    // start from latest block number
    oracleContract.provider
      .getBlockNumber()
      .then((latest: number) => {
        this.logger.debug('Latest block number: ' + latest);
        blockNumberIndex = latest;

        // while loop runs until there are as many responses as desired
        while (
          logs.length < maxNbResults &&
          latest - blockNumberIndex < maxNbBlocks
        ) {
          oracleContract.provider
            .getLogs({
              address: oracleContract.address,
              // both fromBlock and toBlock are the index, meaning only one block's logs are pulled
              fromBlock: blockNumberIndex,
              toBlock: blockNumberIndex,
            })
            .then((tempLogs) => {
              this.logger.debug(
                `BLOCK: ${blockNumberIndex} NUMBER OF LOGS: ${tempLogs.length}`,
              );
              blockNumberIndex -= 1;
              logs =
                logs && logs.length > 0
                  ? [...logs, ...tempLogs]
                  : [...tempLogs];

              // returns an array with the decoded events
              const decodedEvents = logs.map((log) => {
                iface.decodeEventLog('AnswerUpdated', log.data);
              });

              const currentValue = decodedEvents.map(
                (event) => event['values']['current'],
              );
              const roundId = decodedEvents.map(
                (event) => event['values']['roundId'],
              );
              const updatedAt = decodedEvents.map(
                (event) => event['values']['updatedAt'],
              );

              this.logger.debug(
                'roundId=' +
                  roundId +
                  ' current=' +
                  currentValue +
                  ' at=' +
                  updatedAt,
              );

              return [roundId, currentValue, updatedAt];
            })
            .catch((error) => {
              this.logger.error(
                'Failed to get Logs for ' + oracleContract.address,
                error,
              );
            });
        }
        this.logger.debug('Logs retrieval Ended');
      })
      .catch((error) => {
        this.logger.error('Failed to get latest block number\n' + error, error);
      });
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
