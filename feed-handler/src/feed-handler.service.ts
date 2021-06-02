import { HttpStatus } from '@nestjs/common/enums/http-status.enum';
import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, KafkaContext } from '@nestjs/microservices';
import { Admin, ITopicConfig, KafkaMessage, Message, ProducerRecord } from 'kafkajs';
import { Observable } from 'rxjs/internal/Observable';

import { KafkaStreams, KStream, KTable, KafkaStreamsConfig } from 'kafka-streams';

import { configKafka, configKafkaNative, ETopics, configKafkaTopics, KTableQueryResult } from '@relayd/common';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from '@relayd/common';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(configKafka)
  private clientKafka: ClientKafka;

  private streamFactory: KafkaStreams;

  constructor() { }

  async init() {
    const requestPatterns = [
      'test.send.msg',
      ETopics.FEED,
      ETopics.CONTRACT
    ];

    requestPatterns.forEach(pattern => {
      this.clientKafka.subscribeToResponseOf(pattern);
    });

    //await this.client.connect();
    this.logKafkaNativeInfo();
    await this.createTopicsDefault();

    this.streamFactory = new KafkaStreams(configKafkaNative);
    this.initStreams();
  }

  async shudown() {
    if (this.streamFactory)
      await this.streamFactory.closeAll()
        .then((results) => {this.logger.debug("Feed streams closed. "+results)})
        .catch((error) => {throw new Error('Unexpected closure of Feed streams\nError: '+error)});
    if (this.clientKafka)
      await this.clientKafka.close()
        .then(() => {this.logger.debug("Feed client closed. ")})
        .catch((error) => {throw new Error('Unexpected closure of Feed client\nError: '+error)});
  } 

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------


  /**
   * Log info about the loaded (or not) native node-rdkafka librdkafka
   */
  logKafkaNativeInfo(): void {
    try {
      const Kafka = require('node-rdkafka');
      this.logger.debug('Kafka features: ' + Kafka.features);
      this.logger.debug('librdkafka version: ' + Kafka.librdkafkaVersion);
    }
    catch (error) {
      this.logger.warn('Failed loading node-rdkafka (native). Using kafkajs\n' + error);
    }
  }

  /**
   * Create the required default topics, if necessary / not already existing
   */
  async createTopicsDefault(): Promise<void> {
    try {
      const kafkaAdmin: Admin = this.clientKafka.createClient().admin();
      //const kafkaAdmin: Admin = this.kafkaClient.admin();
      const topicsExisting = await kafkaAdmin.listTopics();

      const appTopics: ITopicConfig[] = [];
      for (const topic in ETopics) {
        const topicName = ETopics[topic];
        const topicExists = topicsExisting.includes(topicName);
        if (!topicExists) {
          this.logger.debug('Create Topic \'' + topicName + '\' from ' + JSON.stringify(configKafkaTopics.get(topicName)));
          appTopics.push({
            topic: topicName,
            numPartitions: configKafkaTopics.get(topicName).numPartitions | 1,
            replicationFactor: configKafkaTopics.get(topicName).replicationFactor | 1,
          })
        }
      }

      if (appTopics.length > 0) {
        await kafkaAdmin.createTopics({
          topics: appTopics,
          waitForLeaders: true,
        }).then((success) => {
          this.logger.log('Creation of ' + appTopics.length + ' default topics - Success: ' + success);
        }).catch((error) => {
          throw new Error('Failed to create topics ' + JSON.stringify(appTopics) + '\n' + error);
        });
      }
    } catch (error) {
      this.logger.error('Failed to create missing default Topics\n' + error);
    }
  };

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
        + '\n\tKey: ' + (message.key ? message.key.toString('utf8') : '-')
        + '\tPartition: ' + message.partition
        + '\n\tOffset: ' + message.offset
        + '\tTimestamp: ' + message.timestamp
        + '\tSize: ' + message.size
        + '\n\tValue :' + (message.value ? message.value.toString('utf8') : null));
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
      //const msg = message.value.id;
      const feedConfig = JSON.parse(message.value.toString());
      this.logger.debug('keyMapperEtl:\n' + JSON.stringify(feedConfig));
      return {
        key: feedConfig.id, // message.key && message.key.toString(),
        value: feedConfig
      };
    };

    // class myStorage extends KStorage {
    //   constructor() {
    //     super({
    //     });
    //   } 
    // }
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
        const result = producer.send({
          topic: ETopics.FEED,
          messages: [{
            key: feedConfig.id,
            value: JSON.stringify(feedConfig), // TODO Review Serialization format 
          }]
        });
        result
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach(element => {
              this.logger.debug('Sent feed record metadata: ' + JSON.stringify(element));
            });
          })
          .catch((error) => { throw new Error('Failed to send feed config: ' + error.message) });
      })
      .catch((error: Error) => {
        throw new Error('Failed to connect kafka client ' + error.message)
      });
  }

  async createFeed(feedConfig: FeedConfig): Promise<DataFeedEnableResult> {
    // 1. Check if existing feed
    // 2. If Existing, enable/resume
    // 3. If non-existing feed: 
    //  3.1 Check consistency and create/declare/cast for contracts creation
    // const producer = await this.client.connect();
    // producer.emit()
    // this.client.emit(
    //   ETopics.FEED,
    //   priceFeedConfig
    // );

    // TODO If feed creator != target owner then 
    //    Check that the target owner is a Group
    //      AND that feed creator is granted on the target contract owner of type Group
    //    OR the feed creator is part of the Admin group

    const feedId = feedConfig.id;
    let feedStream: DataFeedEnableResult = await this.loadFeed(feedId)
      .then((feed) => {
        this.logger.debug('Loaded feed: '+feed);
        if (feed == null || feed.id == null){
          this.logger.log('Initiating the creation of Feed \''+feedId+'\'');
          this.castFeedConfig(feedConfig);
          return {
            status: HttpStatus.OK,
            message: 'New Feed initiated. Processing',
            data: feedConfig
          };
        }
        else {
          return {
            status: HttpStatus.BAD_REQUEST,
            message: 'A Feed with the same ID already exists. Feed creation request declined.',
            //data: feedConfig,
          };
        }
      })
      .catch((error) => { 
        throw new Error('Failed to check if feed exists\n' + error+'\n'+error.stack);
      });

    return feedStream;
  }


  // =======================================================================
  // -- TESTS
  // -----------------------------------------------------------------------

  sendTestMsg(): TMessageType0 {
    const newMsg0: TMessageType0 = { id: '000', name: 'test000' };
    this.logger.warn(`Sending msg: ${JSON.stringify(newMsg0)}`);
    const result: Observable<any> = this.clientKafka.emit('test.send.msg', newMsg0);
    result.toPromise().then((result: any) => { this.logger.debug(`Observable type ${typeof result}: ${JSON.stringify(result)}`) })
    return newMsg0;
  }

  //@MessagePattern('test.send.msg')
  handleTestMsg(/*@Payload()*/ message: TMessageType0, /*@Ctx()*/ context: KafkaContext): any {
    const originalMessage: KafkaMessage = context.getMessage();
    const { headers, offset, timestamp } = originalMessage;
    this.logger.debug(`Receiving msg on Topic ${context.getTopic()}\nValue: ${JSON.stringify(originalMessage)}`);

    this.logger.log(`Received message: ${JSON.stringify(message)}`);
    return {
      value: 'GOT IT, TEST MSG PROCESSED'
    }
  }

  //@Get('/test2')
  sendTestMsg2(): string {
    const newMsg0 = { id: '002', name: 'test002' };
    const msg0: Message = {
      key: 'newMsg',
      value: JSON.stringify(newMsg0),
    };
    this.logger.log(`Sending msg: ${JSON.stringify(newMsg0)}`);
    const record: ProducerRecord = {
      topic: 'test.send.msg',
      messages: [msg0]
    };
    this.clientKafka.connect().then((producer) => {
      producer.send(record);
    });

    //this.client.send('', {'001', 'test001'});
    return JSON.stringify(newMsg0);
  }

}
