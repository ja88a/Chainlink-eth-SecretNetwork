import { Get, Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, MessagePattern, Payload, Ctx, KafkaContext, EventPattern } from '@nestjs/microservices';
import { Admin, ITopicConfig, Kafka, KafkaConfig, KafkaMessage, Message, ProducerRecord } from 'kafkajs';
import { Observable } from 'rxjs/internal/Observable';

import { KafkaStreams, KStorage, KStream, KTable, KafkaStreamsConfig, NativeKafkaClient } from 'kafka-streams';

import { configKafka, configKafkaNative, configKafkaClient, ETopics, configKafkaTopics } from '@relayd/common';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from '@relayd/common';
import { errorMonitor } from 'events';
import { RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { KafkaClient } from 'kafka-streams';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(configKafka)
  private clientKafka: ClientKafka;

  private kafkaClient: Kafka;
  private kafkaFactory: KafkaStreams;

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

    this.kafkaClient = new Kafka(configKafkaClient);

    this.kafkaFactory = new KafkaStreams(configKafkaNative);
    //    this.kafkaFactory.on("error", (error: Error) => this.logger.error('Error on Kafka stream feactory\n'+error));
    //    const feedKafkaClient: NativeKafkaClient = this.kafkaFactory.getKafkaClient(ETopics.FEED);

    //await this.client.connect();
    this.logKafkaNativeInfo();
    await this.createTopicsDefault();


    // ========= TMP Test=============
    
    this.getFeedKStream();
    this.getFeedKTable();
  }

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------

  // async changeFeedStatus(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
  // }

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
      const kafkaAdmin: Admin = this.kafkaClient.admin();
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
        });
      }
    } catch (error) {
      this.logger.error('Failed in creating default Topics\n' + error);
    }
  };

  getFeedKStream(): KStream {
    //const feedStorage: KStorage = this.kafkaStreamMaker.getStorage();
    const topicName = ETopics.FEED;
    const topicStream: KStream = this.kafkaFactory.getKStream(topicName);

    topicStream.forEach(message => {
      this.logger.debug('New msg on \'' + topicName + '\': ' + message);
    });

    const outputStreamConfig: KafkaStreamsConfig = null;
    topicStream.start(
      () => { this.logger.debug('Stream on \'' + topicName + '\' ready. Started') },
      (error) => { this.logger.error('Failure on Stream for \'' + topicName + '\'\n' + error) },
      // false,
      // outputStreamConfig
    );

    return topicStream;
  }

  getFeedKTable(): KTable {
    const topicName = ETopics.FEED;

    const toKv = message => {
      const msg = message.split(",");
      return {
        key: msg[0],
        value: msg[1]
      };
    };
    const topicTable: KTable = this.kafkaFactory.getKTable(topicName, toKv, null);

    topicTable.consumeUntilMs(1000, () => { this.logger.debug('Table snapshot of \'' + topicName + '\' taken') });

    const outputStreamConfig: KafkaStreamsConfig = null;
    topicTable.start(
      () => { this.logger.debug('Table extract of \'' + topicName + '\' ready. Starting') },
      (error) => { this.logger.error('Failure on Table for \'' + topicName + '\'\n' + error) },
      // false,
      // outputStreamConfig
    );
    return topicTable;
  }

  sendRecordFeed(feedConfig: FeedConfig): void {
    this.clientKafka.connect()
      .then((producer) => {
        const result = producer.send({
          topic: ETopics.FEED,
          messages: [{
            key: feedConfig.id,
            value: JSON.stringify(feedConfig), // Check the need to stringify
          }]
        });
        result
          .then((recordMetadata: RecordMetadata[]) => {
            recordMetadata.forEach(element => {
              this.logger.debug('Sent feed record metadata: ' + element);
            });
          })
          .catch((error) => { throw new Error('Failed sending feed config: ' + error.message) });
      })
      .catch((error: Error) => {
        throw new Error('Failed to connect kafka client ' + error.message)
      });
  }

  async createFeed(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
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
    this.sendRecordFeed(priceFeedConfig);

    this.clientKafka.emit(
      ETopics.CONTRACT,
      priceFeedConfig.source
    );

    let feedStream: DataFeedEnableResult;
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
