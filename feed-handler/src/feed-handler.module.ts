import { Module } from '@nestjs/common/decorators/modules/module.decorator';
import { ConfigModule } from '@nestjs/config';
import { HttpExceptionService, RelaydConfigService } from '@relayd/common';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [FeedHandlerController], 
  providers: [FeedHandlerService, HttpExceptionService, RelaydConfigService],
})
export class FeedHandlerModule {}
