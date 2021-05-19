import { OnModuleInit } from '@nestjs/common';
import { AppService } from './app.service';
import { ClientKafka, KafkaContext } from '@nestjs/microservices';
declare type TMessageType0 = {
    id: string;
    name: string;
};
export declare class AppController implements OnModuleInit {
    private readonly appService;
    constructor(appService: AppService);
    private readonly logger;
    client: ClientKafka;
    onModuleInit(): void;
    getHello(): string;
    handleEntityCreated(payload: any, context: KafkaContext): Promise<void>;
    sendTestMsg(): string;
    sendTestMsg1(): string;
    sendTestMsg2(): string;
    handleTestMsgAsync(message: TMessageType0, context: KafkaContext): Promise<void>;
    handleTestMsg(message: TMessageType0, context: KafkaContext): any;
}
export {};
//# sourceMappingURL=app.controller.d.ts.map