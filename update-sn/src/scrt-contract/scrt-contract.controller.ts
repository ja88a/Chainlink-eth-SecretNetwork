import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ScrtContractService } from './scrt-contract.service';
import { HttpErrorByCode } from '@nestjs/common/utils/http-error-by-code.util';

@Controller()
export class ScrtContractController {
  private readonly logger = new Logger(ScrtContractService.name);

  constructor(private readonly scrtConnectService: ScrtContractService) {
    this.init();
  }

  init(): void {
    // nothing yet
  }

  // http://localhost:3000/scrt/connect/info
  @Get('/scrt/contract/info')
  async connect(): Promise<any> {
    return null;
  }

  @Get('/scrt/contract/error')
  error() {
    //return HttpErrorByCode[500].toString();
    throw new InternalServerErrorException(HttpErrorByCode[500]);
  }
}
