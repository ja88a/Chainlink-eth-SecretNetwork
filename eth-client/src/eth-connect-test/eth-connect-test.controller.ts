import { ethers, Event } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { Decimals, EthConnectTestService } from './eth-connect-test.service';
import { CustExceptionFilter } from '@relayd/common';

import { Controller, UseFilters } from '@nestjs/common/decorators/core';
import { Get, Param } from '@nestjs/common/decorators/http';
import { Logger } from '@nestjs/common/services/logger.service';
import { Cron } from '@nestjs/schedule/dist/decorators/cron.decorator';

@Controller()
export class EthConnectTestController {
  private readonly logger = new Logger(EthConnectTestController.name);

  private provider: ethers.providers.Provider;

  constructor(
    private readonly ethConnectService: EthConnectTestService
  ) { }

  async onModuleInit() {
    this.provider = this.ethConnectService.initProvider();
    this.ethConnectService.logProviderConnection(this.provider);

    this.ethConnectService.initOracleContracts(this.provider);
  }

  // http://localhost:3000/eth/start
  @Get('/eth/polling')
  @Cron('3 * * * * *')
  pollContractOraclePrice(): string {
    const timeFetchStart = Date.now();
    this.ethConnectService
      .loadAllContractData()
      .then((result: Map<string, Result>) => {
        this.logger.debug('Fetching all contracts data took ' + (Date.now() - timeFetchStart) + ' ms');
        this.logger.debug('Nb tracked records: ' + this.ethConnectService.getOracleContractData().length);

        result.forEach((value: Result, key: string) => {
          const priceRaw = value['answer'];
          let price = ethers.utils.formatUnits(priceRaw, Decimals.FIAT);
          price = ethers.utils.commify(price);
          this.logger.log(
            'Oracle price for ' +
              key +
              ': ' +
              price +
              '\tset at ' +
              new Date(value['updatedAt'] * 1000).toISOString() +
              ' round ' +
              value['answeredInRound']
          );
        });
        //this.logger.debug('btcusd price: ' + result.get(CstPair.BTCUSD)['answer']);
      })
      .catch((error) => this.logger.error("Failed to fetch all oracles' data\n" + error, error));
    return '200';
  }

  // http://localhost:3000/eth/event/answerUpdated/btcusd
  @Get('/eth/event/answerUpdated/:pair')
  loadEventAnswerUpdated(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getOracleContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for loading events answerUpdated');
      return '404';
    }
    this.ethConnectService
      .loadEventAnswerUpdated(contract, 200)
      .then((events: Event[]) => {
        events?.forEach(updEvent => {
          if (updEvent.decodeError) {
            this.logger.warn("Event Decode Error found for AnswerUpdated on "+ contract.address + ' ' + updEvent.decodeError)
          }
          this.logger.debug(updEvent);
          //this.logger.log('Current value: ' + updEvent.decode('data'));
        });
        this.logger.log('got something: ' + events);
      })
      .catch((error) => this.logger.error(error));
    return '200';
  }

  // http://localhost:3000/eth/log/answerUpdated/btcusd
  @Get('/eth/log/answerUpdated/:pair')
  @UseFilters(new CustExceptionFilter())
  loadLogEvents(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getOracleContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for loading events answerUpdated');
      return '404';
    }
    this.ethConnectService
      .loadLogEventAnswerUpdated(contract, 10, 1000, 10)
      .then((events) => {
        this.logger.log('Found ' + events.length + ' logged event(s) "AnswerUpdated" for ' + pair);
      })
      .catch((error) => this.logger.error(error));
    return '200';
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
