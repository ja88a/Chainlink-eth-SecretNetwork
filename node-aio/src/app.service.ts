import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private configService: ConfigService) {}

  getHello(): string {
    this.logger.debug('greetings done');
    return '<html><body><h1>Welcome to <i>relayd</i></h1>' +
      '<div id="config">' + 
      'Ethereum Network: ' + this.configService.get<string>('ETH_PROVIDER_NETWORK_ID') + '<br/>' +
      'Secret Network: ' + this.configService.get<string>('SECRET_CHAIN_ID') + '<br/>' + 
      '</div>' +
      '</body></html>';
  }
}
