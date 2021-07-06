import { Module } from '@nestjs/common/decorators/modules/module.decorator';
import { ConfigModule } from '@nestjs/config';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';
import { HttpExceptionService, RelaydConfigService } from '@relayd/common';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [FeedHandlerController], 
  providers: [FeedHandlerService, HttpExceptionService, RelaydConfigService],
})
export class FeedHandlerModule {}
