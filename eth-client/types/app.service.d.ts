import { ConfigService } from '@nestjs/config';
export declare class AppService {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService);
    getHello(): string;
}
//# sourceMappingURL=app.service.d.ts.map