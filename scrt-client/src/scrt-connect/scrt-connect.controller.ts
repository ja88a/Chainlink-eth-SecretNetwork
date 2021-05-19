import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ScrtConnectService } from './scrt-connect.service';
import { CosmWasmClient } from 'secretjs';
import { HttpErrorByCode } from '@nestjs/common/utils/http-error-by-code.util';

@Controller()
export class ScrtConnectController {
  private readonly logger = new Logger(ScrtConnectController.name);

  //private scrtClient: CosmWasmClient;

  constructor(private readonly scrtConnectService: ScrtConnectService) {
    this.init();
  }

  init(): void {
    //this.scrtClient = this.scrtConnectService.initScrtClient();
  }

  // http://localhost:3000/scrt/connect/info
  @Get('/scrt/connect/info')
  async connect(): Promise<any> {
    const clientConnectInfo = await this.scrtConnectService
      .initScrtClientSigning()
      .then((client) => {
        return this.scrtConnectService.getClientSigningInfo(client);
      })
      .catch((error) => {
        this.logger.error('Failed to connect to SecretNetwork\n' + error, error);
        throw new InternalServerErrorException(HttpErrorByCode[500]);
      });
    return clientConnectInfo;
  }

  @Get('/scrt/connect/error')
  error() {
    //return HttpErrorByCode[500].toString();
    throw new InternalServerErrorException(HttpErrorByCode[500]);
  }
}
