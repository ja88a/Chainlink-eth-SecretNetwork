import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
//import { ScrtConnectModule } from 'src/scrt-connect/scrt-connect.module';

import { ScrtContractController } from './scrt-contract.controller';
import { ScrtContractService } from './scrt-contract.service';

@Module({
  imports: [ConfigModule.forRoot()], //, ScrtConnectModule
  controllers: [ScrtContractController],
  providers: [ScrtContractService],
})
export class ScrtContractModule {}
