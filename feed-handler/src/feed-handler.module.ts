import { Module } from '@nestjs/common';
//import { Module } from '@nestjs/common/decorators/modules/module.decorator';
import { ConfigModule } from '@nestjs/config';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';
import { HttpExceptionService } from './http.error';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [FeedHandlerController], 
  providers: [FeedHandlerService, HttpExceptionService],
})
export class FeedHandlerModule {}
