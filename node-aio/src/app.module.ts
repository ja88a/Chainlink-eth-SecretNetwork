import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrtConnectModule } from '@relayd/scrt-client';
import { EthConnectModule } from '@relayd/eth-client';
import { FeedHandlerModule } from '@relayd/feed-handler';
import { RelaydConfigService, validate } from '@relayd/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
    }),
    EthConnectModule, 
    ScrtConnectModule, 
    FeedHandlerModule
  ],
  controllers: [
    AppController
  ],
  providers: [
    AppService, 
    RelaydConfigService
  ],
})
export class AppModule {}
