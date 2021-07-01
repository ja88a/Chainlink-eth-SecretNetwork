import { Module } from '@nestjs/common/decorators/modules/module.decorator';
import { ConfigModule } from '@nestjs/config';

import { EthConnectController } from './eth-connect.controller';
import { EthConnectService } from './eth-connect.service';
import { HttpExceptionService, RelaydConfigService } from '@relayd/common';
//import { EthConnectTestModule } from './eth-connect-test/eth-connect.module';

@Module({
  imports: [ConfigModule.forRoot()], //, EthConnectTestModule
  controllers: [EthConnectController],
  providers: [EthConnectService, HttpExceptionService, RelaydConfigService],
})
export class EthConnectModule {}
