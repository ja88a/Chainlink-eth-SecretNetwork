import {
  EErrorType,
  ESourceCastReason,
  ESourceStatus,
  ETopic,
  FeedConfig,
  FeedConfigSource,
  KafkaUtils, 
  RelaydKClient, 
  RelaydKGroup,
} from '@relayd/common';
import { RelayActionResult } from '@relayd/common';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';

import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, KafkaContext } from '@nestjs/microservices';
//import { Admin, ITopicConfig, KafkaMessage, Message, ProducerRecord } from 'kafkajs';

import { KafkaStreams, KStream, KTable, KafkaStreamsConfig, KStorage } from 'kafka-streams';

import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(KafkaUtils.getConfigKafka(RelaydKClient.FEED, RelaydKGroup.FEED))
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  constructor() { }

  async init() {
    const topics = [
      ETopic.FEED_CONFIG,
      ETopic.SOURCE_CONFIG,
      // ETopics.CONTRACT_DATA,
      // ETopics.ERROR,
    ];

    topics.forEach(pattern => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    KafkaUtils.getKafkaNativeInfo(this.logger);

    await KafkaUtils.createTopicsDefault(this.clientKafka, this.logger).catch((error) => this.logger.error('Failed to create default topics from FeedHandler\n' + error));

    const configKafkaNative = KafkaUtils.getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKClient.FEED);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams();
  }

  async shutdown(signal: string) {
    this.logger.debug('Shutting down Feed service on signal ' + signal);
    if (this.streamFactory)
      await this.streamFactory.closeAll()
        .then((results) => { this.logger.debug("Feed streams closed. " + results) })
        .catch((error) => { throw new Error('Unexpected closure of Feed streams\nError: ' + error) });
    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => { this.logger.debug("Feed client closed.") })
        .catch((error) => { throw new Error('Unexpected closure of Feed client\nError: ' + error) });
  }

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------

//  private feedStream: KStream;
//  private contractStream: KStream;
  private feedTable: KTable;
