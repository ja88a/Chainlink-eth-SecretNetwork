import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private configService: ConfigService) {}

  getHello(): string {
    this.logger.debug('greetings done');
    return 'Hello! <br/>Secret Network: ' + this.configService.get<string>('SECRET_CHAIN_ID');
  }
}
