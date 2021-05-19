import { Controller, Get, Logger, OnModuleInit } from '@nestjs/common';
import { AppService } from './app.service';
import { configMS } from "./configMS";
//import {Client, ClientKafka, ClientProxy, EventPattern, MessagePattern, Payload} from '@nestjs/microservices';
import { Client, ClientKafka, Ctx, EventPattern, MessagePattern, KafkaContext, Payload } from '@nestjs/microservices';
import { KafkaMessage } from '@nestjs/microservices/external/kafka.interface';
import { Observable } from 'rxjs';
import { Message, ProducerRecord } from 'kafkajs';

type TMessageType0 = { id: string, name: string };

@Controller()
export class AppController implements OnModuleInit {
  constructor(private readonly appService: AppService) { }

  private readonly logger = new Logger(AppController.name);

  @Client(configMS)
  client: ClientKafka;

  // async onModuleInit() {
  //   const requestPatterns = [
  //     'entity-created',
  //     'test.send.msg',
  //   ];

  //   requestPatterns.forEach(pattern => {
  //     this.client.subscribeToResponseOf(pattern);
  //   });

  //   await this.client.connect();
  // }
  onModuleInit() {
    const requestPatterns = [
      'entity-created',
      'test.send.msg',
    ];

    requestPatterns.forEach(pattern => {
      this.client.subscribeToResponseOf(pattern);
    });

    this.client.connect();
  }

  @Get()
  getHello(): string {
    // fire event to kafka
    this.logger.warn(`Firing event to kafka`);
    const result: Observable<string> = this.client.emit<string>('entity-created', 'some entity ' + new Date());
    result.toPromise().then((result: any) => { this.logger.log(`Observable type ${typeof result}: ${JSON.stringify(result)}`)} )
    return this.appService.getHello() + " Event emited";
  }

  @EventPattern('entity-created')
  async handleEntityCreated(@Payload() payload: any, @Ctx() context: KafkaContext) {
    const originalMessage: KafkaMessage = context.getMessage();
    const { headers, offset, timestamp } = originalMessage;
    this.logger.log(`Receiving event on Topic ${context.getTopic()} value: ${JSON.stringify(originalMessage)}`);

    this.logger.log('Received event: '+JSON.stringify(payload));
    //this.logger.log(payload.value + ' created');
  }


  // not working!
  @Get('/test')
  sendTestMsg(): string {
    const newMsg0 = { id: '000', name: 'test000' };
    this.logger.warn(`Sending msg: ${JSON.stringify(newMsg0)}`);

    this.client.emit('test.send.msg', newMsg0);
    //this.client.send('', {'001', 'test001'});
    return JSON.stringify(newMsg0);
  }

  // not working!
  @Get('/test1')
  sendTestMsg1(): string {
    const newMsg0 = { id: '001', name: 'test001' };
    this.logger.warn(`Sending msg: ${JSON.stringify(newMsg0)}`);

    this.client.send('test.send.msg', newMsg0);
    //this.client.send('', {'001', 'test001'});
    return JSON.stringify(newMsg0);
  }

  // working
  @Get('/test2')
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

  // not working!
  @MessagePattern('test.send.msg')
  async handleTestMsgAsync(@Payload() message: TMessageType0, @Ctx() context: KafkaContext) {
    const originalMessage: KafkaMessage = context.getMessage();
    const { headers, offset, timestamp } = originalMessage;
    this.logger.log(`Receiving Async1 msg on Topic ${context.getTopic()} value: ${JSON.stringify(originalMessage)}`);
    this.logger.log(`Received1 message: ${JSON.stringify(message)}`);
  }

  // working
  @MessagePattern('test.send.msg')
  handleTestMsg(@Payload() message: TMessageType0, @Ctx() context: KafkaContext) : any {
    const originalMessage: KafkaMessage = context.getMessage();
    const { headers, offset, timestamp } = originalMessage;
    this.logger.log(`Receiving 2 msg on Topic ${context.getTopic()} value: ${JSON.stringify(originalMessage)}`);
    this.logger.log(`Received2 message: ${JSON.stringify(message)}`);
  }

  /* 
  @MessagePattern('hero.kill.dragon')
  killDragon(@Payload() message: KillDragonMessage, @Ctx() context: KafkaContext): any {
    // Context handling
    this.logger.log(`Topic: ${context.getTopic()}`);
    const originalMessage = context.getMessage();
    const { headers, partition, timestamp } = originalMessage;

    // header + rekey handling
    const realm = 'Nest';
    const heroId = message.heroId;
    const dragonId = message.dragonId;

    const items = [
      { id: 1, name: 'Mythical Sword' },
      { id: 2, name: 'Key to Dungeon' },
    ];

    return {
      headers: {
        kafka_nestRealm: realm
      },
      key: heroId,
      value: items
    }
  }
 */
}

