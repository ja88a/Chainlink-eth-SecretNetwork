import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { EthConnectController } from './eth-connect.controller';
import { EthConnectService } from './eth-connect.service';

//import { ethers } from 'ethers';

@Module({
  imports: [ConfigModule.forRoot(), ScheduleModule.forRoot()],
  controllers: [EthConnectController],
  providers: [EthConnectService],
})
export class EthConnectModule {}
