import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RelayEthConnectController } from './clRelay.eth-connect.controller';
import { RelayEthConnectService } from './clRelay.eth-connect.service';

@Module({
  imports: [ConfigModule.forRoot()], // , ScheduleModule.forRoot()
  controllers: [RelayEthConnectController],
  providers: [RelayEthConnectService],
})
export class RelayEthConnectModule {}