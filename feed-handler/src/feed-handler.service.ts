import { ETopics, createTopicsDefault, getKafkaNativeInfo, getConfigKafkaNative, RelaydKClient, getConfigKafka, RelaydKGroup, EContractStatus, FeedConfigSource, deepCopyJson } from '@relayd/common';
import { FeedConfig, RelayActionResult } from '@relayd/common';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';

import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, KafkaContext } from '@nestjs/microservices';
//import { Admin, ITopicConfig, KafkaMessage, Message, ProducerRecord } from 'kafkajs';

import { KafkaStreams, KStream, KTable, KafkaStreamsConfig, KStorage } from 'kafka-streams';

import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(getConfigKafka(RelaydKClient.FEED, RelaydKGroup.FEED))
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  constructor() { }

  async init() {
    const topics = [
      ETopics.FEED,
      ETopics.CONTRACT,
      // ETopics.CONTRACT_DATA,
      // ETopics.ERROR,
    ];

    topics.forEach(pattern => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    getKafkaNativeInfo(this.logger);

    await createTopicsDefault(this.clientKafka, this.logger).catch((error) => this.logger.error('Failed to create default topics from FeedHandler\n' + error));

    const configKafkaNative = getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKClient.FEED);
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

  private feedStream: KStream;
  private contractStream: KStream;
  private feedTable: KTable;
  private feedContractMergedTable: KTable;

  initStreams(): void {
    Promise.all([
      this.listenToKStream(ETopics.FEED),
      this.initKTableFeed(),
      this.initKStreamContractConfig(),
      this.mergeContractConfigToFeedConfig(),
    ]).then(() => {
      this.logger.log('Feed Stream & Table successfully started');
      setTimeout(() => {
        //        this.initKTableFeed();
        // this.feedTable.merge(this.contractStream)
        //   .then((merged) => merged.to(ETopics.FEED))
        //   .catch((error) => this.logger.error('TRY AGAIN\n'+error) )
        //        this.initKTableMergedFeedContractConfig();
        //this.testKTableMergedFeedConfig();
      }, 1000);
    }).catch((error) => {
      this.logger.error(new Error('Failed to init Streams\n' + error));
    });
  }

  testKTableMergedFeedConfig() {
    setTimeout(() => {
      this.initKTableMergedFeedContractConfig();
      this.testKTableMergedFeedConfig()
    }, 10000);
  }

  //  async initKTableMergedFeedContractConfig(): Promise<void> {
  // return this.feedTable
  //   .merge(this.streamFactory.getKStream(ETopics.CONTRACT+'.config'))

  //  }

  async initKTableMergedFeedContractConfig(): Promise<void> {
    return this.feedTable
      .merge(this.streamFactory.getKStream(ETopics.CONTRACT + '.config'))
      .then((merged: KTable) => {
        //this.logger.debug('Init kTable merged feed and contract\n'+JSON.stringify(merged));

        merged.consumeUntilMs(1000, () => {
          let count = 0;
          merged.forEach((row) => {
            this.logger.warn('Merged kTable Feed&Contract config ' + count++ + '\n' + row);
          });
        });

        this.feedContractMergedTable = merged;

        // return merged.start(      
        //   () => { 
        //     this.logger.debug('kTable Merging Feed & Contract config ready. Started');
        //     this.feedContractMergedTable = merged; 
        //   },
        //   (error) => { 
        //     this.logger.error('Failed to start kTable for \'Merged Feed & Contract config\'\n' + error);
        //     throw new Error('Failed to init kTable for \'Merged Feed & Contract config\'\n' + error);
        //   });
      });
  }

  /** 
   * Initialize a Stream on a given topic 
   */
  listenToKStream(topicName: string): Promise<KStream | Error | void> {
    this.logger.debug('Creating kStream for \'' + topicName + '\'');
    //const feedStorage: KStorage = this.kafkaStreamMaker.getStorage();
    const topicStream: KStream = this.streamFactory.getKStream(topicName);

    topicStream
      //      .merge(this.contractStream)
      .forEach(message => {
        this.logger.debug('Record msg on stream \'' + topicName + '\': '
          + '\nKey: ' + (message.key ? message.key.toString('utf8') : '-')
          + '\nPartition: ' + message.partition
          + '\tOffset: ' + message.offset
          + '\tTimestamp: ' + message.timestamp
          + '\tSize: ' + message.size
          + '\nValue :' + (message.value ? message.value.toString('utf8') : null));
      });

    //const outputStreamConfig: KafkaStreamsConfig = null;
    return topicStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + topicName + '\' ready. Started');
        this.feedStream = topicStream;
        //return topicStream;
      },
      (error) => { // kafka error callback
        this.logger.error('Kafka Failed to start Stream on \'' + topicName + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    );
  }

  /** 
   * Initialize a Stream on a given topic 
   */
  initKStreamContractConfig(): Promise<void> {
    const topicName: string = ETopics.CONTRACT;
    this.logger.debug('Creating kStream \'Contract to Feed config\' out of \'' + topicName + '\'');
    const topicStream: KStream = this.streamFactory.getKStream(topicName);

    // topicStream
    //   .from(topicName)
    //   .mapJSONConvenience()
    //   .map((message) => {
    //     const feedId = message.key.toString('utf8');
    //     const newRecord = message; //deepCopyJson(message);
    //     newRecord.value = {
    //       id: feedId,
    //       source: message.value,
    //     };
    //     newRecord.key = feedId;
    //     newRecord.topic = ETopics.CONTRACT+'.config';
    //     this.logger.debug('Contract config reworked\n'+JSON.stringify(newRecord));
    //     return newRecord;
    //   })
    //   .to(ETopics.CONTRACT+'.config', 'auto', 'buffer');

    topicStream
      .from(topicName)
      .mapJSONConvenience()
      .map((message) => {
        const feedId = message.key.toString('utf8');
        const contractConfigRecord = {
          key: feedId,
          value: {
            id: feedId,
            source: message.value,
          },
        }
        this.logger.debug('Contract config reworked\n' + JSON.stringify(contractConfigRecord));
        return contractConfigRecord;
      })
      .to(ETopics.CONTRACT_CONFIG, 'auto', 'buffer');

    // topicStream
    //   .merge(this.feedStream)
    //   .to(ETopics.FEED, 'auto', 'buffer');

    return topicStream.start(
      () => { // kafka ready callback
        this.logger.debug('kStream on \'' + topicName + '\' ready. Started');
        this.contractStream = topicStream;
      },
      (error) => { // kafka error callback
        this.logger.error('Failed to start Stream on \'' + topicName + '\'\n' + error);
        return new Error('Failed to start Stream on \'' + topicName + '\'\n' + error);
      },
    );
  }

  mergeContractConfigToFeedConfig() {
    const contractConfigTopic = ETopics.CONTRACT_CONFIG; // TODO Change to ETopics.CONTRACT? or rename to Source contract?
    const contractConfigStream: KStream = this.streamFactory.getKStream(contractConfigTopic);

    contractConfigStream
      .mapJSONConvenience()
      .forEach((contractConfigRecord) => {
        const feedId = contractConfigRecord.key?.toString('utf8');
        const contractConfig = contractConfigRecord.value.source;
        if (!feedId)
          throw new Error('Contract config record on \'' + contractConfigTopic + '\' has no feed ID key\n' + JSON.stringify(contractConfigRecord));
        const feedConfigMerged = this.loadFeedFromTable(feedId)//, FeedConfig) //; this.feedTable.getStorage().get(feedId)
          .then((feedConfig) => {
            if (!feedConfig || feedConfig instanceof Error)
              throw new Error('No target feed config \'' + feedConfig + '\' found for merging contract \''+contractConfig.contract+'\'');
            
            this.logger.debug('Merging\nContract:\n'+JSON.stringify(contractConfig)+'\nin Feed:\n'+JSON.stringify(feedConfig));
            feedConfig.source = contractConfig;
            const feedConfigMsg = {
              key: feedId,
              value: feedConfig
            }
            this.feedStream.writeToStream(feedConfigMsg);
            //this.logger.debug('Merged source contract \'' + contractConfig.contract + '\' to feed \'' + feedId + '\'');
            return feedConfigMsg;
          })
          .catch((error) => {
            return new Error('Failed to merge contract \'' + contractConfig?.contract + '\' to feed \'' + feedId + '\'\n' + error);
          });

        if (feedConfigMerged instanceof Error)
          throw feedConfigMerged;
        this.logger.debug('Merged source contract \'' + contractConfig.contract + '\' to feed \'' + feedId + '\'\n'+JSON.stringify(feedConfigMerged));
      })
      .catch((error) => {
        this.logger.error('Failed to merge source contract with its feed config\n' + error);
      });

    return contractConfigStream.start(
      () => { // kafka success callback
        this.logger.debug('kStream on \'' + contractConfigTopic + '\' for merging configs ready. Started');
        this.feedStream = contractConfigStream;
        //return topicStream;
      },
      (error) => { // kafka error callback
        this.logger.error('Kafka Failed to start Stream on \'' + contractConfigTopic + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    );
  }

  initKTableFeed(): Promise<void> {
    const topicName = ETopics.FEED;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');
    const keyMapperEtl = message => {
      const feedConfig = JSON.parse(message.value.toString());
      this.logger.debug(topicName + ' kTable \'' + topicName + '\' entry\n' + JSON.stringify(feedConfig));
      return {
        key: feedConfig.id, // message.key && message.key.toString(),
        value: feedConfig
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    //topicTable.merge(this.contractStream);

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
        this.feedTable = topicTable;
      },
      (error) => {
        //this.logger.error('Failed to start kTable for \'' + topicName + '\'\n' + error);
        throw new Error('Failed to init kTable for \'' + topicName + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    );
  }

  async loadFeedFromTable(keyId: string, kTable: KTable = this.feedTable, entityName: string = 'feed config'): Promise<FeedConfig | Error> {
    this.logger.debug('Request for loading ' + entityName + ' \'' + keyId + '\' from kTable');
    return kTable.getStorage().get(keyId)
      .then((feedConfig) => {
        if (!feedConfig) {
          this.logger.warn('No ' + entityName + ' \'' + keyId + '\' found in kTable');
          return undefined;
        }
        this.logger.debug('Found ' + entityName + ' \'' + keyId + '\' out of kTable storage\n' + JSON.stringify(feedConfig));
        return feedConfig;
      })
      .catch((error) => {
        return new Error('Failed to extract ' + entityName + ' \'' + keyId + '\' from kTable.\nError: ' + error);
      });
  }

  async castFeedConfig(feedConfig: FeedConfig): Promise<RecordMetadata[] | Error> {
    return this.clientKafka.connect()
      .then(async (producer) => {

        // Record the feed config
        const castFeedResult = producer.send({
          topic: ETopics.FEED,
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
        const castContractResult = producer.send({
          topic: ETopics.CONTRACT,
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
        return new Error('Failed kafka client connection\n' + error);
      });
  }

  async createFeed(feedConfig: FeedConfig): Promise<RelayActionResult | Error> {
    // 1. Check if existing feed
    // 2. If Existing, enable/resume
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
          && (result.source.status != EContractStatus.OK || result.target && result.target.status != EContractStatus.OK)) {
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
