import { Module } from '@nestjs/common';
import { ClRelayController } from './clRelay.controller';
import { ClRelayService } from './clRelay.service';
import { ConfigModule } from '@nestjs/config';
import { HttpExceptionService } from './http.error';

@Module({
  imports: [ConfigModule.forRoot()], // , EthConnectModule
  controllers: [ClRelayController], //, 
  providers: [ClRelayService, HttpExceptionService], // 
})
export class ClRelayModule {}
