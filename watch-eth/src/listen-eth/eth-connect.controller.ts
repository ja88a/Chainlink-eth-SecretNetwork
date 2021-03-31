import { Controller, Get, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { EthConnectService } from './eth-connect.service';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectService.name);

  private provider: ethers.providers.Provider;
  private signer: ethers.Wallet;
  private contracts: Map<string, ethers.Contract>;
  //private contractsData: Map<string, Result>;

  constructor(private readonly ethConnectService: EthConnectService) {
    this.init();
  }

  init(): void {
    this.provider = this.ethConnectService.initProvider();
    this.ethConnectService.logProviderConnection(this.provider);

    this.contracts = this.ethConnectService.initOracleContracts(this.provider);
    this.start();
  }

  // http://localhost:3000/eth/start
  @Get('/eth/start')
  @Cron('2 * * * * *')
  start(): string {
    //this contractsData =
    this.ethConnectService.loadContractOracleValues(this.contracts);
    return '200';
  }
}
