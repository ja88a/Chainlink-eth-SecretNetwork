import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ScrtConnectController } from './scrt-connect.controller';
import { ScrtConnectService } from './scrt-connect.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [ScrtConnectController],
  providers: [ScrtConnectService],
})
export class ScrtConnectModule {}
