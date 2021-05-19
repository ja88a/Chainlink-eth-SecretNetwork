import { EthConnectService } from './eth-connect.service';
export declare class EthConnectController {
    private readonly ethConnectService;
    private readonly logger;
    private provider;
    constructor(ethConnectService: EthConnectService);
    init(): void;
    start(): string;
    loadEventAnswerUpdated(pair: string): string;
    loadLogEvents(pair: string): string;
    listenEventAnswerUpdated(pair: string): string;
}
//# sourceMappingURL=eth-connect.controller.d.ts.map