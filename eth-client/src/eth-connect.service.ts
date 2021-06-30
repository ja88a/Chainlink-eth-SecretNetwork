import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';

import { Contract, ethers, EventFilter } from 'ethers';
import { Result } from 'ethers/lib/utils';

import abiClAggregatorProxy from './res/EACAggregatorProxy.ABI.json';
import abiClAggregator from './res/AccessControlledOffchainAggregator.ABI.json';
import {
  EEthersNetwork,
  EContractCastReason,
  ProviderNetwork,
  ETopic,
  ConversionConfig,
  convertContractInputValue,
  ValueType,
  ValueTypeDate,
  EResultFieldLatestRoundData,
  RelaydKClient,
  RelaydKGroup,
  FeedConfigSourceData,
  deepCopyJson,
  EContractStatus,
  EFeedSourcePoll,
  EFeedSourceNotifOn,
  EContractPollingChange,
  ContractPollingInfo,
  VALID_OPT,
  ProcessingIssue,
  RelaydConfigService,
  EContractDataUpdateReason,
  KafkaUtils,
  EConfigRunMode,
} from '@relayd/common';
import { EFeedSourceNetwork, FeedConfigSource, EFeedSourceType } from '@relayd/common';

import { Client } from '@nestjs/microservices/decorators/client.decorator';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { KafkaStreams, KStream, KTable } from 'kafka-streams';

