import { Module } from '@nestjs/common/decorators/modules/module.decorator';
import { ConfigModule } from '@nestjs/config';

import { EthConnectTestController } from './eth-connect-test.controller';
import { EthConnectTestService } from './eth-connect-test.service';

//import { ScheduleModule } from '@nestjs/schedule';
import { ScheduleModule } from '@nestjs/schedule/dist/schedule.module';

@Module({
  imports: [ConfigModule.forRoot(), ScheduleModule.forRoot()],
  controllers: [EthConnectTestController],
  providers: [EthConnectTestService],
})
export class EthConnectTestModule {}
