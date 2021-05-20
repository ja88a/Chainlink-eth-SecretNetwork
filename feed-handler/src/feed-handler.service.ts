import { Get, Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, MessagePattern, Payload, Ctx, KafkaContext, EventPattern } from '@nestjs/microservices';
import { KafkaMessage, Message, ProducerRecord } from 'kafkajs';
import { Observable } from 'rxjs';

import { configKafka } from '@relayd/common';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from '@relayd/common';

@Injectable()
export class FeedHandlerService {

  private readonly logger = new Logger(FeedHandlerService.name, true);

  @Client(configKafka)
  private client: ClientKafka;

  async init() {
    const requestPatterns = [
      'entity-created',
      'test.send.msg',
    ];

    requestPatterns.forEach(pattern => {
      this.client.subscribeToResponseOf(pattern);
    });

    //await this.client.connect();
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


  // working
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

  async enableDataFeed(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
    throw new Error('Method not implemented.');
  }


}
