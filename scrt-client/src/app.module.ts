import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrtConnectModule } from './scrt-connect/scrt-connect.module';
import { ScrtContractModule } from './scrt-contract/scrt-contract.module';

@Module({
  imports: [ConfigModule.forRoot(), ScrtConnectModule, ScrtContractModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
