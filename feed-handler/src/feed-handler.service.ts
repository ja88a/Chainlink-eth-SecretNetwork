import {
  EConfigRunMode,
  EErrorType,
  ESourceStatus,
  ETopic,
  FeedConfig,
  KafkaUtils,
  RelayActionResult,
  RelaydConfigService,
  RelaydKClient,
  RelaydKGroup,
} from '@relayd/common';

import { HttpStatus } from '@nestjs/common/enums/http-status.enum';

import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';

import { KafkaStreams, KStream, KTable } from 'kafka-streams';
import { EventEmitter } from 'events';
import { ClientKafka } from '@nestjs/microservices/client/client-kafka';
import { Client } from '@nestjs/microservices/decorators/client.decorator';

/**
 * Feed data handler Service
 */
@Injectable()
export class FeedHandlerService {

  /** Dedicated logger */
  private readonly logger = new Logger(FeedHandlerService.name, true);

  /** Kafka simple messages sender from/to KV. 
   * Not much used, usage of Streams only shall be preferred */
  @Client(KafkaUtils.getConfigKafka(RelaydKClient.FEED, RelaydKGroup.FEED))
  private clientKafka: ClientKafka;

  /** Kafka streams & tables factory */
  private streamFactory: KafkaStreams;

  /**
   * Default Service constructor
   * @param config app configuration service
   */
  constructor(private readonly config: RelaydConfigService) { }

