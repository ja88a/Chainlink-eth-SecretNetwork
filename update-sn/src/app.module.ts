import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EthConnectModule } from './listen-eth/eth-connect.module';

@Module({
  imports: [ConfigModule.forRoot(), EthConnectModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
