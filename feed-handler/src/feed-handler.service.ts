import { Get, Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, MessagePattern, Payload, Ctx, KafkaContext, EventPattern } from '@nestjs/microservices';
import { KafkaMessage, Message, ProducerRecord } from 'kafkajs';
import { Observable } from 'rxjs/internal/Observable';

import { KafkaStreams, KStorage, KStream, KTable } from 'kafka-streams';

import { configKafka, configKafkaNative, ETopics } from '@relayd/common';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from '@relayd/common';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(configKafka)
  private client: ClientKafka;

  private kafkaStreamMaker: KafkaStreams;

  constructor() { }

  async init() {
    const requestPatterns = [
      'test.send.msg',
      ETopics.FEED,
      ETopics.CONTRACT
    ];

    requestPatterns.forEach(pattern => {
      this.client.subscribeToResponseOf(pattern);
    });

    this.kafkaStreamMaker = new KafkaStreams(configKafkaNative);

    //await this.client.connect();
    this.logtKafkaNativeInfo();
    this.initKStream();
  }

  // =======================================================================
  // -- TESTS
  // -----------------------------------------------------------------------

  sendTestMsg(): TMessageType0 {
    const newMsg0: TMessageType0 = { id: '000', name: 'test000' };
    this.logger.warn(`Sending msg: ${JSON.stringify(newMsg0)}`);
    const result: Observable<any> = this.client.emit('test.send.msg', newMsg0);
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
      messages:[msg0] 
    };
    this.client.connect().then((producer)=>{
      producer.send(record);
    });

    //this.client.send('', {'001', 'test001'});
    return JSON.stringify(newMsg0);
  }

  // =======================================================================
  // -- Core
  // -----------------------------------------------------------------------

  // async changeFeedStatus(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
  // }

  logtKafkaNativeInfo(): void {
    const Kafka = require('node-rdkafka');
    this.logger.debug('Kafka features: ' + Kafka.features);
    this.logger.debug('librdkafka version: ' + Kafka.librdkafkaVersion);
  } 

  initKStream(): void {
    //const feedStorage: KStorage = this.kafkaStreamMaker.getStorage();
    const feedStream: KStream = this.kafkaStreamMaker.getKStream(ETopics.FEED);
    //feedStream.
    //const feedTable: KTable = this.kafkaStreamMaker.getKTable();
  }

  async createFeed(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
    // 1. Check if existing feed
    // 2. If Existing, enable/resume
    // 3. If non-existing feed: 
    //  3.1 Check consistency and create/declare/cast for contracts creation
    // const producer = await this.client.connect();
    // producer.emit()
    this.client.emit(
      ETopics.FEED,
      priceFeedConfig
    );
    this.client.emit(
      ETopics.CONTRACT,
      priceFeedConfig.source
    );
    let feedStream: DataFeedEnableResult;
    return feedStream;
  } 


}
