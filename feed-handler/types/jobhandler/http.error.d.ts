import { ExceptionFilter, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost): void;
}
export declare class CustExceptionFilter implements ExceptionFilter {
    private readonly configService?;
    private readonly logger;
    private readonly errorComMode;
    constructor(configService?: ConfigService);
    catch(exception: any, host: ArgumentsHost): any;
}
export declare class HttpExceptionService {
    private configService;
    private readonly errorExtMode;
    constructor(configService: ConfigService);
    deny(): HttpException;
    serverError(errorCode: HttpStatus, input?: any, error?: Error): HttpException;
    clientError(errorCode: HttpStatus, input?: any, error?: Error): HttpException;
}
//# sourceMappingURL=http.error.d.ts.map