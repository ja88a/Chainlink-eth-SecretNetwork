import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';

import { Contract, ethers, EventFilter, Event } from 'ethers';
import { Result } from 'ethers/lib/utils';

import abiClAggregatorProxy from './res/EACAggregatorProxy.ABI.json';
import abiClAggregator from './res/AccessControlledOffchainAggregator.ABI.json';
import {
  EEthersNetwork,
  ESourceCastReason,
  ProviderNetwork,
  ETopic,
  ConversionConfig,
  ValueType,
  ValueTypeDate,
  EResultFieldLatestRoundData,
  RelaydKClient,
  RelaydKGroup,
  FeedSourceData,
  FeedSourceDataUpdate,
  deepCopyJson,
  ESourceStatus,
  EFeedSourcePoll,
  EFeedSourceNotifOn,
  ESourcePollingChange,
  ESourceValidMode,
  SourcePollingInfo,
  VALID_OPT,
  ProcessingIssue,
  RelaydConfigService,
  ESourceDataUpdateReason,
  KafkaUtils,
  EConfigRunMode,
  EErrorType,
  ConvertContractUtils,
} from '@relayd/common';
import { EFeedSourceNetwork, FeedConfigSource, EFeedSourceType } from '@relayd/common';

import { Client } from '@nestjs/microservices/decorators/client.decorator';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { KafkaStreams, KStream, KTable } from 'kafka-streams';

import { PreconditionFailedException } from '@nestjs/common/exceptions/precondition-failed.exception';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { isDate, isDateString, isEthereumAddress, isPositive, validate, validateOrReject } from 'class-validator';
import { FeedSourceHandle, FeedSourceConfigWrap, EFeedSourceEvent } from '@relayd/common';
import { EventEmitter } from 'events';

@Injectable()
export class EthConnectService {
  /** Dedicated logger */
  private readonly logger = new Logger(EthConnectService.name);

  /** Service's Ethereum network provider instance */
  private provider: ethers.providers.Provider;

  /** Kafka simple messages sender from/to KV */
  @Client(KafkaUtils.getConfigKafka(RelaydKClient.ETH, RelaydKGroup.ETH))
  private clientKafka: ClientKafka;

  /** Kafka streams & tables factory */
  private streamFactory: KafkaStreams;

  /** Service unique ID */
  private serviceId: string;

  /** ETH network connection provider */
  private ethNetworkProviderInfo: ProviderNetwork;

  /**
   * Default constructor
   * 
   * @param config App config
   */
  constructor(private readonly config: RelaydConfigService) { }

  /**
   * Service initialization: eth network connection provider, kafka topics & streams
   */
  async init(): Promise<void> {
    this.initProvider();
    this.logProviderConnection();

    // TODO Review the need for listening to these responses
    const topics = [
      ETopic.SOURCE_CONFIG,
      ETopic.SOURCE_DATA,
      ETopic.SOURCE_POLLING,
      ETopic.ERROR_CONFIG,
    ];
    topics.forEach((pattern) => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    KafkaUtils.getKafkaNativeInfo(this.logger);

    this.serviceId = RelaydKClient.ETH + '_' + (await this.getNetworkProviderInfo()).name + '_' + Date.now();

    await KafkaUtils.createTopicsDefault(this.clientKafka, this.logger)
      .catch((error) => { this.logger.warn('ETH Source handler had failure while creating default Kafka topics\nMake sure they have been concurrently created and exist\n' + error) });

    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.ETH_STREAM, RelaydKGroup.ETH);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams()
      .catch((error) => {
        throw new Error('Failed to init ETH Connection streams - CORRUPTED \n' + error);
      });
  }

  /**
   * 
   * @returns 
   */
  getServiceId(): string {
    return this.serviceId;
  }

