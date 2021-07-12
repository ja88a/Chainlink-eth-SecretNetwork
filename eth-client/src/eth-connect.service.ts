import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';

import { Contract, ethers, EventFilter } from 'ethers';
import { Result } from 'ethers/lib/utils';

import abiClAggregatorProxy from './res/EACAggregatorProxy.ABI.json';
import abiClAggregator from './res/AccessControlledOffchainAggregator.ABI.json';
import {
  EEthersNetwork,
  ESourceCastReason,
  ProviderNetwork,
  ETopic,
  ConversionConfig,
  convertContractInputValue,
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
  SourcePollingInfo,
  VALID_OPT,
  ProcessingIssue,
  RelaydConfigService,
  ESourceDataUpdateReason,
  KafkaUtils,
  EConfigRunMode,
  EErrorType,
} from '@relayd/common';
import { EFeedSourceNetwork, FeedConfigSource, EFeedSourceType } from '@relayd/common';

import { Client } from '@nestjs/microservices/decorators/client.decorator';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { KafkaStreams, KStream, KTable } from 'kafka-streams';

import { PreconditionFailedException } from '@nestjs/common/exceptions/precondition-failed.exception';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { isDate, isDateString, isEthereumAddress, isPositive, validate } from 'class-validator';
import { FeedSourceHandle, FeedSourceConfigWrap } from '@relayd/common/dist/types/data/feed.data';

@Injectable()
export class EthConnectService {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;

  @Client(KafkaUtils.getConfigKafka(RelaydKClient.ETH, RelaydKGroup.ETH))
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  private serviceId: string;

  private ethNetworkProviderInfo: ProviderNetwork;

