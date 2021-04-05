import { Controller, Get, Logger, Param } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { Decimals, EthConnectService } from './eth-connect.service';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;
  //private signer: ethers.Wallet;

  constructor(private readonly ethConnectService: EthConnectService) {
    this.init();
  }

  init(): void {
    this.provider = this.ethConnectService.initProvider();
    this.ethConnectService.logProviderConnection(this.provider);

    this.ethConnectService.initOracleContracts(this.provider);
    this.start();
  }

  // http://localhost:3000/eth/start
  @Get('/eth/start')
  @Cron('1 * * * * *')
  start(): string {
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
  loadEvents(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getOracleContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for loading events answerUpdated');
      return '404';
    }
    this.ethConnectService
      .loadEventAnswerUpdated(contract)
      .then((events) => {
        //this.logger.log('got something: ' + events);
      })
      .catch((error) => this.logger.error(error));
    return '200';
  }

  // http://localhost:3000/eth/log/answerUpdated/btcusd
  @Get('/eth/log/answerUpdated/:pair')
  loadLogEvents(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getOracleContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for loading events answerUpdated');
      return '404';
    }
    this.ethConnectService
      .loadLogEventAnswerUpdated(contract, 10, 200, 4)
      .then((events) => {
        this.logger.log('Found ' + events.length + ' logged event(s) "AnswerUpdated" for ' + pair);
      })
      .catch((error) => this.logger.error(error));
    return '200';
  }
}
