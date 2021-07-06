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
  FeedConfigSourceData,
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
import { FeedConfigSourceHandle, FeedSourceConfigWrap } from '@relayd/common/dist/types/data/feed.data';

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

    //await createTopicsDefault(this.clientKafka, this.logger);

    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKClient.FEED);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams();
  }

  async shutdown(signal: string) {
    this.logger.debug('Shutting down ETH Connect service on signal ' + signal); // e.g. "SIGINT"

    // Stop all data polling
    this.stopAllSourcePolling();

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


  // ________________________________________________________________________________
  //
  //  Management of update events via Streams
  // ________________________________________________________________________________


  private sourceKTable: KTable;

  initStreams(): void {
    // Contract Polling events Logging
    if (this.config.appRunMode !== EConfigRunMode.PROD)
      KafkaUtils.initKStreamWithLogging(this.streamFactory, ETopic.SOURCE_POLLING, this.logger)
        .then((result: KStream | Error) => {
          if (result instanceof Error)
            return new Error('Failed to init kStream for logging Contract Polling records \n' + result);
          return result;
        });

    // Source config kTable
    const sourcePollingKTableRes = this.initKTableSourceConfig()
      .then((result: KTable | Error) => {
        if (result instanceof Error)
          return new Error('Failed to init kTable on Sources \n' + result );
        this.sourceKTable = result;
        // Merging of source polling updates into source source config
        //this.mergeSourcePollingToConfig();
        return result;
      })
      .catch((error) => {
        return new Error('Failed to init kTable on Source config \n' + error.stack);
      });

    Promise.all([
      sourcePollingKTableRes,
      this.mergeSourcePollingToConfig(),
    ]).then((initRes) => {
      this.logger.log('ETH Source Streams & Tables started');
      initRes.forEach(element => {
        if (element instanceof Error)
          this.logger.error('Failure on ETH Source Streams initialization \n' + element);
      });
    }).catch((error) => {
      this.logger.error(new Error('Failed to init ETH Source Streams \n' + error));
      //throw new Error('Failed to init Source Streams \n' + error);
    });
  }

  /**
   * Initialization of a kTable on Source Contract, as a data Feed source
   * @returns created kTable or an error met during that process
   */
  async initKTableSourceConfig(): Promise<KTable | Error> { // void
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
        this.logger.error(''+ new Error('Failed to init kTable for \'' + topicName + '\' \n' + error));
      },
      // false,
      // outputStreamConfig
    );
      // .then(() => { return topicTable })
      // .catch((error) => { return new Error('Failed to init Source kTable on \'' + topicName + '\' \n' + error) });
    return topicTable;
  }

  /**
   * Initiate a stream responsible for merging source polling updates into the feed source config
   * @returns created source polling stream or an error met during that init process
   */
  async mergeSourcePollingToConfig(): Promise<KStream | Error> { // void
    const sourcePollingTopic = ETopic.SOURCE_POLLING;
    const sourcePollingStream: KStream = this.streamFactory.getKStream(sourcePollingTopic);

    sourcePollingStream
      .mapJSONConvenience()
      .forEach(async (sourcePollingRecord) => {
        const sourceId = sourcePollingRecord.key?.toString('utf8');
        const sourcePollingInfo: SourcePollingInfo = sourcePollingRecord.value;
        this.logger.debug('Processing source polling \'' + sourcePollingInfo.source + '\' for merging in source \'' + sourceId + '\'');
        if (!sourceId)
          throw new Error('Contract polling record on \'' + sourcePollingTopic + '\' has no source ID key \n' + JSON.stringify(sourcePollingRecord));

        const sourceConfigMergeResult = await this.loadSourceFromTable(sourceId)
          .catch((error) => {
            return new Error('Failed to merge source polling info into source source config \'' + sourceId + '\' \n' + error);
          })
          .then((feedSourceWrap: FeedSourceConfigWrap | Error) => {
            if (!feedSourceWrap || feedSourceWrap instanceof Error)
              return new Error('No target source config \'' + sourceId + '\' found for merging source polling \'' + sourcePollingInfo.source + '\'');

            //this.logger.log('Merging\nContract polling info:\n' + JSON.stringify(contractPollingInfo) + '\nin Source Contract config:\n' + JSON.stringify(contractConfig));
            const sourceConfig = feedSourceWrap.source;
            const newHandleRes = this.reviewSourceHandling(sourceConfig.handle, sourcePollingInfo);
            if (newHandleRes instanceof Error)
              return new Error('Failed to process source source polling handle info for \'' + feedSourceWrap.feedId + '\' \n' + newHandleRes);
            sourceConfig.handle = newHandleRes;

            this.logger.log('Source \'' + sourcePollingInfo.source + '\' merged into feed \'' + sourceId + '\' - Casting source update');
            return this.castSourceConfig(ETopic.SOURCE_CONFIG, feedSourceWrap.feedId, sourceConfig,
              ESourceCastReason.HANDLING_SUCCESS, 'Update polling info')
              .catch((error) => {
                return new Error('Failed to cast merged feed-source config \'' + sourceId + '\'\n' + error)
              });
          });

        if (sourceConfigMergeResult instanceof Error)
          KafkaUtils.castError(ETopic.ERROR_SOURCE, EErrorType.SOURCE_CONFIG_MERGE_FAIL, sourceId, sourcePollingRecord, sourceConfigMergeResult, 'Failed to merge Source polling info to config', undefined, this.logger);
      });

    await sourcePollingStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + sourcePollingTopic + '\' for merging configs ready. Started');
      },
      (error) => { // kafka error callback
        this.logger.error(''+new Error('Kafka Failed to start Stream on \'' + sourcePollingTopic + '\'\n' + error.stack));
      },
      // false,
      // outputStreamConfig
    )
    // .then(() => {
    //   return sourcePollingStream;
    // })
    // .catch((error) => {
    //   return new Error('Failed to init source config stream for merging in feed config \n' + error);
    // });
    return sourcePollingStream;
  }

  /**
   * Review a source source handles against a source polling change: validate and compute the updated handles' state
   * @param _actual Actual source's handle as defined in the feed config Source
   * @param sourcePolling source polling info to process
   * @returns updated source's handle entries
   */
  // TODO Enhance the restriction & error handling on unexpected sources' polling un-/registration
  reviewSourceHandling(_actual: FeedConfigSourceHandle[], sourcePolling: SourcePollingInfo)
    : FeedConfigSourceHandle[] | Error {
    const issuer = sourcePolling.issuer;

    const alreadyPolledByIssuer: EFeedSourcePoll[] = [];
    _actual.forEach((handle: FeedConfigSourceHandle) => {
      if (handle.handler === issuer) {
        alreadyPolledByIssuer.push(handle.type);
      }
    });

    const source = sourcePolling.source;

    // Register a new source polling
    if (sourcePolling.change === ESourcePollingChange.ADD_LISTEN_EVENT
      || sourcePolling.change === ESourcePollingChange.ADD_PERIODIC) {

      const handleUpd: FeedConfigSourceHandle[] = deepCopyJson(_actual);
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

      this.logger.log('Handler \'' + issuer + '\' registered as polling \'' + pollingType + '\' source \'' + source + '\'');
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

      const handleUpd: FeedConfigSourceHandle[] = [];
      _actual.forEach((element: FeedConfigSourceHandle) => {
        if (!(element.handler === issuer && element.type === pollingType))
          handleUpd.push(deepCopyJson(element));
      });

      this.logger.debug('Handler \'' + issuer + '\' de-registered as polling \'' + pollingType + '\' source \'' + source + '\'');
      return handleUpd;
    }

    return new Error('Unknow Contract Polling Change \'' + sourcePolling.change + '\' for \'' + source + '\'. Not supported');
  }

  /**
   * Load a source config, wrappred with its feedId, from a kTable, based on a source address
   * @param keyId source address
   * @param kTable optional overriding of the target kTable instance to query
   * @param entityName optional overriding of the entity name used for logging
   * @returns result of the search in the kTable
   */
  async loadSourceFromTable(keyId: string, kTable: KTable = this.sourceKTable, entityName = 'source source config')
    : Promise<FeedSourceConfigWrap | Error> {
    // this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
    // this.logger.debug('kTable info\n== Stats:\n'+ JSON.stringify(kTable.getStats()) +'\n== State:\n' + JSON.stringify(kTable.getTable()));
    return kTable.getStorage().get(keyId)
      .then((contractFeedWrap) => {
        if (!contractFeedWrap) {
          this.logger.debug('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        if (!contractFeedWrap.feedId || !contractFeedWrap.source)
          return new Error('Invalid feed-wrapped source source config \'' + keyId + '\'\n' + JSON.stringify(contractFeedWrap));
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
   * Cast a message about a feed source, any config update
   * 
   * @param feedConfigId the feed ID the source source belongs to
   * @param source the source config
   * @param reason reason code of the source update
   * @param info optional info about that update, e.g. free description text, error
   * @returns either the casting record metadata or a processing error
   */
  async castSourceConfig(topic: ETopic, feedConfigId: string, source: FeedConfigSource, reason: ESourceCastReason, info?: string)
    : Promise<RecordMetadata[] | Error> {
    const issueNote = this.issueSourceProcessingNote(source, reason, info);

    const validRes = validate(source, VALID_OPT)
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Source Config update \n' + JSON.stringify(validationError));
        return [];
      })
      .catch((error) => {
        return new Error('Failed to validate Source Config update for \'' + source?.contract + '\' by \'' + issueNote.issuer + '\' \n' + error);
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
          .catch((error) => {
            return new Error('Failed to cast Source config \'' + source?.contract + '\' update for \'' + feedConfigId + '\' (' + reason + '\': ' + info + ') \n' + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castSourceConfig for source \'' + source?.contract + '\' of feed \'' + feedConfigId + '\' (' + reason + ': ' + info + ') \n' + error);
      });
  }

  private issueSourceProcessingNote(source: FeedConfigSource, reason: ESourceCastReason, info: string) {
    if (source.issue == null)
      source.issue = [];
    else if (source.issue.length > this.config.sourceIssueMaxNumber)
      source.issue.pop();

    const processingInfo: ProcessingIssue = {
      issuer: this.getServiceId(),
      type: reason,
      info: info?.substr(0, 255),
    };

    source.issue.unshift(processingInfo);

    return processingInfo;
  }

  castErrorSourceConfig(errorType: EErrorType, sourceConfig: FeedConfigSource, feedId: string, prevError: any) {
    const errorInfo = {
      type: errorType,
      input: sourceConfig,
      message: 'Failure with ETH source \'' + sourceConfig.contract + '\' config handling for \'' + feedId + '\'',
      error: '' + prevError,
    };
    this.logger.error('ETH Source processing Error\n' + JSON.stringify(errorInfo));
    this.castSourceConfig(ETopic.ERROR_CONFIG, feedId, sourceConfig, 
      ESourceCastReason.HANDLING_FAILED, JSON.stringify(errorInfo))
      .then((castResult) => {
        if (castResult instanceof Error)
          throw new Error('Failed to cast source config to error queue\n' + castResult);
      })
      .catch((error) => {
        this.logger.error('Failed to cast error \'' + errorType + '\'/\'' + ESourceCastReason.HANDLING_FAILED + '\' on contract \'' + sourceConfig.contract + '\' for feed \'' + feedId + '\'\nInitial Error: ' + JSON.stringify(prevError) + '\n\n' + error);
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
    : Promise<RecordMetadata[] | Error> {
    const updateIssuer = this.getServiceId();

    const sourcePollingUpdate: SourcePollingInfo = {
      source: sourceId,
      issuer: updateIssuer,
      change: changeType,
      info: info,
    };

    const validRes = await validate(sourcePollingUpdate, VALID_OPT)
      .then((validationError) => {
        if (validationError?.length > 0)
          throw new Error('Invalid Contract Polling update \n' + JSON.stringify(validationError));
      })
      .catch((error) => {
        return new Error('Failed to validate Contract Polling Update for \'' + sourceId + '\' from \'' + updateIssuer + '\' \n' + error);
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
                key: sourceId,
                value: JSON.stringify(sourcePollingUpdate), // TODO Review Serialization format
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
            return new Error('Failed to cast Contract Polling update for \'' + sourceId + '\' \n' + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castContractPolling from \'' + updateIssuer + '\' for source \'' + sourceId + '\' \n' + error);
      });
  }

  /**
   * 
   * @param sourceId 
   * @param sourceData 
   * @returns 
   */
  async castContractDataUpdate(topic: ETopic, sourceId: string, sourceData: FeedConfigSourceData,
    reason: ESourceDataUpdateReason, info?: string): Promise<RecordMetadata[] | Error> {
    return this.clientKafka.connect()
      .then(async (producer) => {
        return producer.send({
          topic: topic,
          messages: [
            {
              key: sourceId,
              value: JSON.stringify(sourceData), // TODO Review Serialization format
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
            return new Error("Failed to cast Contract '" + sourceId + "' Data update \n" + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castContractDataUpdate for source \'' + sourceId + '\' \n' + error);
      });
  }


  // ________________________________________________________________________________
  //
  //  Source Contract Management
  // ________________________________________________________________________________

  /**
   * Process a Source, depending on its config status
   * 
   * @param sourceConfigIni Source config to be handled
   * @returns Updated source source config to reflect any state changes, or corresponding processing error
   */
  async handleSourceContract(sourceConfigIni: FeedConfigSource): Promise<FeedConfigSource | Error> {
    this.logger.debug(
      "Handling source '" + sourceConfigIni.contract + "' with status '" + sourceConfigIni.status + "'",
    );

    const sourceConfig: FeedConfigSource = deepCopyJson(sourceConfigIni);
    switch (sourceConfig.status) {

      // New source source initialization: validation
      case ESourceStatus.INI:
        return this.validateSourceContract(sourceConfig)
          .then((result) => {

            if (result instanceof Error)
              throw result;

            return validate(result) // TODO Fix the validation issue on source config, VALID_OPT
              .then((validationError) => {
                if (validationError && validationError.length > 0) {
                  // Validation partial / issue(s) met
                  sourceConfig.status = ESourceStatus.PARTIAL;
                  this.issueSourceProcessingNote(sourceConfig, ESourceCastReason.HANDLING_VALIDATION_PARTIAL, JSON.stringify(validationError))
                  this.logger.warn("Contract '" + sourceConfig.contract + "' (" + sourceConfig.type
                    + ") is partially Valid. Status: " + sourceConfig.status + '\n' + JSON.stringify(validationError));
                } else {
                  // Validation OK
                  sourceConfig.status = ESourceStatus.OK;
                  if (!sourceConfig.data)
                    sourceConfig.data = result;
                  else
                    Object.assign(sourceConfig.data, result);
                  this.logger.log("Contract '" + sourceConfig.contract + "' (" + sourceConfig.type +
                    ") is VALID. Status: " + sourceConfig.status);
                }
                return sourceConfig;
              })
              .catch((error) => {
                return new Error('Failed to validate output of \'' + sourceConfig.contract + '\' validation\n' + error)
              });
          })
          .catch((error) => {
            const msg = 'Validation failed for Source ' + sourceConfig.contract
              + '. Status: ' + sourceConfig.status + ' \n' + error;
            // contractConfig.status = EContractStatus.FAIL;
            // this.issueContractProcessingNote(contractConfig, EContractCastReason.HANDLING_FAILED, error);
            // this.logger.warn(msg);
            // return contractConfig;
            return new Error(msg);
          });
        break;

      // Source Contract validated & ready for data polling
      case ESourceStatus.OK:
        this.logger.log('Initiate data polling for \'' + sourceConfig.contract + '\'');

        // Check that this source polling is not already handled by the same owner
        const toPoll = this.checkIfDataPollingRequired(sourceConfig);
        if (toPoll instanceof Error) {
          return new Error('Failed to check if data polling on source \''+sourceConfig.contract+'\' is required \n'+toPoll);
        }
        else if (toPoll === undefined || toPoll.length === 0) {
          this.logger.log('No additional data polling required for \''+sourceConfig.contract+'\'. Feed Source polling OK');
          return undefined;
        }
        else { 
          // Launch the polling process
          this.initiateContractDataPolling(sourceConfig)
            .then((result) => {
              if (result instanceof Error)
                return new Error('Failed to initiate source data polling \n'+result);
              // TODO update the source config
              throw new Error('ACTIVATION OF DATA POLLING NOT FINALIZED YET');
            })
            .catch((error) => {
              return new Error('Failed to initiate data polling for source \'' + sourceConfig.contract + '\' \n' + error);
            });
        }
        break;

      case ESourceStatus.PARTIAL:
      default:
        throw new Error("Status '" + sourceConfig.status + "' of Source '" +
          sourceConfig.contract + "' is not supported",
        );
    }

    // TODO Review
    return sourceConfig;
  }

  checkIfDataPollingRequired(source: FeedConfigSource): EFeedSourcePoll | Error {
    const pollingStatus = this.extractContractPollingStatus(source);
    if (pollingStatus.handling.length > 0 && (!this.config.sourcePollingAllowMultipleBySameIssuer
        || pollingStatus.handling.includes(source.poll) && !this.config.sourcePollingAllowMultipleTypeBySameIssuer)) {
      return new Error('Instance \''+pollingStatus.issuer+'\' already polls the source data ('+pollingStatus.handling.toString()+')');
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
   * Initialization of a source data polling, based a time schedule or by listening to update events
   * 
   * @param sourceConfig Config of the source to poll
   * @returns 
   */
  async initiateContractDataPolling(sourceConfig: FeedConfigSource): Promise<NodeJS.Timeout | Error> {
    let result;
    if (sourceConfig.poll === EFeedSourcePoll.TIMEPERIOD) {
      const timePeriod = sourceConfig.period;
      if (!isPositive(timePeriod))
        throw new Error('Invalid time period specified for periodic data polling: ' + timePeriod);

      const contract = this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
      result = await this.loadContractDecimals(contract)
        .then((contractDecimals) => {
          const convertOpts: ConversionConfig = { decimals: contractDecimals };
          const pollingTimeout = this.startPollingData(sourceConfig, convertOpts, contract);
          this.trackSourcePolling(sourceConfig.contract, pollingTimeout);
          return pollingTimeout;
        })
        .catch((error) => {
          return new Error('Failed to initiateContractDataPolling of type \'' + EFeedSourcePoll.TIMEPERIOD + '\' on \'' + sourceConfig.contract + '\' \n' + error);
        });
    }
    else if (sourceConfig.poll === EFeedSourcePoll.EVENT) {
      throw new Error('Source polling \'' + EFeedSourcePoll.EVENT + '\' NOT SUPPORTED YET');
    }
    return result;
  }

  /**
   * Initiate an asynchonous thread responsible for regularly, time period based, request
   * for a source data. Corresponding data checks or value changes get reported.
   * 
   * @param sourceConfig Config of the source source to be polled
   * @param convertOpts Extracted value (latestRoundData) conversion options
   * @param contractSrc Optional source instance. If not specified, a new one is created
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
              return handler.castContractDataUpdate(ETopic.SOURCE_POLLING, contract.address, result, ESourceDataUpdateReason.PERIODIC);
            }
            else {
              const hasChanged = handler.checkForSourceDataChange(contract.address, result, timePeriod);
              if (hasChanged) {
                return handler.castContractDataUpdate(ETopic.SOURCE_POLLING, contract.address, result, ESourceDataUpdateReason.DATA_CHANGE);
              }
              return [];
            }
          })
          .catch((error) => {
            return new Error('Failed to poll data for source \'' + contract?.address + '\' \n' + error);
          });

        if (result instanceof Error) {
          if (++pollingErrorCounter > maxError) {
            // TODO Report the halt of a source polling on failure
            const msg = 'Failed to poll data from source source \'' + contract?.address + '\' Stop polling after ' + pollingErrorCounter + ' successive errors. Last:\n' + result;
            handler.stopSourcePolling(contract.address, ESourcePollingChange.REMOVE_PERIODIC, msg);
            throw new Error(msg);
          }
          else
            handler.logger.warn('Failed to poll data of source \'' + contract?.address + '\' (' + pollingErrorCounter + '/' + maxError + ') \n' + result);
        }
      };

    const contract: Contract = contractSrc ? contractSrc : this.initContractClAggregator(sourceConfig.contract, sourceConfig.type);
    const timeout: NodeJS.Timeout = setInterval(loadContractData(this, contract, sourceConfig.notif, convertOptions, sourceConfig.period, 0), sourceConfig.period * 1000);

    return timeout;
  }

  /** 
   * Instance specific map of running source data pulling threads
   */
  private polledSource: Map<string, {
    /** Last retrieved source data */
    data: FeedConfigSourceData;
    /** polling process's timeout hook */
    timeout: NodeJS.Timeout;
  }> = new Map();

  getPolledSource(): string[] {
    return [...this.polledSource.keys()];
  }

  checkForSourceDataChange(contractAddr: string, data: FeedConfigSourceData, pollingPeriod?: number): boolean {
    // Caution: retrieved source data are considered as valid here
    const previous = this.polledSource.get(contractAddr);
    if (previous === undefined)
      throw new Error('Inconsistent state: no source \'' + contractAddr + '\' registered for polling. Actual: ' + this.getPolledSource.toString());

    const previousData = previous.data;
    if (previousData === undefined || previousData.value !== data.value) {
      this.logger.debug('Value change detected for source \'' + contractAddr + '\': ' + data.value);

      if (pollingPeriod) {
        const changeDetectionTimeMs: number = Date.now(); //convertContractInputValue(Date.now(), ValueType.DATE);
        const timeReportedAsUpdatedMs: number = new Date(data.time).valueOf();
        if (changeDetectionTimeMs > (timeReportedAsUpdatedMs + pollingPeriod * 1000 + 1500))
          this.logger.warn('Review Lag between source value change time and its detection. Took '
            + (timeReportedAsUpdatedMs - changeDetectionTimeMs) / 1000 + 's while the polling period is set to ' + pollingPeriod);
      }

      this.polledSource.set(contractAddr, { data: data.value, timeout: previous.timeout });
      return true;
    }
    return false;
  }

  private trackSourcePolling(sourceId: string, timeout: NodeJS.Timeout) {
    const existing = this.polledSource.get(sourceId);
    if (existing && !this.config.sourcePollingAllowMultipleBySameIssuer)
      throw new Error('Attempt to register a second polling of same source source on same node instance for \'' + sourceId + '\'');

    this.polledSource.set(sourceId, { timeout: timeout, data: undefined });

    return this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, ESourcePollingChange.ADD_PERIODIC, 'Periodic source source polling started');
  }

  private stopSourcePolling(sourceId: string, reasonCode: ESourcePollingChange, reasonMsg?: string) {
    const timeout = this.polledSource.get(sourceId)?.timeout;
    if (timeout === undefined)
      throw new Error('Requesting to stop a non-registered source polling \'' + sourceId + '\'. Actual: ' + this.getPolledSource().toString());

    this.logger.warn('Stopping periodic polling of source \'' + sourceId + '\'. Reason: ' + reasonCode + ' ' + reasonMsg);
    //timeout.unref();
    clearInterval(timeout);
    this.polledSource.delete(sourceId);
    return this.castSourcePolling(ETopic.SOURCE_POLLING, sourceId, reasonCode, reasonMsg);
  }

  stopAllSourcePolling() {
    const result: Array<Promise<RecordMetadata[] | Error>> = [];
    const polledSources = this.getPolledSource();
    polledSources.forEach((contractAddr: string) => {
      result.push(this.stopSourcePolling(contractAddr, ESourcePollingChange.REMOVE_PERIODIC, 'Service shutting down'));
    });
    Promise.all(result)
      .then((outcome: Array<RecordMetadata[] | Error>) => {
        outcome.forEach(element => {
          if (element instanceof Error)
            this.logger.error('Failed to stop a source source polling \n' + element);
        });
      })
      .catch((error) => {
        this.logger.error('Failed to stop all contracts\' polling properly \n' + error);
      });
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
          throw new Error('Last data update is older than ' + this.config.sourceDataLastUpdateMaxDays + ' days: ' + lastValueTime + '. Contract considered as stall');
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
    this.logger.debug("Validating source '" + address + "' of type '" + contractType + "' with status '" + contractConfig.status);

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
            return new Error("Failed to validate Aggregator of source '" + address + "' (" + contractType + ')\n' + error);
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
        return Error('Failed to validate source source \'' + contractConfig.contract + '\'\n' + error); // JSON.stringify(contractConfig)
      });
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
