import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClRelayModule } from './jobhandler/clRelay.module';
import { RelayEthConnectModule } from './watch-eth/clRelay.eth-connect.module';

@Module({
  imports: [ConfigModule.forRoot(), ClRelayModule, RelayEthConnectModule],
  controllers: [AppController], // 
  providers: [AppService],
})
export class AppModule {}
