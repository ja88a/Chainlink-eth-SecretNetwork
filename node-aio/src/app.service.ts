import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { Logger } from '@nestjs/common/services/logger.service';
import { RelaydConfigService } from '@relayd/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private config: RelaydConfigService) {}

  getHello(): string {
    this.logger.debug('greetings done');
    return '<html><body><h1>Welcome to <i>relayd</i></h1>' +
      '<div id="config">' + 
      'Mode: ' + this.config.appRunMode + '<br/>' +
      'Ethereum Network: ' + this.config.ethProviderNetworkId + '<br/>' +
      'Secret Network: ' + this.config.secretChainId + '<br/>' + 
      '</div>' +
      '</body></html>';
  }
}
