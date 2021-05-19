import { OnModuleInit } from '@nestjs/common';
import { ClRelayService } from './clRelay.service';
import { KafkaContext } from '@nestjs/microservices';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from './clRelay.data';
import { HttpExceptionService } from './http.error';
export declare class ClRelayController implements OnModuleInit {
    private readonly clRelayService;
    private readonly httpExceptionService;
    constructor(clRelayService: ClRelayService, httpExceptionService: HttpExceptionService);
    private readonly logger;
    onModuleInit(): Promise<void>;
    sendTestMsg(): any;
    handleTestMsg(message: TMessageType0, context: KafkaContext): any;
    /**
     * Add or Enable a price feed by specifying its config. ID must be unique to create a new feed and corresponding oracle data contract.
     *
     * $ curl -d '{"id":"scrtusd", "name":"SCRT/USD price feed", "updateMode":"listen"}' -H "Content-Type: application/json" -X POST http://localhost:3000/relay/feed/price
     *
     * @param feedConfig
     * @returns
     */
    addFeedPricePair(feedConfig: FeedConfig): Promise<DataFeedEnableResult>;
}
//# sourceMappingURL=clRelay.controller.d.ts.map