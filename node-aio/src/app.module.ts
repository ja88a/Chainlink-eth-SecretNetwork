import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrtConnectModule } from '@relayd/scrt-client';
import { EthConnectModule } from '@relayd/eth-client';
import { FeedHandlerModule } from '@relayd/feed-handler';

@Module({
  imports: [ConfigModule.forRoot(), EthConnectModule, ScrtConnectModule, FeedHandlerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