//  private feedContractMergedTable: KTable;

  initStreams(): void {
    const initFeedKTable = this.initKTableFeed()
      .then((result) => {
        if (result instanceof Error)
          throw new Error(''+result);
        this.feedTable = result;
      })
      .catch((error) => { return new Error('Failed to init Feed KTable \n' + error); });

    Promise.all([
      KafkaUtils.initKStreamWithLogging(this.streamFactory, ETopic.FEED_CONFIG, this.logger),
      initFeedKTable,
      this.mergeSourceToFeedConfig(),      
    ]).then(() => {
      this.logger.log('Feed Stream & Table successfully started');
    }).catch((error) => {
      this.logger.error(new Error('Failed to init Feed Streams \n' + error));
    });
  }

    // topicStream
    //   .from(ETopic.SOURCE_CONFIG_CONFIG)
    //   .mapJSONConvenience()
    //   .map((message) => {
    //     const feedId = message.key.toString('utf8');
    //     const contractConfigRecord = {
    //       key: feedId,
    //       value: {
    //         id: feedId,
    //         source: message.value,
    //       },
    //     }
    //     this.logger.debug('Contract config reworked\n' + JSON.stringify(contractConfigRecord));
    //     return contractConfigRecord;
    //   })
    //   .to(ETopic.SOURCE_CONFIG, 'auto', 'buffer');

  async mergeSourceToFeedConfig(): Promise<void>  { // KStream | Error
    const sourceConfigTopic = ETopic.SOURCE_CONFIG;
    const sourceConfigStream: KStream = this.streamFactory.getKStream(sourceConfigTopic);

    sourceConfigStream
      .mapJSONConvenience()
      .forEach(async (sourceConfigRecord) => {
        const feedId = sourceConfigRecord.key?.toString('utf8');
        if (!feedId)
          throw new Error('Source config record on \'' + sourceConfigTopic + '\' has no feed ID key\n' + JSON.stringify(sourceConfigRecord));
        const sourceConfig = sourceConfigRecord.value;
        //this.logger.debug('Processing source config \'' + sourceConfig.contract + '\' for merging in feed \'' + feedId + '\'\n' + JSON.stringify(sourceConfigRecord));
        this.logger.debug('Processing source config \'' + sourceConfig.contract + '\' for merging in feed \'' + feedId + '\'');
        
        const feedConfigMerged = await this.loadFeedFromTable(feedId)//, FeedConfig) //; this.feedTable.getStorage().get(feedId)         
          .catch((error) => {
            return new Error('Failed to merge source \'' + sourceConfig?.contract + '\' to feed \'' + feedId + '\'\n' + error);
          })
          .then((feedConfig: FeedConfig | Error) => {
            if (!feedConfig || feedConfig instanceof Error)
              return new Error('No target feed config \'' + feedId + '\' found for merging contract \'' + sourceConfig.contract + '\'');

            //this.logger.log('Merging\nContract:\n' + JSON.stringify(contractConfig) + '\nin Feed:\n' + JSON.stringify(feedConfig));
            feedConfig.source = sourceConfig;
            this.logger.log('Source config \'' + sourceConfig.contract + '\' update merged into feed \'' + feedId + '\' - Casting feed update');
            return this.castFeedConfig(feedConfig, false)
              .catch((error) => { 
                return new Error('Failed to cast merged feed-source config \'' + feedId + '\'\n' + error) 
              });
          });

        if (feedConfigMerged instanceof Error)
          KafkaUtils.castError(ETopic.ERROR_CONFIG, EErrorType.SOURCE_CONFIG_MERGE_FAIL, feedId, sourceConfigRecord, feedConfigMerged, 'Failed to merge Source config update in Feed', undefined, this.logger);
      })

    return sourceConfigStream.start(
        () => { // kafka success callback
          this.logger.debug('kStream on \'' + sourceConfigTopic + '\' for merging configs ready. Started');
        },
        (error) => { // kafka error callback
          this.logger.error('Kafka Failed to start Stream on \'' + sourceConfigTopic + '\'\n' + error);
        },
        // false,
        // outputStreamConfig
      )
      // .then(() =>{
      //   return sourceConfigStream;
      // })
      // .catch((error) =>{
      //   return new Error('Failed to initiate contract config stream for merging in feed config \n'+ error);
      // });
  }

  async initKTableFeed(): Promise<KTable | Error> {
    const topicName = ETopic.FEED_CONFIG;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');

    const keyMapperEtl = message => {
      const feedConfig: FeedConfig = JSON.parse(message.value.toString());
      this.logger.debug('Feed config kTable \'' + topicName + '\' entry\n' + JSON.stringify(feedConfig));
      return {
        key: feedConfig.id, // message.key && message.key.toString(),
        value: feedConfig
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    // topicTable.consumeUntilMs(10000, () => { 
    //   this.logger.debug('kTable snapshot of \'' + topicName + '\' taken. Value:\n'+JSON.stringify(topicTable.getStorage()));

    //   //const kStorage: KStorage = this.streamFactory.getStorage();
    //   const kStorage: KStorage = topicTable.getStorage();
    //   this.logger.debug('kStorage: '+JSON.stringify(kStorage));

    //   //return topicTable;
    // });

    //const outputStreamConfig: KafkaStreamsConfig = null;
    return topicTable.start(
      () => {
        this.logger.debug('kTable  on \'' + topicName + '\' ready. Started');
//        this.feedTable = topicTable;
      },
      (error) => {
        //this.logger.error('Failed to start kTable for \'' + topicName + '\'\n' + error);
        throw new Error('Failed to start kTable for \'' + topicName + '\' \n' + error);
      },
      // false,
      // outputStreamConfig
    )
    .then(() => { return topicTable })
    .catch((error) => { return new Error('Failed to init Feed config kTable on \'' + topicName + '\' \n' + error) });
  }

  async loadFeedFromTable(keyId: string, kTable: KTable = this.feedTable, entityName: string = 'feed config'): Promise<FeedConfig | Error> {
//    this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
//    this.logger.debug('kTable info\n== Stats:\n'+ JSON.stringify(kTable.getStats()) +'\n== State:\n' + JSON.stringify(kTable.getTable()));
    return kTable.getStorage().get(keyId)
      .then((feedConfig) => {
        if (!feedConfig) {
          this.logger.debug('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' in kTable\n' + JSON.stringify(feedConfig));
        return feedConfig;
      })
      .catch((error) => {
        return new Error('Failed to extract ' + entityName + ' \'' + keyId + '\' from kTable.\nError: ' + error);
      });
  }

  async castFeedConfig(feedConfig: FeedConfig, castSourceConfig = true): Promise<RecordMetadata[] | Error> {
    return this.clientKafka.connect()
      .then(async (producer) => {

        // Record the feed config
        const castFeedResult = producer.send({
            topic: ETopic.FEED_CONFIG,
            messages: [{
              key: feedConfig.id,
              value: JSON.stringify(feedConfig), // TODO Review Serialization format 
            }]
          })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach(element => {
              this.logger.debug('Sent Feed record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
          .catch((error) => {
            return new Error('Failed to cast Feed Config\n' + error);
          });

        // Cast the feed's source contract config for further processing
        let castContractResult: Promise<RecordMetadata[] | Error>;
        if (castSourceConfig) {
          castContractResult = producer.send({
            topic: ETopic.SOURCE_CONFIG,
            messages: [{
              key: feedConfig.id,
              value: JSON.stringify(feedConfig.source), // TODO Review Serialization format 
            }]
          })
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach(element => {
              this.logger.debug('Sent Contract record metadata: ' + JSON.stringify(element));
            });
            return recordMetadata;
          })
          .catch((error) => {
            return new Error('Failed to cast Contract config\n' + error);
          });
        } else 
          castContractResult = new Promise(() => {return []});

        return Promise.all([
            castFeedResult,
            castContractResult,
          ])
          .then((result) => {
            let castResult = [];
            result.forEach((sub) => {
              if (sub instanceof Error)
                throw result;
              castResult = castResult.concat(result);
            });
            return castResult;
          })
          .catch((error) => {
            return new Error('Failed to cast feed configs\n' + error);
          });
      })
      .catch((error: Error) => {
        return new Error('Failed castFeedConfig\n' + error);
      });
  }


  async createFeed(feedConfig: FeedConfig): Promise<RelayActionResult | Error> {
    // 1. Check if existing feed
    // 2. If Existi ng, enable/resume
    // 3. If non-existing feed: 
    //  3.1 Check consistency and create/declare/cast for contracts creation

    // TODO If feed creator != target owner then 
    //    Check that the target owner is a Group
    //      AND that feed creator is granted on the target contract owner of type Group
    //    OR the feed creator is part of the Admin group

    const feedId = feedConfig.id;
    return this.loadFeedFromTable(feedId)
      .then((result) => {
        if (result instanceof Error)
          throw result;

        this.logger.debug('Loaded feed: ' + result != undefined ? JSON.stringify(result) : 'none found with id' + feedId);
        if (result == null || result.id == null) {
          this.logger.log('Initiate creation of Feed \'' + feedId + '\'');
          const dateNow = new Date().toISOString();
          feedConfig.dateCreated = dateNow;
          feedConfig.dateUpdated = dateNow;
          return this.castFeedConfig(feedConfig)
            .then((result) => {
              if (result instanceof Error)
                throw result;
              return {
                status: HttpStatus.OK,
                message: 'Initiating Feed ' + feedId,
                data: feedConfig
              };
            });
        }
        else if ((Date.now() - Date.parse(result.dateUpdated) > 5 * 60 * 1000)
          && (result.source.status != ESourceStatus.OK || result.target && result.target.status != ESourceStatus.OK)) {
          this.logger.log('Resume processing of existing Feed \'' + feedId + '\'');
          feedConfig.dateUpdated = new Date().toISOString();
          return this.castFeedConfig(feedConfig)
            .then((result) => {
              if (result instanceof Error)
                throw result;
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
        return new Error('Failed to check if feed exists\n' + error + '\n' + error.stack);
      });
  }

}