  /**
   * Shutdown of the service, expected to be a clean one
   * 
   * @param signal signal at the origin of this service shutdown
   */
  async shutdown(signal: string) {
    this.logger.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"

    // Stop all source data polling
    await this.stopAllSourcePolling()
      .catch(error => this.logger.error('Failed to properly close all source polling \n' + error));
    await this.stopAllSourceEventListener()
      .catch(error => this.logger.error('Failed to properly close all source listeners \n' + error));

    // // Wait a bit the time for updates to propagate via Kafka records
    // const ee = new EventEmitter();
    // setTimeout(() => { ee.emit('ok') }, 3000)
    // await new Promise(resolve => {
    //   ee.once('ok', resolve);
    // });

    if (this.streamFactory)
      await this.streamFactory.closeAll()
        .catch(error => this.logger.error('Failed to properly close all Streams & Tables \n' + error));

    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => {
          this.logger.debug('ETH kClient closed');
        })
        .catch((error) => {
          throw new Error('Unexpected bad closure of kClient \n' + error);
        });
  }

  // ________________________________________________________________________________
  //
  //  ETH Network Connection management
  // ________________________________________________________________________________

  /**
   * Init of the Ethereum network connections provider
   */
  initProvider(): void {
    const providerType = this.config.ethProviderType;
    let provider = null;
    try {
      if (providerType === 'local') {
        provider = new ethers.providers.WebSocketProvider(
          this.config.ethProviderLocalUrl,
        );
      }
      else {
        const networkId = this.config.ethProviderNetworkId;
        provider = ethers.getDefaultProvider(networkId, {
          etherscan: this.config.ethEtherscanApiKey,
          infura: {
            projectId: this.config.ethInfuraProjectId,
            projectSecret: this.config.ethInfuraProjectSecret,
          },
          alchemy: this.config.ethAlchemyProjectKey,
          pocket: this.config.ethPocketAppKey,
        });
      }
    } catch (error) {
      throw new PreconditionFailedException(error, 'Failed to establish a connection to ETH network \n' + error);
    }
    this.provider = provider;
  }

  /**
   * Get the info about current service's Ethereum network provider
   * 
   * @param forceLoad force the refresh/reload of the data or used last loaded ones (default)
   * @param provider optional submission of an already instantiated Eth network provider
   * @returns network provision info
   */
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

  /**
   * Log actual ETH network provider info
   */
  logProviderConnection() {
    this.getNetworkProviderInfo(true).then((info: ProviderNetwork) => {
      this.logger.log(
        "Connected to ETH via provider '" + info.type + "' to network '" + info.name + "' ID=" + info.chainId,
      );
    });
  }

  // ________________________________________________________________________________
  //
  //  Source management utilities
  // ________________________________________________________________________________

  /**
   * Check if the source ETH network matches with the one this ETH client is connecting to
   * @param sourceNetwork
   * @returns `true` if the supported network is compatible with the source
   */
  async checkNetworkMatch(sourceNetwork: EFeedSourceNetwork): Promise<boolean> {
    const clientNetwork = (await this.getNetworkProviderInfo()).name;
    let isCompatible: boolean;
    switch (sourceNetwork) {
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
   * @param sourceConfig
   * @param issueType
   * @returns number of times an issue was reported in the last serie of issues
   */
  countIssueInLastRow(sourceConfig: FeedConfigSource, issueType: string): number {
    let countIssue = 0;
    if (sourceConfig.issue) {
      sourceConfig.issue.forEach((issue) => {
        if (issue.type == issueType) countIssue++;
        else return;
      });
    }
    return countIssue;
  }

  /**
   * 
   * @param source 
   * @param reason 
   * @param info 
   * @returns 
   */
  private issueSourceProcessingNote(source: FeedConfigSource, reason: ESourceCastReason, info: string) {
    if (source.issue == null)
      source.issue = [];
    else if (source.issue.length > this.config.sourceIssueMaxNumber - 1)
      source.issue.pop();

    const processingInfo: ProcessingIssue = {
      issuer: this.getServiceId(),
      type: reason,
      info: info?.substr(0, 255),
    };

    source.issue.unshift(processingInfo);

    return processingInfo;
  }

  // ________________________________________________________________________________
  //
  //  Management of update events via Streams
  // ________________________________________________________________________________


  private sourceTable: KTable;

  /**
   * Init all kafka streams & tables required by this service
   */
  async initStreams(): Promise<void> {
    this.logger.debug('Init Source Streams & Tables');

    // Source Polling events Logging
    if (this.config.appRunMode !== EConfigRunMode.PROD) {
      await KafkaUtils.initKStreamWithLogging(this.streamFactory, ETopic.SOURCE_POLLING, this.logger)
        .catch((error) => {
          throw new Error('Failed to init kStream for logging Source Polling records \n' + error);
        });
    }

    // Source config kTable
    await this.initKTableSourceConfig()
      .then((result: KTable) => {
        this.sourceTable = result;
      })
      .catch((error) => {
        throw new Error('Failed to init kTable on Source config \n' + error.stack);
      });

    await this.mergeSourcePollingToConfig();

    this.logger.log('Source Streams & Tables started');
    if (this.config.appRunMode !== EConfigRunMode.PROD) {
      this.logger.debug(JSON.stringify(this.streamFactory.getStats()));
//      console.dir(this.streamFactory.getStats());
    }
  }

  /**
   * Initialization of a kTable on Source, as a data Feed source
   * 
   * @returns created kTable or an error met during that process
   */
  async initKTableSourceConfig(): Promise<KTable> { // void
    const topicName = ETopic.SOURCE_CONFIG;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');

    const keyMapperEtl = message => {
      const sourceConfig: FeedConfigSource = JSON.parse(message.value.toString());
      const feedSourceWrap: FeedSourceConfigWrap = {
        feedId: message.key.toString('utf8'),
        source: sourceConfig,
      }
      this.logger.debug('Wrapped Source config kTable \'' + topicName + '\' entry\n' + JSON.stringify(feedSourceWrap));
      return {
        key: sourceConfig.contract,
        value: feedSourceWrap
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    //const outputStreamConfig: KafkaStreamsConfig = null;
    await topicTable.start(
      () => {
        this.logger.debug('kTable on \'' + topicName + '\' ready. Started');
      },
      (error) => {
        //this.logger.error('Failed to start kTable for \'' + topicName + '\'\n' + error);
        throw new Error('' + new Error('Failed to init kTable for \'' + topicName + '\' \n' + error));
      },
      // false,
      // outputStreamConfig
    );

    return topicTable;
  }

  /**
   * Initiate a stream responsible for merging source polling updates into the feed source config
   * @returns The created source polling stream or an error met during that init process
   */
  async mergeSourcePollingToConfig(): Promise<KStream> { // void
    const sourcePollingTopic = ETopic.SOURCE_POLLING;
    const sourcePollingStream: KStream = this.streamFactory.getKStream(sourcePollingTopic);

    sourcePollingStream
      .mapJSONConvenience()
      .forEach(async (sourcePollingRecord) => {
        const sourceId = sourcePollingRecord.key?.toString('utf8');
        const sourcePollingInfo: SourcePollingInfo = sourcePollingRecord.value;
        this.logger.debug('Processing source polling \'' + sourcePollingInfo.source + '\' for merging in source \'' + sourceId + '\'');
        if (sourceId === undefined)
          throw new Error('Source polling record on \'' + sourcePollingTopic + '\' has no source ID key \n' + JSON.stringify(sourcePollingRecord));

        const sourceConfigMergeResult = await this.loadSourceFromTable(sourceId)
          .then(async (feedSourceWrap: FeedSourceConfigWrap) => {
            if (feedSourceWrap === undefined)
              throw new Error('No target source config \'' + sourceId + '\' found for merging source polling \'' + sourcePollingInfo.source + '\'');

            //this.logger.log('Merging\nSource polling info:\n' + JSON.stringify(contractPollingInfo) + '\nin Source config:\n' + JSON.stringify(contractConfig));
            const sourceConfig = feedSourceWrap.source;
            try {
              const newHandleRes = this.reviewSourceHandling(sourceConfig.handle, sourcePollingInfo);
              sourceConfig.handle = newHandleRes;
            } catch (error) {
              throw new Error('Failed to review Source polling handle for \'' + feedSourceWrap.feedId + '\' \n' + error);
            }

            this.logger.log('Source \'' + sourcePollingInfo.source + '\' merged into feed \'' + sourceId + '\' - Casting source update');
            return await this.castSourceConfig(ETopic.SOURCE_CONFIG, feedSourceWrap.feedId, sourceConfig,
              ESourceCastReason.HANDLING_SUCCESS, 'Update Source data handling')
              .catch((error) => {
                throw new Error('Failed to cast merged feed-source config \'' + sourceId + '\'\n' + error)
              });
          })
          .catch((error) => {
            return new Error('Failed to merge source polling info into Source config \'' + sourceId + '\' \n' + JSON.stringify(sourcePollingInfo) + ' \n\n' + error);
          });

        if (sourceConfigMergeResult instanceof Error)
          KafkaUtils.castError(ETopic.ERROR_SOURCE, EErrorType.SOURCE_CONFIG_MERGE_FAIL, sourceId, sourcePollingRecord, sourceConfigMergeResult, 'Failed to merge Source polling info into config', undefined, this.logger);
      });

    await sourcePollingStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + sourcePollingTopic + '\' for merging polling-source ready. Started');
      },
      (error) => { // kafka error callback
        throw new Error('Kafka Failed to run merge-source-polling Stream on \'' + sourcePollingTopic + '\' \n' + error.stack);
      },
      // false,
      // outputStreamConfig
    )

    return sourcePollingStream;
  }

  /**
   * Review a Source handles against a source polling change: validate and compute the updated handles' state
   * 
   * @param _actual Actual source's handle as defined in the feed config Source
   * @param sourcePolling source polling info to process
   * @returns updated source's handle entries
   */
  // TODO Enhance the restriction & error handling on unexpected sources' polling un-/registration
  reviewSourceHandling(_actual: FeedSourceHandle[], sourcePolling: SourcePollingInfo)
    : FeedSourceHandle[] {
    const issuer = sourcePolling.issuer;

    const sourceHandle = _actual === undefined ? [] : _actual;
    const alreadyPolledByIssuer: EFeedSourcePoll[] = [];
    sourceHandle.forEach((handle: FeedSourceHandle) => {
      if (handle.handler === issuer) {
        alreadyPolledByIssuer.push(handle.type);
      }
    });

    const source = sourcePolling.source;

    // Register a new source polling
    if (sourcePolling.change === ESourcePollingChange.ADD_LISTEN_EVENT
      || sourcePolling.change === ESourcePollingChange.ADD_PERIODIC) {

      const handleUpd: FeedSourceHandle[] = deepCopyJson(sourceHandle);
      let pollingType: EFeedSourcePoll;
      if (sourcePolling.change === ESourcePollingChange.ADD_LISTEN_EVENT) {
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          const msg = 'Unexpected re-declaration of an event-based polling of \'' + source + '\' by the already handling \'' + issuer + '\'';
          if (this.config.sourcePollingAllowMultipleBySameIssuer)
            throw new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + source + '\'';
          if (this.config.sourcePollingAllowMultipleTypeBySameIssuer)
            throw new Error(msg);
          else
            this.logger.warn(msg);
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (sourcePolling.change === ESourcePollingChange.ADD_PERIODIC) {
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Unexpected re-declaration of a periodic polling of \'' + source + '\' by the already registered \'' + issuer + '\'';
          if (this.config.sourcePollingAllowMultipleBySameIssuer)
            throw new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + source + '\'';
          if (this.config.sourcePollingAllowMultipleTypeBySameIssuer)
            throw new Error(msg);
          else
            this.logger.warn(msg);
        }
        pollingType = EFeedSourcePoll.TIMEPERIOD;
      }

      handleUpd.unshift({
        handler: issuer,
        type: pollingType,
        time: new Date().toISOString(), // TODO Date for source handle info: change to number
      });

      this.logger.log('Handler \'' + issuer + '\' will register as poller \'' + pollingType + '\' for source \'' + source + '\'');
      return handleUpd;
    }

    // Unregister/remove a source polling
    if (sourcePolling.change === ESourcePollingChange.REMOVE_LISTEN_EVENT
      || sourcePolling.change === ESourcePollingChange.REMOVE_PERIODIC) {

      let pollingType: EFeedSourcePoll;
      if (sourcePolling.change === ESourcePollingChange.REMOVE_LISTEN_EVENT) {
        if (!alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          throw new Error('Unexpected removal of an event-based polling of \'' + source + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (sourcePolling.change === ESourcePollingChange.REMOVE_PERIODIC) {
        if (!alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          throw new Error('Unexpected removal of a periodic polling of \'' + source + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
        }
        pollingType = EFeedSourcePoll.TIMEPERIOD;
      }

      const handleUpd: FeedSourceHandle[] = [];
      sourceHandle.forEach((element: FeedSourceHandle) => {
        if (!(element.handler === issuer && element.type === pollingType))
          handleUpd.push(deepCopyJson(element));
      });

      this.logger.debug('Handler \'' + issuer + '\' de-registered as polling \'' + pollingType + '\' source \'' + source + '\'');
      return handleUpd;
    }

    throw new Error('Unknow Source Polling Change \'' + sourcePolling.change + '\' for \'' + source + '\'. Not supported');
  }

  /**
   * Load a source config, wrappred with its feedId, from a kTable, based on a source address
   * @param keyId source address
   * @param kTable optional overriding of the target kTable instance to query
   * @param entityName optional overriding of the entity name used for logging
   * @returns result of the search in the kTable
   */
  async loadSourceFromTable(keyId: string, kTable: KTable = this.sourceTable, entityName = 'Wrapped Source config')
    : Promise<FeedSourceConfigWrap> {
    // this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
    // this.logger.debug('kTable info\n== Stats:\n'+ JSON.stringify(kTable.getStats()) +'\n== State:\n' + JSON.stringify(kTable.getTable()));
    return await kTable.getStorage().get(keyId)
      .then((sourceFeedWrap: FeedSourceConfigWrap) => {
        if (!sourceFeedWrap) {
          this.logger.debug('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        if (!sourceFeedWrap.feedId || !sourceFeedWrap.source)
          throw new Error('Invalid feed-wrapped Source config \'' + keyId + '\'\n' + JSON.stringify(sourceFeedWrap));
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' in kTable');
        if (this.config.appRunMode !== EConfigRunMode.PROD)
          this.logger.debug(JSON.stringify(sourceFeedWrap));
        return sourceFeedWrap;
      })
      .catch((error) => {
        throw new Error('Failed to extract ' + entityName + ' \'' + keyId + '\' from kTable \n' + error);
      });
  }

  // ________________________________________________________________________________
  //
  //  Management of update events via Messages
  // ________________________________________________________________________________

  /**
   * Cast a message about a feed source, any config update
   * 
   * @param feedConfigId the feed ID the Source belongs to
   * @param source the source config
   * @param reason reason code of the source update
   * @param info optional info about that update, e.g. free description text, error
   * @returns either the casting record metadata or a processing error
   */
  async castSourceConfig(topic: ETopic, feedConfigId: string, source: FeedConfigSource, reason: ESourceCastReason, info?: string)
    : Promise<RecordMetadata[]> {
    const issueNote = this.issueSourceProcessingNote(source, reason, info);

    await validate(source) // FIXME have source config validation prior to casting , VALID_OPT
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Source Config update \n' + JSON.stringify(validationError));
        return [];
      })
      .catch((error) => {
        throw new Error('Failed to validate Source Config update for \'' + source?.contract + '\' by \'' + issueNote.issuer + '\' \n' + error);
      });

    return await this.clientKafka.connect()
      .then(async (producer) => {
        return producer.send({
          topic: topic,
          messages: [
            {
              key: feedConfigId,
              value: JSON.stringify(source), // TODO Review Serialization format
            },
          ],
        })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Source record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
      })
      .catch((error: Error) => {
        throw new Error('Failed castSourceConfig for source \'' + source?.contract + '\' of feed \'' + feedConfigId + '\' (' + reason + ': ' + info + ') \n' + error);
      });
  }

  async castErrorSourceConfig(errorType: EErrorType, sourceConfig: FeedConfigSource, feedId: string, prevError: any) {
    const errorInfo = {
      type: errorType,
      input: sourceConfig,
      message: 'Failure with Source \'' + sourceConfig.contract + '\' config handling for \'' + feedId + '\'',
      error: '' + prevError,
    };

    const errorInfoJson = JSON.stringify(errorInfo);
    this.logger.error('Source processing Error\n' + errorInfoJson);
    if (this.config.appRunMode === EConfigRunMode.DEV_LOCAL)
      console.dir(errorInfo);

    return await this.castSourceConfig(ETopic.ERROR_CONFIG, feedId, sourceConfig,
      ESourceCastReason.HANDLING_FAILED, errorInfoJson)
      .then((castResult) => {
        if (this.config.appRunMode !== EConfigRunMode.PROD)
          castResult.forEach((entry: RecordMetadata) => {
            this.logger.debug('Sent Source config Error record\n' + JSON.stringify(entry));
          });
      })
      .catch((error) => {
        throw new Error('Failed to cast source config Error \'' + errorType + '\'/\'' + ESourceCastReason.HANDLING_FAILED + '\' for source \'' + sourceConfig.contract + '\' of feed \'' + feedId + '\'\nInitial Error: ' + JSON.stringify(errorInfo) + '\n\n' + error);
      });
  }

  /**
   * Send a message to update on the handling of a source data polling
   * @param topic  
   * @param sourceId 
   * @param changeType 
   * @param info 
   * @returns 
   */
  async castSourcePolling(topic: ETopic, sourceId: string, changeType: ESourcePollingChange, info?: string)
    : Promise<RecordMetadata[]> {
    const updateIssuer = this.getServiceId();

    const sourcePollingUpdate: SourcePollingInfo = {
      source: sourceId,
      issuer: updateIssuer,
      change: changeType,
      info: info,
    };

    await validate(sourcePollingUpdate) // FIXME Fix source polling update validation , VALID_OPT
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Source Polling update \n' + JSON.stringify(validationError));
      })
      .catch((error) => {
        throw new Error('Failed to validate Source Polling Update for \'' + sourceId + '\' from \'' + updateIssuer + '\' \n' + error);
      });

    return await this.clientKafka.connect()
      .then(async (producer) => {
        return await producer.send(
          {
            topic: topic,
            messages: [
              {
                key: sourceId,
                value: JSON.stringify(sourcePollingUpdate), // TODO Review Serialization format
              },
            ],
          })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Source Polling record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          });
      })
      .catch((error: Error) => {
        throw new Error('Failed to cast Source Polling update by \'' + updateIssuer + '\' for source \'' + sourceId + '\' \n' + error);
      });
  }

  /**
   * 
   * @param feedId 
   * @param sourceId 
   * @param sourceData 
   * @param reason 
   * @param info 
   * @param topic 
   * @returns 
   */
  async castSourceDataUpdate(feedId: string, sourceId: string, sourceData: FeedSourceData,
    reason: ESourceDataUpdateReason, info?: string, topic: ETopic = ETopic.SOURCE_DATA)
    : Promise<RecordMetadata[]> {
    const sourceUpd: FeedSourceDataUpdate = {
      feedId: feedId,
      sourceId: sourceId,
      source: sourceData,
      reason: reason,
      info: info,
    };
    return await this.clientKafka.connect()
      .then(async (producer) => {
        return await producer.send({
          topic: topic,
          messages: [
            {
              key: sourceId,
              value: JSON.stringify(sourceUpd), // TODO Review Serialization format
            },
          ],
        })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach((element) => {
              this.logger.debug('Sent Source Data record: ' + JSON.stringify(element));
            });
            return recordMetadata;
          });
      })
      .catch((error: Error) => {
        throw new Error('Failed to cast Source Data Update for \'' + sourceId + '\' \n' + error);
      });
  }


  // ________________________________________________________________________________
  //
  //  Source Management
  // ________________________________________________________________________________

  /**
   * Process a Source, depending on its config status
   * 
   * @param sourceConfigIni Source config to be handled
   * @returns Updated Source config to reflect any state changes, or corresponding processing error
   */
  async handleSourceContract(sourceConfigIni: FeedConfigSource, feedId: string): Promise<FeedConfigSource> {
    this.logger.debug("Handling source '" + sourceConfigIni.contract + "' with status '" + sourceConfigIni.status + "' for feed '" + feedId + "'");

    const sourceConfig: FeedConfigSource = deepCopyJson(sourceConfigIni);
    switch (sourceConfig.status) {

      // New Source initialization: validation
      case ESourceStatus.INI:
        return await this.validateSourceContract(sourceConfig)
          .then(async (result: FeedSourceData) => {
            // Validation of fetched source data
            this.logger.debug('VALIDATE\n' + JSON.stringify(result));
            return await validate(result) // FIXME Fix the validation issue on Source Data, VALID_OPT
              .then((validationError) => {
                if (validationError && validationError.length > 0) {
                  // Validation partial / issue(s) met
                  sourceConfig.status = ESourceStatus.PARTIAL;
                  this.issueSourceProcessingNote(sourceConfig, ESourceCastReason.HANDLING_VALIDATION_PARTIAL, JSON.stringify(validationError))
                  this.logger.warn("Source '" + sourceConfig.contract + "' (" + sourceConfig.type
                    + ") is partially Valid. Status: " + sourceConfig.status + '\n' + JSON.stringify(validationError));
                } else {
                  // Validation OK
                  sourceConfig.status = ESourceStatus.OK;
                  if (!sourceConfig.data)
                    sourceConfig.data = result;
                  else
                    Object.assign(sourceConfig.data, result);
                  this.logger.log("Source '" + sourceConfig.contract + "' (" + sourceConfig.type +
                    ") is VALID. Status: " + sourceConfig.status);
                }
                return sourceConfig;
              })
              .catch((error) => {
                throw new Error('Failed to validate fetched data of \'' + sourceConfig.contract + '\' validation\n' + error)
              });
          })
          .catch((error) => {
            const msg = 'Validation failed for Source \'' + sourceConfig.contract
              + '\'. Status: ' + sourceConfig.status + ' \n' + error;
            throw new Error(msg);
          });
        break;

      // Source validated & ready for data polling
      case ESourceStatus.OK:
        this.logger.log('Initiate data polling for \'' + sourceConfig.contract + '\' of type \'' + sourceConfig.type + '\' Polling mode: ' + sourceConfig.poll);

        // Check that this source polling is not already handled by the same owner
        const toPoll = this.checkIfDataPollingRequired(sourceConfig);
        if (toPoll === undefined || toPoll.length === 0) {
          this.logger.log('No additional data polling required for \'' + sourceConfig.contract + '\'. Feed Source polling OK');
        }
        else {
          // Launch the polling process
          const pollingInitResult = await this.initiateSourceDataPolling(sourceConfig, feedId)
            .then((result) => {
              this.logger.log('Data polling \'' + sourceConfig.poll + '\' of \'' + sourceConfig.contract + '\' for feed \'' + feedId + '\' initiated by \'' + this.getServiceId() + '\'');
              return result;
            })
            .catch((error) => {
              return new Error('Failed to initiate data polling for source \'' + sourceConfig.contract + '\' \n' + error);
            });

          if (pollingInitResult instanceof Error)
            await this.castErrorSourceConfig(EErrorType.SOURCE_POLLING_HANDLE_FAIL, sourceConfig, feedId,
              new Error('Initiation of data polling for \'' + sourceConfig.contract + '\' has failed \n' + pollingInitResult));
        }
        return undefined;

      case ESourceStatus.PARTIAL:
      default:
        throw new Error("Status '" + sourceConfig.status + "' of Source '" +
          sourceConfig.contract + "' is not supported",
        );
    }
  }

  checkIfDataPollingRequired(source: FeedConfigSource): EFeedSourcePoll {
    const pollingStatus = this.extractContractPollingStatus(source);
    if (pollingStatus.handling.length > 0 && (!this.config.sourcePollingAllowMultipleBySameIssuer
      || pollingStatus.handling.includes(source.poll) && !this.config.sourcePollingAllowMultipleTypeBySameIssuer)) {
      throw new Error('Instance \'' + pollingStatus.issuer + '\' already polls the data of Source \'' + source.contract + '\'\n' + JSON.stringify(pollingStatus.handling));
    }

    switch (source.poll) {
      case EFeedSourcePoll.EVENT:
        if (pollingStatus.listener < this.config.sourceNbEventListener)
          return EFeedSourcePoll.EVENT;
        break;
      case EFeedSourcePoll.TIMEPERIOD:
        if (pollingStatus.querier < this.config.sourceNbPeriodicQuerier)
          return EFeedSourcePoll.TIMEPERIOD;
        break;
      default:
        throw new Error('Unknown source polling type: ' + source.poll + '\'. Review config of Source \'' + source.contract + '\'');
        break;
    }
    return undefined;
  }

  extractContractPollingStatus(source: FeedConfigSource) {
    const actor = this.getServiceId();

    let countPollingPeriodic = 0;
    let countPollingEvent = 0;
    const handling: EFeedSourcePoll[] = [];
    source.handle?.forEach((handle: FeedSourceHandle) => {
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
  // Source Data Polling
  // ____________________________________________________________________________________


  /**
   * Initialization of a source data polling, based a time schedule or by listening to update events
   * 
   * @param sourceConfig Config of the source to poll
   * @returns initiated time out
   */
  async initiateSourceDataPolling(sourceConfig: FeedConfigSource, feedId: string): Promise<NodeJS.Timeout> {
    let result;
    if (sourceConfig.poll === EFeedSourcePoll.TIMEPERIOD) {
      const timePeriod = sourceConfig.period;
      if (!isPositive(timePeriod))
        throw new Error('Invalid time period specified for periodic data polling: ' + timePeriod);

      const contract = this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
      result = await this.loadContractDecimals(contract)
        .then(async (contractDecimals) => {
          const convertOpts: ConversionConfig = { decimals: contractDecimals };
          const pollingTimeout = this.startPollingData(sourceConfig, feedId, convertOpts, contract);
          await this.trackSourcePolling(sourceConfig.contract, pollingTimeout)
            .then((castRes) => {
              castRes.forEach((record) => {
                this.logger.debug('Cast Source polling tracking record: ' + JSON.stringify(record));
              });
            });
          return pollingTimeout;
        })
        .catch((error) => {
          throw new Error('Failed to initiate Source Data Polling of type \'' + EFeedSourcePoll.TIMEPERIOD + '\' on \'' + sourceConfig.contract + '\' \n' + error);
        });
    }
    else if (sourceConfig.poll === EFeedSourcePoll.EVENT) {
      let sourceContract: Contract;
      const tmpContract = this.initContractClAggregator(sourceConfig.contract, sourceConfig.type, this.provider);
      if (sourceConfig.type === EFeedSourceType.CL_AGGR_PROX)
        sourceContract = await this.loadClProxyContractAggregator(tmpContract)
          .catch(error => {
            throw new Error('Failed to load Cl Proxy aggregator contract from \'' + sourceConfig?.contract + '\' \n' + error)
          });
      else
        sourceContract = tmpContract;

      const eventSig = sourceConfig.event === EFeedSourceEvent.CUSTOM ? sourceConfig.eventSignature : sourceConfig.event;
      await this.loadContractDecimals(sourceContract)
        .then(async (contractDecimals) => {
          const contractListened = this.listenToContractEvent(feedId, sourceConfig.contract, sourceContract, eventSig, contractDecimals);
          await this.trackSourceEventListener(sourceConfig.contract, contractListened);
        })
        .catch(error => {
          this.stopSourceEventListener(sourceConfig.contract, ESourcePollingChange.REMOVE_LISTEN_EVENT, 'Listener init by \'' + this.getServiceId() + '\' failed');
          throw new Error('Failed to initiate event listener on Source \'' + sourceConfig.contract + '\' \n' + error);
        });
    }
    else
      throw new Error('Source polling \'' + sourceConfig.poll + '\' NOT SUPPORTED\nReview config of Source \'' + sourceConfig.contract + '\' for feed \'' + feedId + '\'');

    return result;
  }

  /**
   * Initiate an asynchonous thread responsible for regularly, time period based, request
   * for a source data. Corresponding data checks or value changes get reported.
   * 
   * @param sourceConfig Config of the Source to be polled
   * @param convertOpts Extracted value (latestRoundData) conversion options
   * @param contractSrc Optional source instance. If not specified, a new one is created
   * @returns the initiated TimeOut / polling interval ID
   */
  private startPollingData(sourceConfig: FeedConfigSource, feedId: string, convertOptions: ConversionConfig, contractSrc?: Contract): NodeJS.Timeout {

    const loadContractData = (handler: EthConnectService,
      contract: Contract, feedId: string, notifOn: string, convertOpts: ConversionConfig, timePeriod: number,
      pollingErrorCounter: number, maxError: number = this.config.maxSuccessiveErrorToStopPolling - 1) =>
      async () => {
        this.logger.debug('Polling of latest round data from contract \'' + contract.address + '\' triggered');
        const result = await handler.loadContractLatestRoundData(contract, convertOpts, true)
          .then(async (result: FeedSourceData) => {
            //this.logger.debug('Polled data from Source \''+contract.address+'\'\n'+JSON.stringify(result));
            if (notifOn === EFeedSourceNotifOn.CHECK) {
              result.time = ConvertContractUtils.convertValue((Date.now() / 1000), ValueType.DATE, { date: ValueTypeDate.default });
              return await handler.castSourceDataUpdate(feedId, contract.address, result, ESourceDataUpdateReason.PERIODIC)
                .catch(error => { throw new Error('Failed to cast Source Data regular update for \'' + feedId + '\' \n' + error); });
            }
            else if (notifOn === EFeedSourceNotifOn.CHANGE) {
              const hasChanged = handler.checkForSourceDataChange(contract.address, result, timePeriod);
              if (hasChanged) {
                //this.logger.log('Value of \''+sourceConfig.contract+'\' has changed: Reporting corresponding Source data update');
                return await handler.castSourceDataUpdate(feedId, contract.address, result, ESourceDataUpdateReason.DATA_CHANGE)
                  .catch(error => { throw new Error('Failed to cast Source Data change update for \'' + feedId + '\' \n' + error); });
              }
              return [];
            }
            else
              throw new Error('Unsupported source data change notification mode\nReview config notifOn=' + notifOn + ' in \'' + sourceConfig.contract + '\' of feed \'' + feedId + '\'');
          })
          .catch((error) => {
            return new Error('Failed to poll data for Source \'' + contract?.address + '\' of feed \'' + feedId + '\' \n' + error);
          });

        if (result instanceof Error) {
          if (++pollingErrorCounter >= maxError) {
            const msg = 'Failed to poll data from Source \'' + contract?.address + '\' Stop polling after ' + pollingErrorCounter + ' successive errors. Last:\n' + result;
            await handler.stopSourcePolling(contract.address, ESourcePollingChange.REMOVE_PERIODIC, msg)
              .then((stopResult) => {
                if (this.config.appRunMode !== EConfigRunMode.PROD)
                  stopResult.forEach(record => {
                    this.logger.debug('Cast Stop polling source on Error. Record: ' + JSON.stringify(record));
                  });
              })
              .catch(async (error) => {
                await this.castErrorSourceConfig(EErrorType.SOURCE_POLLING_HANDLE_FAIL, sourceConfig, feedId,
                  new Error('Failure while stopping Source Polling \n' + error + '\n' + msg));
              });
          }
          else
            handler.logger.warn('Failed to poll data of Source \'' + contract?.address + '\' for feed \'' + feedId + '\' Attempt' + pollingErrorCounter + '/' + maxError + ' \n' + result);
        }
      };

    const contract: Contract = contractSrc ? contractSrc : this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
    const timeout: NodeJS.Timeout = setInterval(loadContractData(this, contract, feedId, sourceConfig.notif, convertOptions, sourceConfig.period, 0), sourceConfig.period * 1000);

    return timeout;
  }

  /** 
   * Instance specific map of running source data pulling threads
   */
  private sourcePolling: Map<string, {
    /** Last retrieved source data */
    data: FeedSourceData;
    /** polling process's timeout hook */
    timeout: NodeJS.Timeout;
  }> = new Map();

  getSourcePolled(): string[] {
    return [...this.sourcePolling.keys()];
  }

  /** 
   * Instance specific map of running source contracts' event listener
   */
  private sourceListening: Map<string, {
    /** Last emitted source data */
    data: FeedSourceData;
    /** listened contract instance */
    contract: Contract;
  }> = new Map();

  getSourceListened(): string[] {
    return [...this.sourceListening.keys()];
  }

  checkForSourceDataChange(sourceId: string, sourceData: FeedSourceData, pollingPeriod?: number): boolean {
    // Caution: retrieved source data are considered as valid here
    const previous = this.sourcePolling.get(sourceId);
    if (previous === undefined)
      throw new Error('Inconsistent state: no source \'' + sourceId + '\' registered for polling. Actual: ' + this.getSourcePolled.toString());

    const previousData = previous.data;
    if (previousData === undefined || previousData.value !== sourceData.value) {
      this.logger.log('Value change detected for Source \'' + sourceId + '\': ' + sourceData.value);

      if (pollingPeriod) {
        const changeDetectionTimeMs: number = Date.now(); //convertContractInputValue(Date.now(), ValueType.DATE);
        const timeReportedAsUpdatedMs: number = new Date(sourceData.time).valueOf(); // TODO Review data time format integration here, if number or isoString
        if (changeDetectionTimeMs > (timeReportedAsUpdatedMs + pollingPeriod * 1000 + 1500))
          this.logger.warn('Review Lag between source value change time and its detection. Took '
            + (timeReportedAsUpdatedMs - changeDetectionTimeMs) / 1000 + 's while the polling period is set to ' + pollingPeriod);
      }

      this.sourcePolling.set(sourceId, { data: sourceData, timeout: previous.timeout });
      return true;
    }
    return false;
  }

  private async trackSourcePolling(sourceId: string, timeout: NodeJS.Timeout): Promise<RecordMetadata[]> {
    const existing = this.sourcePolling.get(sourceId);
    if (existing && !this.config.sourcePollingAllowMultipleBySameIssuer)
      throw new Error('Attempt to register a second polling of same Source on same node instance for \'' + sourceId + '\'');

    this.sourcePolling.set(sourceId, { timeout: timeout, data: undefined });

    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, ESourcePollingChange.ADD_PERIODIC, 'Periodic Source polling started');
  }

  /**
   * Stop the polling process for a source data, and report it
   * 
   * @param sourceId source ID
   * @param reasonCode reason code for stopping the data polling
   * @param reasonMsg 
   * @returns 
   */
  private async stopSourcePolling(sourceId: string, reasonCode: ESourcePollingChange, reasonMsg?: string): Promise<RecordMetadata[]> {
    const timeout = this.sourcePolling.get(sourceId)?.timeout;
    if (timeout === undefined)
      throw new Error('Requesting to stop a non-registered source polling \'' + sourceId + '\'. Actual: ' + this.getSourcePolled().toString());

    this.logger.warn('Stopping periodic polling of source \'' + sourceId + '\'. Reason: ' + reasonCode + ' ' + reasonMsg);
    //timeout.unref();
    clearInterval(timeout);
    this.sourcePolling.delete(sourceId);
    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, reasonCode, reasonMsg);
  }

  /**
   * Stop all source data polling performed by this service instance
   * @returns promises on the casting of all actual sources' polling stop requests
   */
  async stopAllSourcePolling() {
    const polledSources = this.getSourcePolled();
    this.logger.debug('Stopping data polling on all sources: ' + polledSources);

    return await Promise.all(polledSources.map(async (contractAddr: string) => {
      await this.stopSourcePolling(contractAddr, ESourcePollingChange.REMOVE_PERIODIC, 'Service \'' + this.getServiceId() + '\' shutting down')
        .catch(async (error) => {
          await KafkaUtils.castError(ETopic.ERROR_SOURCE, EErrorType.SOURCE_POLLING_HANDLE_FAIL, contractAddr, undefined, error, 'Failed to properly stop polling source data', undefined, this.logger);
          //this.logger.error('Failed to stop contracts polling properly \n' + error);
        });
    }));
  }

  /**
   * Load the latestRoundData of a Chainlink Aggregator contract
   * @param source Chainlink EACAggregatorProxy or AccessControlledOffchainAggregator source (defining 'latestRoundData')
   * @param convertOpts Optional. Specify if the extracted source value(s) are to be converted
   * @param validate Validate or not the extracted values (default: false)
   * @returns source latestRoundData data set
   */
  async loadContractLatestRoundData(
    contract: Contract,
    convertOpts?: ConversionConfig,
    validate?: boolean,
  ): Promise<FeedSourceData> {
    this.logger.debug("Fetching latestRoundData of '" + contract.address + "'");
    return await contract.functions
      .latestRoundData()
      .then((result: Result) => {
        const lastValueRaw = result[EResultFieldLatestRoundData.VALUE];
        const lastValue: number = ConvertContractUtils.convertValue(lastValueRaw, ValueType.PRICE, convertOpts);

        const lastValueTimeRaw = result[EResultFieldLatestRoundData.UPDATE_TIME];
        const lastValueTime: string = ConvertContractUtils.convertValue(lastValueTimeRaw, ValueType.DATE, convertOpts);

        const lastValueRoundRaw = result[EResultFieldLatestRoundData.ROUND];
        const lastValueRound: number = ConvertContractUtils.convertValue(lastValueRoundRaw.toString(), ValueType.NUMBER, convertOpts);

        this.logger.debug('Value retrieved from ' + contract.address + ": '" +
          lastValue + ' / ' + lastValueRaw + "' (" + typeof lastValue + ") updated at " + lastValueTime + ' / ' + lastValueTimeRaw + ' (' + typeof lastValueTime + '). Round '+lastValueRound);

        // Validate the value
        if (validate && !isPositive(lastValue)) { // TODO Review that limitation to source value type = number
          throw new Error("Invalid value for field '" + EResultFieldLatestRoundData.VALUE +
            "' from source '" + contract.address + "' latestRoundData: " + lastValue + ' / ' + lastValueRaw,
          );
        }

        // Validate the last update date
        if (validate && !(isDateString(lastValueTime) || isDate(lastValueTime))) {
          throw new Error('Invalid value for field \'' + EResultFieldLatestRoundData.UPDATE_TIME +
            '\' from source \'' + contract.address + '\' latestRoundData: ' + lastValueTime + ' / ' + lastValueTimeRaw,
          );
        }
        const dateLastUpdate: number = new Date(lastValueTime).valueOf();
        const dateNow: number = Date.now();
        if (validate && dateLastUpdate < dateNow - this.config.sourceDataLastUpdateMaxDays * 24 * 60 * 60 * 1000) {
          throw new Error('Last data update is older than ' + this.config.sourceDataLastUpdateMaxDays + ' days: ' + lastValueTime + '. Source considered as stall');
        }

        return {
          value: lastValue,
          time: lastValueTime,
          round: lastValueRound,
        };
      })
      .catch((error) => {
        throw new Error('Failed to fetch latestRoundData for \'' + contract?.address + '\' \n' + error);
      });
  }


  //  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  // async queryContractLatestRoundData(
  //   key: string,
  //   contract: Contract,
  //   resultCollector?: Map<string, Result>,
  // ): Promise<Result> {
  //   return await contract.functions
  //     .latestRoundData()
  //     .then((result: Result) => {
  //       resultCollector?.set(key, result);
  //       //this.logger.debug('latestRoundData for ' + key + ': ' + result);
  //       return result;
  //     })
  //     .catch((error) => {
  //       throw new Error('Failed to fetch latestRoundData for \'' + key + '\' \n' + error);
  //     });
  // }

  /**
   * Load the aggregator controller source of a Chainlink EACAggregator Proxy contract
   * @param source Chainlink EACAggregatorProxy source (defining an 'aggregator')
   * @returns Chainlink AccessControlledOffchainAggregator contract
   */
  async loadClProxyContractAggregator(contract: Contract): Promise<Contract> {
    this.logger.debug("Fetching Aggregator source of '" + contract.address + "'");
    return await contract.functions
      .aggregator()
      .then((aggrAddrRaw) => {
        const aggrAddr: string = '' + aggrAddrRaw;
        if (!isEthereumAddress(aggrAddr)) {
          throw new Error('Invalid ClAggregator address: ' + aggrAddr);
        }
        return this.initContractClAggregator(aggrAddr, EFeedSourceType.CL_AGGR);
      })
      .catch((error) => {
        throw new Error("Failed to fetch Aggregator source of '" + contract.address + "'\n" + error);
      });
  }

  /**
   * Load a source decimals' value
   * @param source target source defining a decimals
   * @returns decimals value
   */
  async loadContractDecimals(contract: Contract): Promise<number> {
    return await contract.functions
      .decimals()
      .then((result) => {
        const decimals: number = +result[0];
        this.logger.debug('Decimals for ' + contract.address + ': ' + decimals);
        if (!isPositive(decimals))
          throw new Error('Invalid decimals \'' + decimals + '\' in source \'' + contract.address + '\'');
        return decimals;
      })
      .catch((error) => {
        throw new Error('Failed to fetch decimals for ' + contract.address + '\n' + error);
      });
  }

  //
  // Source Data Polling
  // ____________________________________________________________________________________
  // ====================================================================================

  /**
   * Check the validity of a source contract, depending on its type
   * 
   * @param sourceConfig configuration of the Feed Source
   * @returns Data extracted from the source during its validation
   */
  async validateSourceContract(sourceConfig: FeedConfigSource): Promise<FeedSourceData> {
    const validationMode = this.config.sourceContractValidationMode;
    const address = sourceConfig.contract;
    if (address == undefined || !isEthereumAddress(address)) throw new Error('Source address is invalid: ' + address);

    const contractType = sourceConfig.type;
    this.logger.debug("Validating Source '" + address + "' of type '" + contractType + "' with status '" + sourceConfig.status+'\'');

    const pendingCheck: Array<{ type: EFeedSourceType, data: FeedSourceData | Error, event: FeedSourceData | Error }> = [];

    if (contractType === EFeedSourceType.CL_AGGR || contractType === EFeedSourceType.CL_AGGR_PROX) {
      const contract: Contract = this.initContractClAggregator(address);

      const contractDecimals: number = await this.loadContractDecimals(contract);

      const convertOpts: ConversionConfig = {
        decimals: contractDecimals,
        // commify: false,
        // date: ValueTypeDate.default,
      };

      if (contractType === EFeedSourceType.CL_AGGR_PROX) {
        const proxyAggregatorRes = await this.loadClProxyContractAggregator(contract)
          .then(async (contractAggr: Contract) => {
            let latestRoundData = undefined;
            // Data
            if (validationMode === ESourceValidMode.FULL) {
              latestRoundData = await this.loadContractLatestRoundData(contractAggr, convertOpts, true)
                .catch((error) => {
                  return new Error("Failed to fetch latestRoundData for validating sub-ClAggregator '" + contractAggr.address +
                    "' of '" + address + "' (" + contractType + ') \n' + error);
                });
            }
            // Events
            const lastEventData = await this.checkForContractEvent(sourceConfig, contractAggr, contractDecimals);
            return {
              type: EFeedSourceType.CL_AGGR,
              data: latestRoundData,
              event: lastEventData,
            }
          })
          .catch((error) => {
            throw new Error("Failed to validate sub-Aggregator of Source '" + address + "' (" + contractType + ') \n' + error);
          });

        pendingCheck.push(proxyAggregatorRes);
      }

      // Data
      let latestRoundData = undefined;
      if (sourceConfig.poll === EFeedSourcePoll.TIMEPERIOD || validationMode === ESourceValidMode.FULL) {
        latestRoundData = await this.loadContractLatestRoundData(contract, convertOpts, true)
          .then((result: FeedSourceData) => {
            result.decimals = contractDecimals;
            return result;
          })
          .catch((error) => {
            return new Error('Failed to validate latestRoundData for \'' + address + '\' (' + contractType + ')\n' + error);
          });
      }

      // Events
      let lastEventData;
      if ((sourceConfig.poll === EFeedSourcePoll.EVENT || validationMode === ESourceValidMode.FULL)
        && contractType !== EFeedSourceType.CL_AGGR_PROX)
        lastEventData = await this.checkForContractEvent(sourceConfig, contract, contractDecimals);

      pendingCheck.push({
        type: contractType,
        data: latestRoundData,
        event: lastEventData,
      });
    }
    else {
      throw new Error('Unsupported type of contract: ' + contractType);
    }

    const aggrRes: FeedSourceData = { value: -1, time: '' };
    pendingCheck.forEach(result => {
      if (sourceConfig.poll === EFeedSourcePoll.TIMEPERIOD) {
        if (result.data instanceof Error)
          throw new Error('Failed to validate Source \'' + sourceConfig.contract + '\' for periodic data polling \n' + result.data); // JSON.stringify(contractConfig)
        if (result.data !== undefined)
          Object.assign(aggrRes, result.data);
      }
      if (sourceConfig.poll === EFeedSourcePoll.EVENT) {
        if (result.event instanceof Error)
          throw new Error('Failed to validate Source \'' + sourceConfig.contract + '\' for listening to events \n' + result.event); // JSON.stringify(contractConfig)
        if (result.event !== undefined)
          Object.assign(aggrRes, result.event);
      }
    });
    this.logger.debug('Aggregated source data result: ' + JSON.stringify(aggrRes));
    await validateOrReject(aggrRes);
    return aggrRes;
  }

  /**
   * Instantiate a Chainlink EAC Aggregator Proxy or an Access Controlled Offchain Aggregator contract, bound to ETH
   * 
   * @param addrOrName the source ETH address or its ENS name
   * @param type Optional specification of the source type to associate its ABI. Default is 'EFeedSourceType.CL_AGGR_PROX'
   * @param provider Optional web3 provider for ETH
   * @returns ETH source instance ready to connect onchain
   */
  initContractClAggregator(
    addrOrName: string,
    type?: EFeedSourceType,
    provider?: ethers.providers.Provider,
  ): Contract {
    const abiContract = type == null || type == EFeedSourceType.CL_AGGR_PROX ? abiClAggregatorProxy : abiClAggregator;
    return new Contract(addrOrName, abiContract, provider || this.provider);
  }

  // ________________________________________________________________________
  // ========================================================================
  //
  //  Contract Events management
  //

  /**
   * Check if a contract has emitted events, if they are available in last blocks' records
   * 
   * @param sourceConfig configuration of the feed Source
   * @param contract instantiated ETH contract
   * @param validate validate or not the loaded events, implies that events must be found
   * @returns last event data loaded from the contract
   */
  private async checkForContractEvent(sourceConfig: FeedConfigSource, contract: Contract, decimals: number, validate = true)
    : Promise<FeedSourceData | Error> {
    let eventName: string;
    if (sourceConfig.event === EFeedSourceEvent.CUSTOM)
      eventName = sourceConfig.eventSignature;
    else
      eventName = sourceConfig.event;

    const eventLoadRes = await this.loadContractEvent(contract, eventName)
      .then((result) => {
        if (result === undefined || result.length === 0)
          return new Error('No events \'' + eventName + '\' found for \'' + contract.address + '\' over last blocks');
        return result;
      })
      .catch((error) => {
        return new Error('Failed to load events for \'' + contract.address + '\' \n' + error);
      });

    if (eventLoadRes instanceof Error)
      return eventLoadRes;

    let latestEvent = undefined;
    eventLoadRes.forEach(event => {
      const round = event.args[1]?.toNumber();
      if (latestEvent === undefined || round > latestEvent.args[1].toNumber())
        latestEvent = event;
    });
    const eventAnswerUpdated = ConvertContractUtils.convertEventAnswerUpdated(latestEvent, decimals);
    this.logger.debug('Last emitted event \'' + eventName + '\': ' + JSON.stringify(eventAnswerUpdated));

    if (validate) {
      if (eventLoadRes instanceof Error)
        throw new Error('Cannot perform data polling for \'' + contract.address + '\' based on event \'' + eventName + '\' \n' + eventLoadRes);

      //const lastEvent = undefined;// { } ConvertContractUtils.convertEventValue(eventRes[0], sourceConfig.event);
      await validateOrReject(eventAnswerUpdated); // TODO Make validation of extracted contract event stronger, VALID_OPT
    }

    return {
      value: eventAnswerUpdated.current,
      time: eventAnswerUpdated.updatedAt,
      round: eventAnswerUpdated.round,
    };
  }

  /**
   * Query past events on a contract
   * 
   * Refer to ethersjs doc: https://docs.ethers.io/v5/api/contract/contract/#Contract--events
   * 
   * @param contract Target contract emitting events
   * @param eventSignature Signature of the contract event, e.g. 'AnswerUpdated(int256,uint256,uint256)'
   * @param overMaxPastBlock Max number of past blocks to look for the specified event
   * @returns List of events emitted in the past blocks
   */
  async loadContractEvent(contract: Contract, eventSignature: string, overMaxPastBlock?: number): Promise<Event[]> {
    const blockNbLatest = await this.provider.getBlockNumber();
    const nbBlocks = 750; // TODO Review default max nb of past blocks to check for events
    const fromBlockStart = blockNbLatest - (overMaxPastBlock > 0 ? overMaxPastBlock : nbBlocks);

    const eventId = ethers.utils.id(eventSignature);
    const eventFilter: EventFilter = {
      //address: contractOracle.address,
      topics: [eventId],
    };

    this.logger.debug('Loading events \'' + eventSignature + '\'/\'' + eventId + '\' emitted by ' + contract.address + ' since block ' + fromBlockStart);

    return await contract
      .queryFilter(eventFilter, fromBlockStart)
      .then((result: ethers.Event[]) => {
        this.logger.log('Loaded events \'' + eventSignature + '\' on \'' + contract.address + '\': found ' + result?.length + ' over last ' + nbBlocks + ' blocks');
        return result;
      })
      .catch((error) => {
        throw new Error('Failed to load source contract Events \'' + eventSignature + '\' \n' + error);
      });
  }

  /**
   * Listen to Events emitted by a contract
   * 
   * @param contract target contract to listen event from
   * @param eventSignature Signature of the event to listen to, e.g. 'AnswerUpdated(int256,uint256,uint256)'
   */
  listenToContractEvent(feedId: string, sourceId: string, contract: Contract, eventSignature: string, nbDecimals: number): Contract {
    const eventId = ethers.utils.id(eventSignature);
    const eventFilter: EventFilter = {
      //address: contract.address,
      topics: [eventId],
    };
    this.logger.log('Start listening to Events \'' + eventSignature + '\' / \'' + eventId + '\' emitted by \'' + contract.address + '\' for \'' + feedId + '\'');
    return contract.on(eventFilter, async (current, roundId, updatedAt) => {
      const msg = 'Event \'' + eventSignature + '\' on \'' + contract.address + '\''
        + (sourceId !== contract.address ? ' (from proxy \''+sourceId+'\')' : '')
        + ': current=' + current + ' round=' + roundId + ' at=' + updatedAt;
      this.logger.debug(msg);
      const result: FeedSourceData = {
        value: ConvertContractUtils.convertValue(current, ValueType.PRICE, { decimals: nbDecimals }),
        time: ConvertContractUtils.convertValue(updatedAt, ValueType.DATE),
        round: roundId,
      }
      await this.castSourceDataUpdate(feedId, sourceId, result, ESourceDataUpdateReason.DATA_CHANGE)
        .catch(error => {
          throw new Error('Failed to cast event-based Source Data update for \'' + feedId + '\' \n' + error);
        });
    });
  }

  /**
   * Listen to Event 'AnswerUpdated' 
   * Topic0: 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f
   * 
   * @param contract target contract to listen event from
   * @deprecated
   */
  listenToEthEventAnswerUpdated(contract: Contract): Contract {
    try {
      const filter2: EventFilter = contract.filters.AnswerUpdated();
      this.logger.debug('Initialized Event listener with filter AnswerUpdated: \'' + filter2 + '\' Address=\'' + filter2.address + '\' Topic: \'' + filter2.topics + '\'');
      return contract.on(filter2, (current, roundId, updatedAt) => {
        this.logger.log('AnswerUpdated Event emitted. Current=' + current + ' Round=' + roundId + ' At=' + updatedAt);
      });
    } catch (error) {
      throw new Error('Failed to init event listener with filter AnswerUpdated \n' + error);
    }
  }

  /**
   * Track and report the activated listening of a source events
   * 
   * Notice that the source ID might differ from the contract address, e.g. in case of a CL aggregator proxy
   * 
   * @param contract the contract for which the events listening is to be reported
   * @returns cast result of the source data polling registration
   */
  private async trackSourceEventListener(sourceId: string, contract: Contract): Promise<RecordMetadata[]> {
    //const sourceId = contract.address;
    const existing = this.sourcePolling.get(sourceId);
    this.logger.debug('Registering new Event listener on Source \'' + sourceId + '\'' + (sourceId !== contract.address ? (' via contract \'' + contract.address + '\'') : ''));
    if (existing && !this.config.sourcePollingAllowMultipleBySameIssuer)
      throw new Error('Forbidden attempt to register a second event listener on same Source on same node instance for \'' + sourceId + '\'');

    this.sourceListening.set(sourceId, { contract: contract, data: undefined });

    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, ESourcePollingChange.ADD_LISTEN_EVENT, 'Source Event listening started');
  }

  /**
   * Stop listening to events of a given data source
   * 
   * @param sourceId source ID, e.g. contract address
   * @param reasonCode reason for stoping to listen to the source events
   * @param reasonMsg optional indication
   * @returns cast result of the source polling change
   */
  private async stopSourceEventListener(sourceId: string, reasonCode: ESourcePollingChange, reasonMsg?: string): Promise<RecordMetadata[]> {
    const contract: Contract = this.sourceListening.get(sourceId)?.contract;
    this.logger.debug('Stopping Event listeners on Source \'' + sourceId + '\'');
    if (contract === undefined) {
      this.logger.error('Inconsistent source registered for event listening: contract for \'' + sourceId + '\' is undefined');
    }
    else {
      // const eventId = ethers.utils.id(eventSignature);
      // contract.off(eventId, null);
      contract.removeAllListeners();
    }
    this.sourceListening.delete(sourceId);
    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, reasonCode, reasonMsg);
  }

  /**
   * Stop all source event listeners for this instance, e.g. on a service shutdown request
   * 
   * @returns promises of all requested stops for listening to source events
   */
  async stopAllSourceEventListener() {
    const polledSources = this.getSourceListened();
    this.logger.debug('Stopping event listeners on Sources: ' + polledSources);
    return await Promise.all(polledSources.map(async (sourceId: string) => {
      await this.stopSourceEventListener(sourceId, ESourcePollingChange.REMOVE_LISTEN_EVENT, 'Service \'' + this.getServiceId + '\' shutting down')
        .catch(async (error) => {
          await KafkaUtils.castError(ETopic.ERROR_SOURCE, EErrorType.SOURCE_POLLING_HANDLE_FAIL, sourceId, undefined, error, 'Failed to properly stop polling source data', undefined, this.logger);
        });
    }))
      .finally(() => { this.provider?.removeAllListeners(); });
  }

  //
  // Contract Events Polling
  // ____________________________________________________________________________________
  // ====================================================================================

}
