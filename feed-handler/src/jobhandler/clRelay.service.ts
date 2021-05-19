import { Get, Injectable, Logger } from '@nestjs/common';
import { Client, ClientKafka, MessagePattern, Payload, Ctx, KafkaContext, EventPattern } from '@nestjs/microservices';
import { KafkaMessage } from 'kafkajs';
import { Observable } from 'rxjs';
import { configKafka } from './clRelay.config';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from './clRelay.data';

@Injectable()
export class ClRelayService {

  private readonly logger = new Logger(ClRelayService.name, true);

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


  // =======================================================================
  // -- TESTS
  // -----------------------------------------------------------------------

  async enableDataFeed(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult> {
    throw new Error('Method not implemented.');
  }


}