  constructor(private readonly config: RelaydConfigService) { }

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
      .catch((error) => { this.logger.warn('ETH Source handler had failure while creating default Kafka topics\nMake sure they have been concurrently created and exist now\n' + error) });

    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.ETH_STREAM, RelaydKGroup.ETH);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams()
      .catch((error) => {
        throw new Error('Failed to init ETH Connection streams - CORRUPTED \n' + error);
      });
  }

  getServiceId(): string {
    return this.serviceId;
  }

  async shutdown(signal: string) {
    this.logger.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"

    // Stop all data polling
    await this.stopAllSourcePolling();

    if (this.provider)
      this.provider.removeAllListeners();
    // TODO missing data polling notification + source config update

    if (this.streamFactory)
      await this.streamFactory.closeAll();

    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => {
          this.logger.debug('ETH kClient closed');
        })
        .catch((error) => {
          throw new Error('Unexpected closure of ETH kClient \n' + error);
        });

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
  //  Source management utilities
  // ________________________________________________________________________________

  /**
   * Check if the source ETH network matches with the one this ETH client is connecting to
   * @param sourceNetwork
   * @returns
   */
  async checkNetworkMatch(sourceNetwork: string): Promise<boolean> {
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


  private sourceKTable: KTable;

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
        this.sourceKTable = result;
      })
      .catch((error) => {
        throw new Error('Failed to init kTable on Source config \n' + error.stack);
      });

    await this.mergeSourcePollingToConfig();

    this.logger.log('Source Streams & Tables started');
  }

  /**
   * Initialization of a kTable on Source, as a data Feed source
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
   * @returns created source polling stream or an error met during that init process
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
        if (!sourceId)
          throw new Error('Source polling record on \'' + sourcePollingTopic + '\' has no source ID key \n' + JSON.stringify(sourcePollingRecord));

        const sourceConfigMergeResult = await this.loadSourceFromTable(sourceId)
          .then(async (feedSourceWrap: FeedSourceConfigWrap | Error) => {
            if (!feedSourceWrap || feedSourceWrap instanceof Error)
              throw new Error('No target source config \'' + sourceId + '\' found for merging source polling \'' + sourcePollingInfo.source + '\'');

            //this.logger.log('Merging\nSource polling info:\n' + JSON.stringify(contractPollingInfo) + '\nin Source config:\n' + JSON.stringify(contractConfig));
            const sourceConfig = feedSourceWrap.source;
            const newHandleRes = this.reviewSourceHandling(sourceConfig.handle, sourcePollingInfo);
            if (newHandleRes instanceof Error)
              return new Error('Failed to process Source polling handle info for \'' + feedSourceWrap.feedId + '\' \n' + newHandleRes);
            sourceConfig.handle = newHandleRes;

            this.logger.log('Source \'' + sourcePollingInfo.source + '\' merged into feed \'' + sourceId + '\' - Casting source update');
            return await this.castSourceConfig(ETopic.SOURCE_CONFIG, feedSourceWrap.feedId, sourceConfig,
              ESourceCastReason.HANDLING_SUCCESS, 'Update Source polling info')
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
        throw new Error('Kafka Failed to start merge-source-polling Stream on \'' + sourcePollingTopic + '\' \n' + error.stack);
      },
      // false,
      // outputStreamConfig
    )

    return sourcePollingStream;
  }

  /**
   * Review a Source handles against a source polling change: validate and compute the updated handles' state
   * @param _actual Actual source's handle as defined in the feed config Source
   * @param sourcePolling source polling info to process
   * @returns updated source's handle entries
   */
  // TODO Enhance the restriction & error handling on unexpected sources' polling un-/registration
  reviewSourceHandling(_actual: FeedSourceHandle[], sourcePolling: SourcePollingInfo)
    : FeedSourceHandle[] | Error {
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
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + source + '\'';
          if (this.config.sourcePollingAllowMultipleTypeBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (sourcePolling.change === ESourcePollingChange.ADD_PERIODIC) {
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          const msg = 'Unexpected re-declaration of a periodic polling of \'' + source + '\' by the already registered \'' + issuer + '\'';
          if (this.config.sourcePollingAllowMultipleBySameIssuer)
            return new Error(msg);
          else
            this.logger.warn(msg);
        }
        if (alreadyPolledByIssuer.includes(EFeedSourcePoll.EVENT)) {
          const msg = 'Same handler \'' + issuer + '\' proceeds to both periodic and event-based polling of \'' + source + '\'';
          if (this.config.sourcePollingAllowMultipleTypeBySameIssuer)
            return new Error(msg);
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
          return new Error('Unexpected removal of an event-based polling of \'' + source + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
        }
        pollingType = EFeedSourcePoll.EVENT;
      }
      else if (sourcePolling.change === ESourcePollingChange.REMOVE_PERIODIC) {
        if (!alreadyPolledByIssuer.includes(EFeedSourcePoll.TIMEPERIOD)) {
          return new Error('Unexpected removal of a periodic polling of \'' + source + '\' for the non-registered \'' + issuer + '\' - Ignoring handle removal');
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

    return new Error('Unknow Source Polling Change \'' + sourcePolling.change + '\' for \'' + source + '\'. Not supported');
  }

  /**
   * Load a source config, wrappred with its feedId, from a kTable, based on a source address
   * @param keyId source address
   * @param kTable optional overriding of the target kTable instance to query
   * @param entityName optional overriding of the entity name used for logging
   * @returns result of the search in the kTable
   */
  async loadSourceFromTable(keyId: string, kTable: KTable = this.sourceKTable, entityName = 'Wrapped Source config')
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
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' in kTable\n' + JSON.stringify(sourceFeedWrap));
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
      message: 'Failure with ETH source \'' + sourceConfig.contract + '\' config handling for \'' + feedId + '\'',
      error: '' + prevError,
    };
    this.logger.error('ETH Source processing Error\n' + JSON.stringify(errorInfo));
    return await this.castSourceConfig(ETopic.ERROR_CONFIG, feedId, sourceConfig,
      ESourceCastReason.HANDLING_FAILED, JSON.stringify(errorInfo))
      .then((castResult) => {
        if (castResult instanceof Error)
          throw castResult;
        else
          castResult.forEach((entry: RecordMetadata) => {
            this.logger.debug('Sent Source config Error record\n' + JSON.stringify(entry));
          })
      })
      .catch((error) => {
        this.logger.error('Failed to cast source config Error \'' + errorType + '\'/\'' + ESourceCastReason.HANDLING_FAILED + '\' for source \'' + sourceConfig.contract + '\' of feed \'' + feedId + '\'\nInitial Error: ' + JSON.stringify(errorInfo) + '\n\n' + error);
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
        this.logger.log('Initiate data polling for \'' + sourceConfig.contract + '\'');

        // Check that this source polling is not already handled by the same owner
        const toPoll = this.checkIfDataPollingRequired(sourceConfig);
        if (toPoll === undefined || toPoll.length === 0) {
          this.logger.log('No additional data polling required for \'' + sourceConfig.contract + '\'. Feed Source polling OK');
        }
        else {
          // Launch the polling process
          const pollingInitResult = await this.initiateSourceDataPolling(sourceConfig, feedId)
            .then((result) => {
              this.logger.log('Data polling process of \'' + sourceConfig.contract + '\' for feed \'' + feedId + '\' initiated by \'' + this.getServiceId() + '\'');
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
   * @returns 
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
    else //if (sourceConfig.poll === EFeedSourcePoll.EVENT) {
      throw new Error('Source polling \'' + sourceConfig.poll + '\' NOT SUPPORTED YET. Review config of Source \'' + sourceConfig.contract + '\' for feed \'' + feedId + '\'');

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
              result.time = convertContractInputValue((Date.now() / 1000), ValueType.DATE, { date: ValueTypeDate.default });
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
            handler.logger.warn('Failed to poll data of source \'' + contract?.address + '\' for feed \'' + feedId + '\' (' + pollingErrorCounter + '/' + maxError + ') \n' + result);
        }
      };

    const contract: Contract = contractSrc ? contractSrc : this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
    const timeout: NodeJS.Timeout = setInterval(loadContractData(this, contract, feedId, sourceConfig.notif, convertOptions, sourceConfig.period, 0), sourceConfig.period * 1000);

    return timeout;
  }

  /** 
   * Instance specific map of running source data pulling threads
   */
  private polledSource: Map<string, {
    /** Last retrieved source data */
    data: FeedSourceData;
    /** polling process's timeout hook */
    timeout: NodeJS.Timeout;
  }> = new Map();

  getPolledSource(): string[] {
    return [...this.polledSource.keys()];
  }

  checkForSourceDataChange(sourceId: string, sourceData: FeedSourceData, pollingPeriod?: number): boolean {
    // Caution: retrieved source data are considered as valid here
    const previous = this.polledSource.get(sourceId);
    if (previous === undefined)
      throw new Error('Inconsistent state: no source \'' + sourceId + '\' registered for polling. Actual: ' + this.getPolledSource.toString());

    const previousData = previous.data;
    if (previousData === undefined || previousData.value !== sourceData.value) {
      this.logger.debug('Value change detected for source \'' + sourceId + '\': ' + sourceData.value);

      if (pollingPeriod) {
        const changeDetectionTimeMs: number = Date.now(); //convertContractInputValue(Date.now(), ValueType.DATE);
        const timeReportedAsUpdatedMs: number = new Date(sourceData.time).valueOf(); // TODO Review data time format integration here, if number or isoString
        if (changeDetectionTimeMs > (timeReportedAsUpdatedMs + pollingPeriod * 1000 + 1500))
          this.logger.warn('Review Lag between source value change time and its detection. Took '
            + (timeReportedAsUpdatedMs - changeDetectionTimeMs) / 1000 + 's while the polling period is set to ' + pollingPeriod);
      }

      this.polledSource.set(sourceId, { data: sourceData, timeout: previous.timeout });
      return true;
    }
    return false;
  }

  private async trackSourcePolling(sourceId: string, timeout: NodeJS.Timeout) {
    const existing = this.polledSource.get(sourceId);
    if (existing && !this.config.sourcePollingAllowMultipleBySameIssuer)
      throw new Error('Attempt to register a second polling of same Source on same node instance for \'' + sourceId + '\'');

    this.polledSource.set(sourceId, { timeout: timeout, data: undefined });

    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, ESourcePollingChange.ADD_PERIODIC, 'Periodic Source polling started');
  }

  private async stopSourcePolling(sourceId: string, reasonCode: ESourcePollingChange, reasonMsg?: string) {
    const timeout = this.polledSource.get(sourceId)?.timeout;
    if (timeout === undefined)
      throw new Error('Requesting to stop a non-registered source polling \'' + sourceId + '\'. Actual: ' + this.getPolledSource().toString());

    this.logger.warn('Stopping periodic polling of source \'' + sourceId + '\'. Reason: ' + reasonCode + ' ' + reasonMsg);
    //timeout.unref();
    clearInterval(timeout);
    this.polledSource.delete(sourceId);
    return await this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, reasonCode, reasonMsg);
  }

  async stopAllSourcePolling() {
    const polledSources = this.getPolledSource();

    await Promise.all(polledSources.map(async (contractAddr: string) => {
      await this.stopSourcePolling(contractAddr, ESourcePollingChange.REMOVE_PERIODIC, 'Service shutting down')
        .then((outcome: RecordMetadata[] | Error) => {
          if (outcome instanceof Error)
            throw new Error('Failure met while stopping a source polling \n' + outcome);
        })
        .catch((error) => {
          KafkaUtils.castError(ETopic.ERROR_SOURCE, EErrorType.SOURCE_CONFIG_HANDLING_FAIL, contractAddr, error, 'Failed to properly stop polling source data');
          //this.castErrorSourceConfig(EErrorType.SOURCE_POLLING_HANDLE_FAIL, )
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
        const lastValue: number = convertContractInputValue(lastValueRaw, ValueType.PRICE, convertOpts);

        const lastValueTimeRaw = result[EResultFieldLatestRoundData.UPDATE_TIME];
        const lastValueTime: string = convertContractInputValue(lastValueTimeRaw, ValueType.DATE, convertOpts);

        this.logger.debug('Value retrieved from ' + contract.address + ": '" +
          lastValue + ' / ' + lastValueRaw + "' (" + typeof lastValue + ") updated at " + lastValueTime + ' / ' + lastValueTimeRaw + ' (' + typeof lastValueTime + ')');

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
          time: lastValueTime
        };
      })
      .catch((error) => {
        throw new Error('Failed to fetch latestRoundData for \'' + contract?.address + '\' \n' + error);
      });
  }

  /**
   * 
   * @param key 
   * @param source 
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
   * Load the aggregator controller source of a Chainlink EACAggregator Proxy contract
   * @param source Chainlink EACAggregatorProxy source (defining an 'aggregator')
   * @returns Chainlink AccessControlledOffchainAggregator contract
   */
  async loadClProxyContractAggregator(contract: Contract): Promise<Contract> {
    this.logger.debug("Fetching Aggregator source of '" + contract.address + "'");
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
        throw new Error("Failed to fetch Aggregator source of '" + contract.address + "'\n" + error);
      });
  }

  /**
   * Load a source decimals' value
   * @param source target source defining a decimals
   * @returns decimals value
   */
  async loadContractDecimals(contract: Contract): Promise<number> {
    return contract.functions
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
   */
  async validateSourceContract(sourceConfig: FeedConfigSource): Promise<FeedSourceData> {
    const address = sourceConfig.contract;
    if (address == undefined || !isEthereumAddress(address)) throw new Error('Source address is invalid: ' + address);

    const contractType = sourceConfig.type;
    this.logger.debug("Validating source '" + address + "' of type '" + contractType + "' with status '" + sourceConfig.status);

    const pendingCheck: Array<FeedSourceData | Error> = [];

    if (contractType == EFeedSourceType.CL_AGGR || contractType == EFeedSourceType.CL_AGGR_PROX) {
      const contract: Contract = this.initContractClAggregator(address);

      const contractDecimals: number = await this.loadContractDecimals(contract);

      const convertOpts: ConversionConfig = {
        decimals: contractDecimals,
        // commify: false,
        // date: ValueTypeDate.default,
      };

      if (contractType == EFeedSourceType.CL_AGGR_PROX) {
        const checkAggregatorProxy = await this.loadClProxyContractAggregator(contract)
          .then((contractAggr: Contract) => {
            return this.loadContractLatestRoundData(contractAggr, convertOpts, true)
              .catch((error) => {
                return new Error("Failed to fetch latestRoundData for validating sub-ClAggregator '" + contractAggr.address +
                  "' of '" + address + "' (" + contractType + ')\n' + error);
              });
            // TODO check that events are available/emitted
          })
          .catch((error) => {
            return new Error("Failed to validate Aggregator of source '" + address + "' (" + contractType + ')\n' + error);
          });

        pendingCheck.push(checkAggregatorProxy);
      }

      const checkAggregator = await this.loadContractLatestRoundData(contract, convertOpts, true)
        .then((result: FeedSourceData) => {
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

    const aggrRes: FeedSourceData = { value: -1, time: '' };
    pendingCheck.forEach(result => {
      if (result instanceof Error)
        throw new Error('Failed to validate Source \'' + sourceConfig.contract + '\'\n' + result); // JSON.stringify(contractConfig)
      Object.assign(aggrRes, result);
    });
    this.logger.debug('Aggregated source data result: ' + JSON.stringify(aggrRes));
    return aggrRes;
  }

  /**
   * Instantiate a Chainlink EAC Aggregator Proxy or an Access Controlled Offchain Aggregator contract, bound to ETH
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
