import { ethers, Event } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { EthConnectService } from './eth-connect.service';
import { CustExceptionFilter, HttpExceptionService } from '@relayd/common';

import { Controller, UseFilters } from '@nestjs/common/decorators/core';
import { Get, Param } from '@nestjs/common/decorators/http';
import { Logger } from '@nestjs/common/services/logger.service';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectController.name);


  constructor(
    private readonly ethConnectService: EthConnectService,
    private readonly httpExceptionService: HttpExceptionService
  ) { }

  async onModuleInit() {
    this.ethConnectService.initProvider();
    this.ethConnectService.logProviderConnection();
  }

  // http://localhost:3000/eth/event/listen/btcusd
  @Get('eth/event/listen/:pair')
  @UseFilters(new CustExceptionFilter())
  listenEventAnswerUpdated(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getOracleContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for listening to events AnswerUpdated');
      return '404';
    }
    this.ethConnectService
      .listenEventOracleAnswerUpdated(contract);
    return '200';
  }
}