import { PreconditionFailedException } from '@nestjs/common/exceptions/precondition-failed.exception';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { isDate, isDateString, isEthereumAddress, isPositive, validate } from 'class-validator';
import { FeedConfigSourceHandle, FeedContractConfigWrap } from '@relayd/common/dist/types/data/feed.data';
import { Cipher } from 'crypto';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;

  @Client(KafkaUtils.getConfigKafka(RelaydKClient.ETH, RelaydKGroup.ETH))
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  private serviceId: string;

  constructor(private readonly config: RelaydConfigService) { }

  async init(): Promise<void> {
    this.initProvider();
    this.logProviderConnection();

    // TODO Review the need for listening to these responses
    const topics = [
      ETopic.CONTRACT,
      ETopic.CONTRACT_DATA,
      ETopic.CONTRACT_POLLING,
      ETopic.ERROR
    ];
    topics.forEach((pattern) => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    KafkaUtils.getKafkaNativeInfo(this.logger);

    this.serviceId = RelaydKClient.ETH + '_' + (await this.getNetworkProviderInfo()).name + '_' + Date.now();

    //await createTopicsDefault(this.clientKafka, this.logger);

    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKClient.FEED);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams();
  }

  async shutdown(signal: string) {
    this.logger.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"

    if (this.provider)
      this.provider.removeAllListeners();

    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => {
          this.logger.debug('ETH kClient closed');
        })
        .catch((error) => {
          throw new Error('Unexpected closure of ETH kClient\n' + error);
        });

    if (this.streamFactory)
      await this.streamFactory.closeAll();
  }

  getServiceId(): string {
    return this.serviceId;
  }


  // ________________________________________________________________________________
  //
  //  ETH Network Connection management
  // ________________________________________________________________________________

  initProvider(): void {
    const providerType = this.config.ethProviderType;
    let provider = null;
    try {
      if (providerType === 'local') {
        provider = new ethers.providers.WebSocketProvider(
          this.config.ethProviderLocalUrl,
        );
      } else {
        const networkId = this.config.ethProviderNetworkId;
        provider = ethers.getDefaultProvider(networkId, {
          etherscan: this.config.ethEtherscanApiKey,
          infura: {
            projectId: this.config.ethInfuraProjectId,
            projectSecret: this.config.ethInfuraProjectSecret,
          },
        });
      }
    } catch (error) {
      throw new PreconditionFailedException(error, 'Failed to establish a connection to ETH network');
    }
    this.provider = provider;
  }

  private ethNetworkProviderInfo: ProviderNetwork;

  async getNetworkProviderInfo(forceLoad?: boolean, provider?: ethers.providers.Provider): Promise<ProviderNetwork> {
    if (forceLoad || this.ethNetworkProviderInfo === undefined)
      this.ethNetworkProviderInfo = await this.loadNetworkProviderInfo(provider);

    return this.ethNetworkProviderInfo;
  }

  /**
   * Load the info about the ETH network this ethersjs client is connecting with
   * 
   * @param provider Optional specification of the ethersjs provider instance. Else default is used
   * @returns Ethers.js network provider info
   */
  async loadNetworkProviderInfo(provider?: ethers.providers.Provider): Promise<ProviderNetwork> {
    const networkCon: Promise<ethers.providers.Network> = (provider || this.provider).getNetwork();
    return networkCon
      .then((net) => {
        //this.logger.debug('Provider network info: ' + JSON.stringify(net));
        return {
          name: net.name,
          chainId: net.chainId,
          type: this.config.ethProviderType,
        };
      })
      .catch((error) => {
        throw new Error('Failed to connect to ETH network \n' + error);
      });
  }

  logProviderConnection() {
    this.getNetworkProviderInfo(true).then((info: ProviderNetwork) => {
      this.logger.log(
        "Connected to ETH via provider '" + info.type + "' to network '" + info.name + "' ID=" + info.chainId,
      );
    });
  }

  // ________________________________________________________________________________
  //
  //  Contract management utilities
  // ________________________________________________________________________________

  /**
   * Check if the contract ETH network matches with the one this ETH client is connecting to
   * @param contractNetwork
   * @returns
   */
  async checkNetworkMatch(contractNetwork: string): Promise<boolean> {
    const clientNetwork = (await this.getNetworkProviderInfo()).name;
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
   * Internal utility. Count the number of issues that happened in a recent (latest) row
   * 
   * @param contractSource
   * @param issueType
   * @returns number of times an issue was reported in the last serie of issues
   */
  countIssueInLastRow(contractSource: FeedConfigSource, issueType: string): number {
    let countIssue = 0;
    if (contractSource.issue) {
      contractSource.issue.forEach((issue) => {
        if (issue.type == issueType) countIssue++;
        else return;
      });
    }
    return countIssue;
  }


  // ________________________________________________________________________________
  //
  //  Management of update events via Streams
  // ________________________________________________________________________________


  private contractSourceKTable: KTable;

  initStreams(): void {
    // Contract Polling events Logging
    if (this.config.appRunMode !== EConfigRunMode.PROD)
      //const contractPollingStreamLogging = 
      KafkaUtils.initKStreamWithLogging(this.streamFactory, ETopic.CONTRACT_POLLING, this.logger)
        .then((result: KStream | Error) => {
          if (result instanceof Error)
            return new Error('Failed to init kStream for logging Contract Polling records \n' + result);
          return result;
        });

    // Source contract config kTable
    const resContractPollingKTable = this.initKTableContractSourceConfig()
      .then((result: KTable | Error) => {
        if (result instanceof Error)
          return new Error('Failed to init kTable on Source Contracts \n' + result);
        this.contractSourceKTable = result;
        return result;
      });

    // Merging of contract polling updates into source contract config
    const contractConfigStreamRes = this.mergeContractConfigToFeedConfig();

    Promise.all([
      contractConfigStreamRes,
      resContractPollingKTable,
    ]).then((initRes) => {
      this.logger.log('ETH Contracts Stream & Table started');
      initRes.forEach(element => {
        if (element instanceof Error)
          this.logger.error('Failure on Streams initialization \n' + element);
      });
    }).catch((error) => {
      this.logger.error(new Error('Failed to init Streams \n' + error));
    });
  }

  /**
   * Initialization of a kTable on Source Contract, as a data Feed source
   * @returns created kTable or an error met during that process
   */
  async initKTableContractSourceConfig(): Promise<KTable | Error> {
    const topicName = ETopic.CONTRACT;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');

    const keyMapperEtl = message => {
      const contractSource: FeedConfigSource = JSON.parse(message.value.toString());
      const feedContractWrap: FeedContractConfigWrap = {
        feedId: message.key.toString('utf8'),
        source: contractSource,
      }
      this.logger.debug('Wrapped Contract Source config kTable \'' + topicName + '\' entry\n' + JSON.stringify(feedContractWrap));
      return {
        key: contractSource.contract,
        value: feedContractWrap
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    //const outputStreamConfig: KafkaStreamsConfig = null;
    return topicTable.start(
      () => {
        this.logger.debug('kTable on \'' + topicName + '\' ready. Started');
      },
      (error) => {
        //this.logger.error('Failed to start kTable for \'' + topicName + '\'\n' + error);
        throw new Error('Failed to init kTable for \'' + topicName + '\' \n' + error);
      },
      // false,
      // outputStreamConfig
    )
      .then(() => { return topicTable })
      .catch((error) => { return new Error('Failed to init Contract Source kTable on \'' + topicName + '\' \n' + error) });
  }

  /**
   * Initiate a stream responsible for merging contract polling updates into the feed source config
   * @returns created contract polling stream or an error met during that init process
   */
  async mergeContractConfigToFeedConfig(): Promise<KStream | Error> {
    const contractPollingTopic = ETopic.CONTRACT_POLLING;
    const contractPollingStream: KStream = this.streamFactory.getKStream(contractPollingTopic);

    contractPollingStream
      .mapJSONConvenience()
      .forEach(async (contractPollingRecord) => {
        const contractId = contractPollingRecord.key?.toString('utf8');
        const contractPollingInfo: ContractPollingInfo = contractPollingRecord.value;
        //this.logger.debug('Processing contract config \'' + contractConfig.contract + '\' for merging in feed \'' + feedId + '\'\n' + JSON.stringify(contractConfigRecord));
        this.logger.debug('Processing contract polling \'' + contractPollingInfo.contract + '\' for merging in contract \'' + contractId + '\'');
        if (!contractId)
          throw new Error('Contract polling record on \'' + contractPollingTopic + '\' has no contract ID key \n' + JSON.stringify(contractPollingRecord));

        const contractConfigMergingResult = await this.loadContractFromTable(contractId)
          .catch((error) => {
            return new Error('Failed to merge contract polling info into source contract config \'' + contractId + '\' \n' + error);
          })
          .then((feedContractWrap: FeedContractConfigWrap | Error) => {
            if (!feedContractWrap || feedContractWrap instanceof Error)
              return new Error('No target contract config \'' + contractId + '\' found for merging contract polling \'' + contractPollingInfo.contract + '\'');

            //this.logger.log('Merging\nContract polling info:\n' + JSON.stringify(contractPollingInfo) + '\nin Source Contract config:\n' + JSON.stringify(contractConfig));
            const contractConfig = feedContractWrap.source;
            const newHandleRes = this.reviewContractHandling(contractConfig.handle, contractPollingInfo);
            if (newHandleRes instanceof Error)
              return new Error('Failed to process source contract polling handle info for \'' + feedContractWrap.feedId + '\' \n' + newHandleRes);
            contractConfig.handle = newHandleRes;

            return this.castContractConfig(ETopic.CONTRACT, feedContractWrap.feedId, contractConfig,
              EContractCastReason.HANDLING_SUCCESS, 'Update polling info')
              .catch((error) => {
                return new Error('Failed to cast merged feed-contract config \'' + contractId + '\'\n' + error)
              });
          });

        if (contractConfigMergingResult instanceof Error)
          // TODO report / cast that contract merging process error
          this.logger.error('Failed to merge contract polling info to its config \n' + contractConfigMergingResult);
        else
          //this.logger.log('Source contract \'' + contractConfig.contract + '\' merged into feed \'' + feedId + '\'\n' + JSON.stringify(feedConfigMerged));
          this.logger.log('Source contract \'' + contractPollingInfo.contract + '\' merged into feed \'' + contractId + '\'');
      });

    return await contractPollingStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + contractPollingTopic + '\' for merging configs ready. Started');
      },
      (error) => { // kafka error callback
        this.logger.error('Kafka Failed to start Stream on \'' + contractPollingTopic + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    )
      .then(() => {
        return contractPollingStream;
      })
      .catch((error) => {
        return new Error('Failed to initiate contract config stream for merging in feed config \n' + error);
      });
  }

  /**
   * Review a source contract handles against a contract polling change: validate and compute the updated handles' state
   * @param _actual Actual contract's handle as defined in the feed config Source
   * @param contractPollingInfo contract polling info to process
   * @returns updated contract's handle entries
   */
  // TODO Enhance the restriction & error handling on unexpected contracts' polling un-/registration
  reviewContractHandling(_actual: FeedConfigSourceHandle[], contractPollingInfo: ContractPollingInfo)
    : FeedConfigSourceHandle[] | Error {
    const issuer = contractPollingInfo.issuer;

    const alreadyPolledByIssuer: EFeedSourcePoll[] = [];
    _actual.forEach((handle: FeedConfigSourceHandle) => {
      if (handle.handler === issuer) {
        alreadyPolledByIssuer.push(handle.type);
      }
    });

    const contract = contractPollingInfo.contract;

    // Register a new contract polling
    if (contractPollingInfo.change === EContractPollingChange.ADD_LISTEN_EVENT
      || contractPollingInfo.change === EContractPollingChange.ADD_PERIODIC) {

      const handleUpd: FeedConfigSourceHandle[] = deepCopyJson(_actual);
      let pollingType: EFeedSourcePoll;
      if (contractPollingInfo.change === EContractPollingChange.ADD_LISTEN_EVENT) {
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          const msg = 'Unexpected re-declaration of an event-based polling of \'' + contract + '\' by the already handling \'' + issuer + '\'';
          if (this.config.contractPollingAllowMultipleBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + contract + '\'';
          if (this.config.contractPollingAllowMultipleTypeBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (contractPollingInfo.change === EContractPollingChange.ADD_PERIODIC) {
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Unexpected re-declaration of a periodic polling of \'' + contract + '\' by the already registered \'' + issuer + '\'';
          if (this.config.contractPollingAllowMultipleBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + contract + '\'';
          if (this.config.contractPollingAllowMultipleTypeBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        pollingType = EFeedSourcePoll.TIMEPERIOD;
      }

      handleUpd.unshift({
        handler: issuer,
        type: pollingType,
        time: new Date().toISOString(),
      });

      this.logger.log('Handler \'' + issuer + '\' registered as polling \'' + pollingType + '\' contract \'' + contract + '\'');
      return handleUpd;
    }

    // Unregister/remove a contract polling
    if (contractPollingInfo.change === EContractPollingChange.REMOVE_LISTEN_EVENT
      || contractPollingInfo.change === EContractPollingChange.REMOVE_PERIODIC) {

      let pollingType: EFeedSourcePoll;
      if (contractPollingInfo.change === EContractPollingChange.REMOVE_LISTEN_EVENT) {
        if (!alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          return new Error('Unexpected removal of an event-based polling of \'' + contract + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (contractPollingInfo.change === EContractPollingChange.REMOVE_PERIODIC) {
        if (!alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          return new Error('Unexpected removal of a periodic polling of \'' + contract + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
        }
        pollingType = EFeedSourcePoll.TIMEPERIOD;
      }

      const handleUpd: FeedConfigSourceHandle[] = [];
      _actual.forEach((element: FeedConfigSourceHandle) => {
        if (!(element.handler === issuer && element.type === pollingType))
          handleUpd.push(deepCopyJson(element));
      });

      this.logger.debug('Handler \'' + issuer + '\' de-registered as polling \'' + pollingType + '\' contract \'' + contract + '\'');
      return handleUpd;
    }

    return new Error('Unknow Contract Polling Change \'' + contractPollingInfo.change + '\' for \'' + contract + '\'. Not supported');
  }

  /**
   * Load a contract config, wrappred with its feedId, from a kTable, based on a contract address
   * @param keyId contract address
   * @param kTable optional overriding of the target kTable instance to query
   * @param entityName optional overriding of the entity name used for logging
   * @returns result of the search in the kTable
   */
  async loadContractFromTable(keyId: string, kTable: KTable = this.contractSourceKTable, entityName = 'source contract config')
    : Promise<FeedContractConfigWrap | Error> {
    // this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
    // this.logger.debug('kTable info\n== Stats:\n'+ JSON.stringify(kTable.getStats()) +'\n== State:\n' + JSON.stringify(kTable.getTable()));
    return kTable.getStorage().get(keyId)
      .then((contractFeedWrap) => {
        if (!contractFeedWrap) {
          this.logger.debug('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        if (!contractFeedWrap.feedId || !contractFeedWrap.source)
          return new Error('Invalid feed-wrapped source contract config \'' + keyId + '\'\n' + JSON.stringify(contractFeedWrap));
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' in kTable\n' + JSON.stringify(contractFeedWrap));
        return contractFeedWrap;
      })
      .catch((error) => {
        return new Error('Failed to extract ' + entityName + ' \'' + keyId + '\' from kTable \n' + error);
      });
  }

  // ________________________________________________________________________________
  //
  //  Management of update events via Messages
  // ________________________________________________________________________________

  /**
   * Cast a message about a contract, any config update
   * 
   * @param feedConfigId the feed ID the source contract belongs to
   * @param contract the contract config
   * @param reason reason code of the contract update
   * @param info optional info about that update, e.g. free description text, error
   * @returns either the casting record metadata or a processing error
   */
  async castContractConfig(topic: ETopic, feedConfigId: string, contract: FeedConfigSource, reason: EContractCastReason, info?: string)
    : Promise<RecordMetadata[] | Error> {
    const issueNote = await this.issueContractProcessingNote(contract, reason, info);

    const validRes = validate(contract, VALID_OPT)
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Contract Config update \n' + JSON.stringify(validationError));
        return [];
      })
      .catch((error) => {
        return new Error('Failed to validate Contract Config update for \'' + contract?.contract + '\' by \'' + issueNote.issuer + '\' \n' + error);
      });

    if (validRes instanceof Error)
      return validRes;

    return this.clientKafka.connect()
      .then(async (producer) => {
        return producer.send({
          topic: topic,
          messages: [
            {
              key: feedConfigId,
              value: JSON.stringify(contract), // TODO Review Serialization format
            },
          ],
        })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Contract record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
          .catch((error) => {
            return new Error('Failed to cast Contract config \'' + contract?.contract + '\' update for \'' + feedConfigId + '\' (' + reason + '\': ' + info + ') \n' + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castContractConfig for contract \'' + contract?.contract + '\' of feed \'' + feedConfigId + '\' (' + reason + ': ' + info + ') \n' + error);
      });
  }

  private issueContractProcessingNote(contractSource: FeedConfigSource, reason: EContractCastReason, info: string) {
    if (contractSource.issue == null)
      contractSource.issue = [];
    else if (contractSource.issue.length > this.config.contractIssueMaxNumber)
      contractSource.issue.pop();

    const processingInfo: ProcessingIssue = {
      issuer: this.getServiceId(),
      type: reason,
      info: info?.substr(0, 255),
    };

    contractSource.issue.unshift(processingInfo);

    return processingInfo;
  }

  /**
   * Send a message to update on the handling of a source contract's data polling
   * @param topic  
   * @param contractAddr 
   * @param changeType 
   * @param info 
   * @returns 
   */
  async castSourcePolling(topic: ETopic, contractAddr: string, changeType: EContractPollingChange, info?: string)
    : Promise<RecordMetadata[] | Error> {
    const updateIssuer = this.getServiceId();

    const contractPollingUpdate: ContractPollingInfo = {
      issuer: updateIssuer,
      contract: contractAddr,
      change: changeType,
      info: info,
    };

    const validRes = await validate(contractPollingUpdate, VALID_OPT)
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Contract Polling update \n' + JSON.stringify(validationError));
      })
      .catch((error) => {
        return new Error('Failed to validate Contract Polling Update for \'' + contractAddr + '\' from \'' + updateIssuer + '\' \n' + error);
      });
    if (validRes instanceof Error)
      return validRes;

    return this.clientKafka.connect()
      .then(async (producer) => {
        return producer.send(
          {
            topic: topic,
            messages: [
              {
                key: contractAddr,
                value: JSON.stringify(contractPollingUpdate), // TODO Review Serialization format
              },
            ],
          })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Contract Polling record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
          .catch((error) => {
            return new Error('Failed to cast Contract Polling update for \'' + contractAddr + '\' \n' + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castContractPolling from \'' + updateIssuer + '\' for contract \'' + contractAddr + '\' \n' + error);
      });
  }

  /**
   * 
   * @param contractAddr 
   * @param contractData 
   * @returns 
   */
  async castContractDataUpdate(topic: ETopic, contractAddr: string, contractData: FeedConfigSourceData,
    reason: EContractDataUpdateReason, info?: string): Promise<RecordMetadata[] | Error> {
    return this.clientKafka.connect()
      .then(async (producer) => {
        return producer.send({
          topic: topic,
          messages: [
            {
              key: contractAddr,
              value: JSON.stringify(contractData), // TODO Review Serialization format
            },
          ],
        })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Contract Data record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
          .catch((error) => {
            return new Error("Failed to cast Contract '" + contractAddr + "' Data update \n" + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castContractDataUpdate for contract \'' + contractAddr + '\' \n' + error);
      });
  }


  // ________________________________________________________________________________
  //
  //  Source Contract Management
  // ________________________________________________________________________________

  /**
   * Process a source contract, depending on its config status
   * 
   * @param contractConfig Target source contract config to be handled
   * @returns Updated source contract config to reflect any state changes, or corresponding processing error
   */
  async handleSourceContract(contractConfigIni: FeedConfigSource): Promise<FeedConfigSource | Error> {
    this.logger.debug(
      "Handling contract '" + contractConfigIni.contract + "' with status '" + contractConfigIni.status + "'",
    );

    const contractConfig: FeedConfigSource = deepCopyJson(contractConfigIni);
    switch (contractConfig.status) {

      // New contract source initialization: validation
      case EContractStatus.INI:
        return this.validateSourceContract(contractConfig)
          .then((result) => {

            if (result instanceof Error)
              throw result;

            return validate(result) // TODO Fix the validation issue on contract config, VALID_OPT
              .then((validationError) => {
                if (validationError && validationError.length > 0) {
                  // Validation partial / issue(s) met
                  contractConfig.status = EContractStatus.PARTIAL;
                  this.issueContractProcessingNote(contractConfig, EContractCastReason.HANDLING_VALIDATION_PARTIAL, JSON.stringify(validationError))
                  this.logger.warn("Contract '" + contractConfig.contract + "' (" + contractConfig.type
                    + ") is partially Valid. Status: " + contractConfig.status + '\n' + JSON.stringify(validationError));
                } else {
                  // Validation OK
                  contractConfig.status = EContractStatus.OK;
                  if (!contractConfig.data)
                    contractConfig.data = result;
                  else
                    Object.assign(contractConfig.data, result);
                  this.logger.log("Contract '" + contractConfig.contract + "' (" + contractConfig.type +
                    ") is VALID. Status: " + contractConfig.status);
                }
                return contractConfig;
              })
              .catch((error) => {
                return new Error('Failed to validate output of \'' + contractConfig.contract + '\' validation\n' + error)
              });
          })
          .catch((error) => {
            const msg = 'Validation failed for Source Contract ' + contractConfig.contract
              + '. Status: ' + contractConfig.status + '\n' + error;
            // contractConfig.status = EContractStatus.FAIL;
            // this.issueContractProcessingNote(contractConfig, EContractCastReason.HANDLING_FAILED, error);
            // this.logger.warn(msg);
            // return contractConfig;
            return new Error(msg);
          });
        break;

      // Source Contract validated & ready for data polling
      case EContractStatus.OK:
        this.logger.log('Initiate data polling for \'' + contractConfig.contract + '\'');

        // Check that this contract polling is not already handled by the same owner
        const toPoll = this.checkIfDataPollingRequired(contractConfig);
        if (toPoll instanceof Error) {

        }
        else if (toPoll === undefined) {

        }
        else { 
          // Launch the polling process
          const result = this.initiateContractDataPolling(contractConfig)
            .then((result) => {
              if (result instanceof Error)
                return new Error('Failed to initiate source data polling \n'+result);
              // TODO update the contract config
              throw new Error('ACTIVATION OF DATA POLLING NOT FINALIZED YET');
            })
            .catch((error) => {
              return new Error('Failed to initiate data polling for contract \'' + contractConfig.contract + '\' \n' + error);
            });
        }
        break;

      case EContractStatus.PARTIAL:
      default:
        throw new Error("Status '" + contractConfig.status + "' of Source contract '" +
          contractConfig.contract + "' is not supported",
        );
    }

    // TODO Review
    return contractConfig;
  }

  checkIfDataPollingRequired(source: FeedConfigSource): EFeedSourcePoll | Error {
    const pollingStatus = this.extractContractPollingStatus(source);
    if (pollingStatus.handling.length > 0 && (!this.config.contractPollingAllowMultipleBySameIssuer
        || pollingStatus.handling.includes(source.poll) && !this.config.contractPollingAllowMultipleTypeBySameIssuer)) {
      return new Error('Instance \''+pollingStatus.issuer+'\' already polls the source data ('+pollingStatus.handling.toString()+')');
    } 

    switch (source.poll) {
      case EFeedSourcePoll.EVENT:
        if (pollingStatus.listener < this.config.contractSourceNbEventListener)
          return EFeedSourcePoll.EVENT;
        break;
      case EFeedSourcePoll.TIMEPERIOD:
        if (pollingStatus.querier < this.config.contractSourceNbPeriodicQuerier)
          return EFeedSourcePoll.TIMEPERIOD;
        break;
      default:
        throw new Error('Unknown source polling type: '+source.poll);
        break;
    }
    return undefined;
  }

  extractContractPollingStatus(source: FeedConfigSource) {
    const actor = this.getServiceId();

    let countPollingPeriodic = 0;
    let countPollingEvent = 0;
    const handling: EFeedSourcePoll[] = [];
    source.handle.forEach((handle: FeedConfigSourceHandle) => {
      if (handle.handler === actor)
        handling.push(handle.type);
      if (handle.type === EFeedSourcePoll.EVENT)
        countPollingEvent++;
      if (handle.type === EFeedSourcePoll.TIMEPERIOD)
        countPollingPeriodic++;
    });

    return {
      contract: source.contract,
      issuer: actor,
      handling: handling,
      listener: countPollingEvent,
      querier: countPollingPeriodic,
      time: Date.now(),
    }   
  }

  // ____________________________________________________________________________________
  //
  // Contract Data Polling
  // ____________________________________________________________________________________


  /**
   * Initialization of a contract data polling, based a time schedule or by listening to update events
   * 
   * @param contractConfig Config of the source contract to poll
   * @returns 
   */
  async initiateContractDataPolling(contractConfig: FeedConfigSource): Promise<NodeJS.Timeout | Error> {
    let result;
    if (contractConfig.poll === EFeedSourcePoll.TIMEPERIOD) {
      const timePeriod = contractConfig.period;
      if (!isPositive(timePeriod))
        throw new Error('Invalid time period specified for periodic data polling: ' + timePeriod);

      const contract = this.initContractClAggregator(contractConfig.contract, contractConfig.type);
      result = await this.loadContractDecimals(contract)
        .then((contractDecimals) => {
          const convertOpts: ConversionConfig = { decimals: contractDecimals };
          const pollingTimeout = this.startPollingData(contractConfig, convertOpts, contract);
          this.trackSourcePolling(contractConfig.contract, pollingTimeout);
          return pollingTimeout;
        })
        .catch((error) => {
          return new Error('Failed to initiateContractDataPolling of type \'' + EFeedSourcePoll.TIMEPERIOD + '\' on \'' + contractConfig.contract + '\' \n' + error);
        });
    }
    else if (contractConfig.poll === EFeedSourcePoll.EVENT) {
      throw new Error('Source contract polling \'' + EFeedSourcePoll.EVENT + '\' NOT SUPPORTED YET');
    }
    return result;
  }

  /**
   * Initiate an asynchonous thread responsible for regularly, time period based, request
   * for a contract data. Corresponding data checks or value changes get reported.
   * 
   * @param sourceConfig Config of the source contract to be polled
   * @param convertOpts Extracted value (latestRoundData) conversion options
   * @param contractSrc Optional contract instance. If not specified, a new one is created
   * @returns the initiated TimeOut / polling interval ID
   */
  private startPollingData(sourceConfig: FeedConfigSource, convertOptions: ConversionConfig, contractSrc?: Contract): NodeJS.Timeout {

    const loadContractData = (handler: EthConnectService, contract: Contract, notifOn: string, convertOpts: ConversionConfig, timePeriod: number,
      pollingErrorCounter: number, maxError: number = this.config.maxSuccessiveErrorToStopPolling - 1) =>
      async () => {
        const result = await handler.loadContractLatestRoundData(contract, convertOpts, true)
          .then((result: FeedConfigSourceData) => {
            if (notifOn === EFeedSourceNotifOn.CHECK) {
              result.time = convertContractInputValue((Date.now() / 1000), ValueType.DATE, { date: ValueTypeDate.default });
              return handler.castContractDataUpdate(ETopic.CONTRACT_POLLING, contract.address, result, EContractDataUpdateReason.PERIODIC);
            }
            else {
              const hasChanged = handler.checkForContractDataChange(contract.address, result, timePeriod);
              if (hasChanged) {
                return handler.castContractDataUpdate(ETopic.CONTRACT_POLLING, contract.address, result, EContractDataUpdateReason.DATA_CHANGE);
              }
              return [];
            }
          })
          .catch((error) => {
            return new Error('Failed to poll data for contract \'' + contract?.address + '\' \n' + error);
          });

        if (result instanceof Error) {
          if (++pollingErrorCounter > maxError) {
            // TODO Report the halt of a contract polling on failure
            const msg = 'Failed to poll data from source contract \'' + contract?.address + '\' Stop polling after ' + pollingErrorCounter + ' successive errors. Last:\n' + result;
            handler.stopSourcePolling(contract.address, EContractPollingChange.REMOVE_PERIODIC, msg);
            throw new Error(msg);
          }
          else
            handler.logger.warn('Failed to poll data of contract \'' + contract?.address + '\' (' + pollingErrorCounter + '/' + maxError + ') \n' + result);
        }
      };

    const contract: Contract = contractSrc ? contractSrc : this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
    const timeout: NodeJS.Timeout = setInterval(loadContractData(this, contract, sourceConfig.notif, convertOptions, sourceConfig.period, 0), sourceConfig.period * 1000);

    return timeout;
  }

  /** 
   * Instance specific map of running contract data pulling threads
   */
  private polledSource: Map<string, {
    /** Last retrieved contract data */
    data: FeedConfigSourceData;
    /** polling process's timeout hook */
    timeout: NodeJS.Timeout;
  }> = new Map();

  getPolledSource(): string[] {
    return [...this.polledSource.keys()];
  }

  checkForContractDataChange(contractAddr: string, data: FeedConfigSourceData, pollingPeriod?: number): boolean {
    // Caution: retrieved contract data are considered as valid here
    const previous = this.polledSource.get(contractAddr);
    if (previous === undefined)
      throw new Error('Inconsistent state: no contract \'' + contractAddr + '\' registered for polling. Actual: ' + this.getPolledSource.toString());

    const previousData = previous.data;
    if (previousData === undefined || previousData.value !== data.value) {
      this.logger.debug('Value change detected for contract \'' + contractAddr + '\': ' + data.value);

      if (pollingPeriod) {
        const changeDetectionTimeMs: number = Date.now(); //convertContractInputValue(Date.now(), ValueType.DATE);
        const timeReportedAsUpdatedMs: number = new Date(data.time).valueOf();
        if (changeDetectionTimeMs > (timeReportedAsUpdatedMs + pollingPeriod * 1000 + 1500))
          this.logger.warn('Review Lag between contract value change time and its detection. Took '
            + (timeReportedAsUpdatedMs - changeDetectionTimeMs) / 1000 + 's while the polling period is set to ' + pollingPeriod);
      }

      this.polledSource.set(contractAddr, { data: data.value, timeout: previous.timeout });
      return true;
    }
    return false;
  }

  private trackSourcePolling(sourceId: string, timeout: NodeJS.Timeout) {
    const existing = this.polledSource.get(sourceId);
    if (existing && !this.config.contractPollingAllowMultipleBySameIssuer)
      throw new Error('Attempt to register a second polling of same source contract on same node instance for \'' + sourceId + '\'');

    this.polledSource.set(sourceId, { timeout: timeout, data: undefined });

    return this.castSourcePolling(ETopic.CONTRACT_POLLING, sourceId, EContractPollingChange.ADD_PERIODIC, 'Periodic source contract polling started');
  }

  private stopSourcePolling(sourceId: string, reasonCode: EContractPollingChange, reasonMsg?: string) {
    const timeout = this.polledSource.get(sourceId)?.timeout;
    if (timeout === undefined)
      throw new Error('Requesting to stop a non-registered source polling \'' + sourceId + '\'. Actual: ' + this.getPolledSource().toString());

    this.logger.warn('Stopping periodic polling of source \'' + sourceId + '\'. Reason: ' + reasonCode + ' ' + reasonMsg);
    //timeout.unref();
    clearInterval(timeout);
    this.polledSource.delete(sourceId);
    return this.castSourcePolling(ETopic.CONTRACT_POLLING, sourceId, reasonCode, reasonMsg);
  }

  stopAllSourcePolling() {
    const result: Array<Promise<RecordMetadata[] | Error>> = [];
    this.getPolledSource().forEach((contractAddr: string) => {
      result.push(this.stopSourcePolling(contractAddr, EContractPollingChange.REMOVE_PERIODIC, 'Service shutting down'));
    });
    Promise.all(result)
      .then((outcome: Array<RecordMetadata[] | Error>) => {
        outcome.forEach(element => {
          if (element instanceof Error)
            this.logger.error('Failed to stop a source contract polling \n' + element);
        });
      })
      .catch((error) => {
        this.logger.error('Failed to stop all contracts\' polling properly \n' + error);
      });
  }

  /**
   * Load the latestRoundData of a Chainlink Aggregator contract
   * @param contract Chainlink EACAggregatorProxy or AccessControlledOffchainAggregator contract (defining 'latestRoundData')
   * @param convertOpts Optional. Specify if the extracted contract value(s) are to be converted
   * @param validate Validate or not the extracted values (default: false)
   * @returns contract latestRoundData data set
   */
  async loadContractLatestRoundData(
    contract: Contract,
    convertOpts?: ConversionConfig,
    validate?: boolean,
  ): Promise<FeedConfigSourceData> {
    this.logger.debug("Fetching latestRoundData of '" + contract.address + "'");
    return contract.functions
      .latestRoundData()
      .then((result: Result) => {
        const lastValueRaw = result[EResultFieldLatestRoundData.VALUE];
        const lastValue: number = convertContractInputValue(lastValueRaw, ValueType.PRICE, convertOpts);

        const lastValueTimeRaw = result[EResultFieldLatestRoundData.UPDATE_TIME];
        const lastValueTime: string = convertContractInputValue(lastValueTimeRaw, ValueType.DATE, convertOpts);

        this.logger.debug('Value retrieved from ' + contract.address + ": '" +
          lastValue + ' / ' + lastValueRaw + "' (" + typeof lastValue + ") updated at " + lastValueTime + ' / ' + lastValueTimeRaw + ' (' + typeof lastValueTime + ')');

        // Validate the value's value
        if (validate && !isPositive(lastValue)) { // TODO Review that limitation to contract value type = number
          throw new Error("Invalid value for field '" + EResultFieldLatestRoundData.VALUE +
            "' from contract '" + contract.address + "' latestRoundData: " + lastValue + ' / ' + lastValueRaw,
          );
        }

        // Validate the last update date
        if (validate && !(isDateString(lastValueTime) || isDate(lastValueTime))) {
          throw new Error('Invalid value for field \'' + EResultFieldLatestRoundData.UPDATE_TIME +
            '\' from contract \'' + contract.address + '\' latestRoundData: ' + lastValueTime + ' / ' + lastValueTimeRaw,
          );
        }
        const dateLastUpdate: number = new Date(lastValueTime).valueOf();
        const dateNow: number = Date.now();
        if (validate && dateLastUpdate < dateNow - this.config.contractDataLastUpdateMaxDays * 24 * 60 * 60 * 1000) {
          throw new Error('Last data update is older than ' + this.config.contractDataLastUpdateMaxDays + ' days: ' + lastValueTime + '. Contract considered as stall');
        }

        return {
          value: lastValue,
          time: lastValueTime
        };
      })
      .catch((error) => {
        throw new Error('Failed to fetch latestRoundData for \'' + contract.address + '\' \n' + error);
      });
  }

  /**
   * 
   * @param key 
   * @param contract 
   * @param resultCollector 
   * @returns 
   */
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
   * Load a contract decimals' value
   * @param contract target contract defining a decimals
   * @returns decimals value
   */
  async loadContractDecimals(contract: Contract): Promise<number> {
    return contract.functions
      .decimals()
      .then((result) => {
        const decimals: number = +result[0];
        this.logger.debug('Decimals for ' + contract.address + ': ' + decimals);
        if (!isPositive(decimals))
          throw new Error('Invalid decimals \'' + decimals + '\' in contract \'' + contract.address + '\'');
        return decimals;
      })
      .catch((error) => {
        throw new Error('Failed to fetch decimals for ' + contract.address + '\n' + error);
      });
  }

  //
  // Contract Data Polling
  // ____________________________________________________________________________________
  // ====================================================================================


  /**
   * Check the validity of a source contract, depending on its type
   */
  async validateSourceContract(contractConfig: FeedConfigSource): Promise<FeedConfigSourceData | Error> {
    const address = contractConfig.contract;
    if (address == undefined || !isEthereumAddress(address)) throw new Error('Contract address is invalid: ' + address);

    const contractType = contractConfig.type;
    this.logger.debug("Validating contract '" + address + "' of type '" + contractType + "' with status '" + contractConfig.status);

    const pendingCheck: Promise<FeedConfigSourceData | Error>[] = [];

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
              .catch((error) => {
                return new Error("Failed to fetch latestRoundData for sub-ClAggregator '" + contractAggr.address +
                  "' of '" + address + "' (" + contractType + ')\n' + error);
              });
            // TODO check that events are available/emitted
          })
          .catch((error) => {
            return new Error("Failed to validate Aggregator of contract '" + address + "' (" + contractType + ')\n' + error);
          });

        pendingCheck.push(checkAggregatorProxy);
      }

      const checkAggregator = this.loadContractLatestRoundData(contract, convertOpts, true)
        .then((result: FeedConfigSourceData) => {
          result.decimals = contractDecimals;
          return result;
        })
        .catch((error) => {
          return new Error('Failed to validate latestRoundData for \'' + address + '\' (' + contractType + ')\n' + error);
        });

      pendingCheck.push(checkAggregator);

    }
    else {
      throw new Error('Unsupported type of contract: ' + contractType);
    }

    return Promise.all(pendingCheck)
      .then((validResult) => {
        const aggrRes: FeedConfigSourceData = { value: -1, time: '' };
        validResult.forEach((result) => {
          if (result instanceof Error)
            throw result;
          Object.assign(aggrRes, result);
        });
        this.logger.debug('Aggregated oracle data result: ' + JSON.stringify(aggrRes));
        return aggrRes;
      })
      .catch((error) => {
        return Error('Failed to validate source contract \'' + contractConfig.contract + '\'\n' + error); // JSON.stringify(contractConfig)
      });
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

}
