import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ScrtContractController } from './scrt-contract.controller';
import { ScrtContractService } from './scrt-contract.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [ScrtContractController],
  providers: [ScrtContractService],
})
export class ScrtContractModule {}