  /**
   * Default initialization method
   */
  async init() {
    // Required topics creation (if not existing yet)
    const topics = [
      ETopic.FEED_CONFIG,
      ETopic.SOURCE_CONFIG,
      ETopic.ERROR_FEED,
    ];
    await KafkaUtils.createTopics(topics, this.clientKafka, this.logger)
      .catch((error) => { this.logger.warn('Feed handler had failure while creating default Kafka topics\nMake sure all have been [concurrently] created and exist now\n' + error) });

    // init Kafka streams & tables
    KafkaUtils.getKafkaNativeInfo(this.logger);
    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKGroup.FEED);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams()
      .catch((error) => { throw new Error('Failed to init Feed Handler streams - CORRUPTED \n' + error); });
  }

  /**
   * Shutdown the Feed handler service
   * 
   * @param signal shutdown signal at the origin of this request
   */
  async shutdown(signal: string) {
    this.logger.debug('Shutting down Feed handler service on signal ' + signal);

    // Wait a bit the time for updates to propagate via Kafka records
    const ee = new EventEmitter();
    setTimeout(() => { ee.emit('ok') }, 5000)
    await new Promise(resolve => {
      ee.once('ok', resolve);
    });

    if (this.streamFactory)
      await this.streamFactory.closeAll()
        .then((results) => { this.logger.debug("Feed streams closed. " + results) })
        .catch((error) => { this.logger.error('Unexpected closure of Feed kStreams \n' + error) });

    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => { this.logger.debug("Feed kClient closed") })
        .catch((error) => { this.logger.error('Unexpected closure of Feed kClient \n' + error) });
  }

  getKafkaStreamsClientInfo() {
    // const kafkaClient: KafkaClient = this.streamFactory.getKafkaClient(ETopic.SOURCE_CONFIG);
    // console.dir(kafkaClient);
    //return kafkaClient;
    return this.streamFactory.getStats();
  }

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------

  private feedConfigTable: KTable;

  /**
   * Init all kafka streams & tables required by this service
   * @returns 
   */
  async initStreams(): Promise<void> {
    this.logger.debug('Init Source Streams & Tables');

    // if (this.config.appRunMode !== EConfigRunMode.PROD) {
    // await KafkaUtils.initKStreamWithLogging(this.streamFactory, ETopic.FEED_CONFIG, this.logger)
    //   .catch((error) => {
    //     throw new Error('Failed to init kStream for logging Feed Config records \n' + error);
    //   });
    // }

    await this.initKTableFeed()
      .then((result: KTable) => {
        this.feedConfigTable = result;
      })
      .catch((error) => { throw new Error('Failed to init Feed KTable \n' + error); });

    this.feedConfigTable.createAndSetProduceHandler

    await this.mergeSourceToFeedConfig()
      .catch((error) => { throw new Error('Failed to init feed-source merging process \n' + error); });

    this.logger.log('Feed Streams & Tables started '+ this.config.logKafkaRecordContent);
    if (this.config.logKafkaRecordContent === true) {
      this.logger.debug(JSON.stringify(this.streamFactory.getStats()))
      //      console.dir(this.streamFactory.getStats());
    }
  }

  /**
   * 
   * @returns new table instance on the feed config stream
   */
  async initKTableFeed(): Promise<KTable> {
    const topicName = ETopic.FEED_CONFIG;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');

    const keyMapperEtl = message => {
      const feedConfig: FeedConfig = JSON.parse(message.value.toString());
      this.logger.debug('Feed config kTable \'' + topicName + '\' entry: \'' + feedConfig.id + '\'');
      if (this.config.logKafkaRecordContent)
        this.logger.debug(JSON.stringify(feedConfig));
      return {
        key: feedConfig.id, // message.key && message.key.toString(),
        value: feedConfig
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    //const outputStreamConfig: KafkaStreamsConfig = null;
    await topicTable.start(
      () => {
        this.logger.debug('kTable  on \'' + topicName + '\' ready. Started');
      },
      (error) => {
        this.logger.error('Failed to run kTable for \'' + topicName + '\'\n' + error);
        throw new Error('Failed to run kTable for \'' + topicName + '\' \n' + error);
      },
      // false,
      // outputStreamConfig
    )

    return topicTable;
  }

  /**
   * Load stored Feed config, via a dedicated Kafka Table
   * 
   * @param keyId Feed ID to look for
   * @param kTable optional specification of the target Feed Configs' Kafka Table to consider
   * @param entityName optional logging message customization
   * @returns Result of the search from the table storage
   */
  async loadFeedFromTable(keyId: string, kTable: KTable = this.feedConfigTable, entityName: string = 'Feed config'): Promise<FeedConfig> {
    //    this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
    //    this.logger.debug('kTable info\n== Stats:\n'+ JSON.stringify(kTable.getStats()) +'\n== State:\n' + JSON.stringify(kTable.getTable()));
    return await kTable.getStorage().get(keyId)
      .then((feedConfig) => {
        if (!feedConfig) {
          this.logger.debug('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' in kTable');
        if (this.config.logKafkaRecordContent)
          this.logger.debug(JSON.stringify(feedConfig));
        return feedConfig;
      })
      .catch((error) => {
        throw new Error('Failed to extract ' + entityName + ' \'' + keyId + '\' from kTable \n' + error);
      });
  }

  /**
   * Merge a Source config update into its parent Feed configuration
   * 
   * @returns created Source Config stream from which data are merged into its associated Feed Config
   */
  async mergeSourceToFeedConfig(): Promise<KStream> {
    const sourceConfigTopic = ETopic.SOURCE_CONFIG;
    const sourceConfigStream: KStream = this.streamFactory.getKStream(sourceConfigTopic);

    sourceConfigStream
      .mapJSONConvenience()
      .forEach(async (sourceConfigRecord) => {
        const feedId = sourceConfigRecord.key?.toString('utf8');
        if (feedId === undefined)
          throw new Error('Source config record on \'' + sourceConfigTopic + '\' has no feed ID key\n' + JSON.stringify(sourceConfigRecord));
        const sourceConfig = sourceConfigRecord.value;
        //this.logger.debug('Processing source config \'' + sourceConfig.contract + '\' for merging in feed \'' + feedId + '\'\n' + JSON.stringify(sourceConfigRecord));
        this.logger.debug('Processing Source config \'' + sourceConfig.contract + '\' for merging in Feed \'' + feedId + '\'');

        const feedConfigMerged = await this.loadFeedFromTable(feedId)
          .then(async (feedConfig: FeedConfig) => {
            if (feedConfig === undefined)
              throw new Error('No target feed config \'' + feedId + '\' found for merging source \'' + sourceConfig.contract + '\'');
            //this.logger.log('Merging\nContract:\n' + JSON.stringify(contractConfig) + '\nin Feed:\n' + JSON.stringify(feedConfig));
            feedConfig.source = sourceConfig;
            this.logger.log('Source config \'' + sourceConfig.contract + '\' update merged into feed \'' + feedId + '\' - Casting feed update');
            return await this.castFeedConfig(feedConfig, false)
              .catch((error) => {
                throw new Error('Failed to cast merged feed-source config \'' + feedId + '\'\n' + error)
              });
          })
          .catch((error) => {
            return new Error('Failed to merge Source \'' + sourceConfig?.contract + '\' to Feed \'' + feedId + '\'\n' + error);
          });

        if (feedConfigMerged instanceof Error)
          await KafkaUtils.castError(ETopic.ERROR_FEED, EErrorType.SOURCE_CONFIG_MERGE_FAIL, feedId, sourceConfigRecord, feedConfigMerged, 'Failed to merge Source config update in Feed', undefined, this.logger);
      });

    await sourceConfigStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + sourceConfigTopic + '\' for merging feed-source configs ready. Started');
      },
      (error) => { // kafka error callback
        throw new Error('Kafka Failed to run merge-feed-source Stream on \'' + sourceConfigTopic + '\' \n' + error);
      },
      // false,
      // outputStreamConfig
    );

    return sourceConfigStream;
  }

  /**
   * Cast a Feed configuration update
   * 
   * @param feedConfig Feed config to cast
   * @param castSourceConfig Specifies if the source config is also to be cast (on a separate/dedicated topic). `true` by default
   * @returns Info about the casting of records
   */
  async castFeedConfig(feedConfig: FeedConfig, castSourceConfig = true): Promise<boolean> {
    const castRes: Array<Promise<void>> = [];

    castRes.push(KafkaUtils.writeToStream(this.streamFactory, ETopic.FEED_CONFIG, feedConfig.id, feedConfig, this.feedConfigTable));

    // Cast the feed's source contract config for further processing
    if (castSourceConfig) {
      castRes.push(KafkaUtils.writeToStream(this.streamFactory, ETopic.SOURCE_CONFIG, feedConfig.id, feedConfig.source));
    }

    return await Promise.all(castRes)
      .then(_ => true)
      .catch(error => {
        throw new Error('Failed to cast Feed config update for \'' + feedConfig.id + '\' \n' + error);
      });
  }

  /**
   * Create and register a new data Feed config
   * @param feedConfig the input/submitted & already validated feed config
   * @returns Result of the Feed creation request
   */
  async createFeed(feedConfig: FeedConfig): Promise<RelayActionResult> {
    // 1. Check if existing feed
    // 2. If Existi ng, enable/resume
    // 3. If non-existing feed: 
    //  3.1 Check consistency and create/declare/cast for contracts creation

    // TODO If feed creator != target owner then 
    //    Check that the target owner is a Group
    //      AND that feed creator is granted on the target contract owner of type Group
    //    OR the feed creator is part of the Admin group

    const feedId = feedConfig.id;
    return await this.loadFeedFromTable(feedId)
      .then(async (feedRes) => {
        this.logger.debug('Loaded feed: ' + feedRes !== undefined ? JSON.stringify(feedRes) : 'None found with id \'' + feedId + '\'');
        if (feedRes === undefined || feedRes.id === undefined) {
          this.logger.log('Initiating creation of Feed \'' + feedId + '\'');
          const dateNow = new Date().toISOString(); // TODO Date format: review this if migrating to number
          feedConfig.dateCreated = dateNow;
          feedConfig.dateUpdated = dateNow;
          return await this.castFeedConfig(feedConfig)
            .then((result) => {
              return {
                status: HttpStatus.OK,
                message: 'Initiating Feed ' + feedId,
                data: feedConfig
              };
            });
        }
        else if ((Date.now() - Date.parse(feedRes.dateUpdated) > 3 * 60 * 1000)
          && (feedRes.source.status != ESourceStatus.OK || feedRes.target?.status != ESourceStatus.OK)) {
          this.logger.log('Resume processing of existing Feed \'' + feedId + '\'');
          feedConfig.dateUpdated = new Date().toISOString();
          return await this.castFeedConfig(feedConfig)
            .then((result) => {
              return {
                status: HttpStatus.OK,
                message: 'Resuming halted Feed ' + feedId,
                data: feedConfig
              };
            });
        }
        else {
          return {
            status: HttpStatus.NOT_ACCEPTABLE,
            message: 'A running Feed with the same ID already exists. Feed creation declined.',
            //data: feedConfig,
          };
        }
      })
      .catch((error) => {
        throw new Error('Failed to create new Feed \'' + feedId + '\' \n' + (error.stack ? error.stack : error));
      });
  }

}
