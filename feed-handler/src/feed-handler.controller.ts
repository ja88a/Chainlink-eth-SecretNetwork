import { ConfigService } from '@nestjs/config';
import { Body, Controller, Get, HttpStatus, Logger, Post, UseFilters } from '@nestjs/common';
import { Ctx, KafkaContext, MessagePattern, Payload } from '@nestjs/microservices';

import { DataFeedEnableResult, FeedConfig, TMessageType0, VALID_OPT } from '@relayd/common';
import { CustExceptionFilter, HttpExceptionService } from '@relayd/common';

import { validateOrReject } from 'class-validator';
import { FeedHandlerService } from './feed-handler.service';

@Controller()
export class FeedHandlerController { // implements OnModuleInit
  constructor(
    private readonly feedHandlerService: FeedHandlerService,
    private readonly httpExceptionService: HttpExceptionService
  ) { }

  private readonly logger = new Logger(FeedHandlerController.name, true);

  async onModuleInit() {
    this.feedHandlerService.init();
  }

  @Get('/relay/test/msg')
  sendTestMsg(): any {
    return this.feedHandlerService.sendTestMsg();
  }

  @MessagePattern('test.send.msg')
  handleTestMsg(@Payload() message: TMessageType0, @Ctx() context: KafkaContext): any {
    return this.feedHandlerService.handleTestMsg(message, context);
  }

  /**
   * Add or Enable a price feed by specifying its config. ID must be unique to create a new feed and corresponding oracle data contract.
   * 
   * @param feedConfig the data feed configuration to be added/created
   * @returns Result of the data feed addition
   */
  // $ curl -d '{"id":"scrtusd", "name":"SCRT/USD price feed", "updateMode":"listen"}' -H "Content-Type: application/json" -X POST http://localhost:3000/relay/feed/price
  @Post('/relay/feed/price')
  @UseFilters(new CustExceptionFilter())
  async addFeedPricePair(@Body() feedConfig: FeedConfig): Promise<DataFeedEnableResult> {
    this.logger.log('Request for adding a new Price Data Feed');
    this.logger.debug('Payload:\n' + JSON.stringify(feedConfig));

    const valid = validateOrReject(feedConfig, VALID_OPT).catch(errors => {
      throw this.httpExceptionService.clientError(HttpStatus.BAD_REQUEST, feedConfig, errors);
    });

    return await valid.then(async () => {
      try {
        const actionRes = await this.feedHandlerService.createFeed(feedConfig);
        this.logger.log('Price Data Feed creation result: ' + JSON.stringify(actionRes));
        return actionRes;
      } catch (error) {
        throw this.httpExceptionService.serverError(HttpStatus.INTERNAL_SERVER_ERROR, feedConfig, error);
      }
    });
  }

}

