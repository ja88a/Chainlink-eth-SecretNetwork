import { KafkaContext } from '@nestjs/microservices';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from './clRelay.data';
export declare class ClRelayService {
    private readonly logger;
    private client;
    init(): Promise<void>;
    sendTestMsg(): TMessageType0;
    handleTestMsg(/*@Payload()*/ message: TMessageType0, /*@Ctx()*/ context: KafkaContext): any;
    enableDataFeed(priceFeedConfig: FeedConfig): Promise<DataFeedEnableResult>;
}
//# sourceMappingURL=clRelay.service.d.ts.map