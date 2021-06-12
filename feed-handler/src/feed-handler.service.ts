import { ETopics, createTopicsDefault, getKafkaNativeInfo, getConfigKafkaNative, RelaydKClient, getConfigKafka, RelaydKGroup, EContractStatus } from '@relayd/common';
import { FeedConfig, RelayActionResult } from '@relayd/common';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';

import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, KafkaContext } from '@nestjs/microservices';
//import { Admin, ITopicConfig, KafkaMessage, Message, ProducerRecord } from 'kafkajs';

import { KafkaStreams, KStream, KTable, KafkaStreamsConfig } from 'kafka-streams';

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
      ETopics.CONTRACT_DATA,
      ETopics.ERROR,
    ];

    topics.forEach(pattern => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    getKafkaNativeInfo(this.logger);

    await createTopicsDefault(this.clientKafka, this.logger).catch((error) => this.logger.error('Failed to create default topics from FeedHandler\n'+error));

    const configKafkaNative = getConfigKafkaNative(RelaydKClient.FEED_STREAM, RelaydKClient.FEED);
    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams();
  }

  async shutdown(signal:string) {
    this.logger.debug('Shutting down Feed service on signal '+signal);
    if (this.streamFactory)
      await this.streamFactory.closeAll()
        .then((results) => {this.logger.debug("Feed streams closed. "+results)})
        .catch((error) => {throw new Error('Unexpected closure of Feed streams\nError: '+error)});
    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => {this.logger.debug("Feed client closed.")})
        .catch((error) => {throw new Error('Unexpected closure of Feed client\nError: '+error)});
  } 

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------

  private feedStream: KStream;
  private feedTable: KTable;

  initStreams(): void {
    Promise.all([
      this.initFeedKStream(ETopics.FEED),
      this.initFeedKTable()
    ]).then(() => {
      this.logger.log('Feed Stream & Table successfully started');
    }).catch((error) => { 
      throw new Error('Failed to init Streams:' + error); 
    });
  }

  initFeedKStream(topicName: string): Promise<void> {
    this.logger.debug('Creating kStream for \'' + topicName + '\'');
    //const feedStorage: KStorage = this.kafkaStreamMaker.getStorage();
    const topicStream: KStream = this.streamFactory.getKStream(topicName);

    topicStream.forEach(message => {
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
      },
      (error) => { // kafka error callback
        this.logger.error('Failed to start Stream on \'' + topicName + '\'\n' + error);
        throw new Error('Failed to start Stream on \'' + topicName + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    );
  }

  initFeedKTable(): Promise<void> {
    const topicName = ETopics.FEED;
    this.logger.debug('Creating kTable  for \'' + topicName + '\'');
    const keyMapperEtl = message => {
      const feedConfig = JSON.parse(message.value.toString());
      this.logger.debug(topicName+' kTable entry:\t' + JSON.stringify(feedConfig));
      return {
        key: feedConfig.id, // message.key && message.key.toString(),
        value: feedConfig
      };
    };

    const topicTable: KTable = this.streamFactory.getKTable(topicName, keyMapperEtl, null);

    // topicTable.consumeUntilMs(10000, () => { 
    //   this.logger.debug('Table snapshot of \'' + topicName + '\' taken. Value:\n'+JSON.stringify(topicTable.getStorage()));

    //   const kStorage: KStorage = this.kafkaFactory.getStorage();
    //   this.logger.debug('kStorage: '+JSON.stringify(kStorage));

    //   return topicTable;
    // });

    const outputStreamConfig: KafkaStreamsConfig = null;
    return topicTable.start(
      () => { 
        this.logger.debug('kTable  on \'' + topicName + '\' ready. Started');
        this.feedTable = topicTable; 
      },
      (error) => { 
        this.logger.error('Failed to start kTable for \'' + topicName + '\'\n' + error);
        throw new Error('Failed to init kTable for \'' + topicName + '\'\n' + error);
      },
      // false,
      // outputStreamConfig
    );
  }

  async loadFeed(feedConfigId: string): Promise<FeedConfig> {
    this.logger.debug('Request for loading feed \''+feedConfigId+'\' from kTable');
    const feedKTable: KTable = this.feedTable;
    const queryResult = feedKTable.getStorage().get(feedConfigId);
    // this.logger.debug('Table get('+feedConfigId+'): '+queryResult+': '+JSON.stringify(queryResult));

    const feedConfig = queryResult.then((result) => {
      return result;
    }).catch((error) => {
      throw new Error('Failed to extract feed \''+feedConfigId+'\' from kTable.\nError: '+error);
    });
    return feedConfig;
  }

  castFeedConfig(feedConfig: FeedConfig): void {
    this.clientKafka.connect()
      .then((producer) => {

        producer.send({
          topic: ETopics.FEED,
          messages: [{
            key: feedConfig.id,
            value: JSON.stringify(feedConfig), // TODO Review Serialization format 
          }]
        }).then((recordMetadata: RecordMetadata[]) => {
          recordMetadata.forEach(element => {
            this.logger.debug('Sent Feed record metadata: ' + JSON.stringify(element));
          });
        }).catch((error) => { 
          throw new Error('Failed to cast Feed Config.\nError: ' + error) 
        });

        producer.send({
          topic: ETopics.CONTRACT,
          messages: [{
            key: feedConfig.id,
            value: JSON.stringify(feedConfig.source), // TODO Review Serialization format 
          }]
        }).then((recordMetadata: RecordMetadata[]) => {
          recordMetadata.forEach(element => {
            this.logger.debug('Sent Contract record metadata: ' + JSON.stringify(element));
          });
        }).catch((error) => { 
          throw new Error('Failed to cast Contract config.\nError: ' + error) 
        });
      })
      .catch((error: Error) => {
        throw new Error('Failed kafka client connection.\nError: ' + error)
      });
  }

  async createFeed(feedConfig: FeedConfig): Promise<RelayActionResult> {
    // 1. Check if existing feed
    // 2. If Existing, enable/resume
    // 3. If non-existing feed: 
    //  3.1 Check consistency and create/declare/cast for contracts creation

    // TODO If feed creator != target owner then 
    //    Check that the target owner is a Group
    //      AND that feed creator is granted on the target contract owner of type Group
    //    OR the feed creator is part of the Admin group

    const feedId = feedConfig.id;
    let feedStream: RelayActionResult = await this.loadFeed(feedId)
      .then((feed) => {
        this.logger.debug('Loaded feed: '+ feed ? JSON.stringify(feed): 'none found with id' + feedId);
        if (feed == null || feed.id == null){
          this.logger.log('Initiate creation of Feed \''+feedId+'\'');
          const dateNow = new Date().toISOString();
          feedConfig.dateCreated = dateNow;
          feedConfig.dateUpdated = dateNow;
          this.castFeedConfig(feedConfig);
          return {
            status: HttpStatus.OK,
            message: 'Initiating Feed',
            data: feedConfig
          };
        }
        else if ((Date.now() - Date.parse(feed.dateUpdated) > 5*60*1000) 
          && (feed.source.status != EContractStatus.OK || feed.target && feed.target.status != EContractStatus.OK)) {
          this.logger.log('Resume processing of existing Feed \''+feedId+'\'');
          feedConfig.dateUpdated = new Date().toISOString();
          this.castFeedConfig(feedConfig);
          return {
            status: HttpStatus.OK,
            message: 'Resuming halted Feed',
            data: feedConfig
          };
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
        throw new Error('Failed to check if feed exists\n' + error + '\n' + error.stack);
      });

    return feedStream;
  }

}
