import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ScrtContractService {
  private readonly logger = new Logger(ScrtContractService.name);

  constructor(private configService: ConfigService) {}
}
