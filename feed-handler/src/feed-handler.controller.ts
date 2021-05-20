import { Body, Controller, Get, HttpStatus, Logger, OnModuleInit, Post, UseFilters } from '@nestjs/common';
import { Ctx, KafkaContext, MessagePattern, Payload } from '@nestjs/microservices';

import { DataFeedEnableResult, FeedConfig, TMessageType0, VALID_OPT } from '@relayd/common';

import { validateOrReject } from 'class-validator';
import { FeedHandlerService } from './feed-handler.service';
import { CustExceptionFilter, HttpExceptionService } from './http.error';

@Controller()
export class FeedHandlerController implements OnModuleInit {
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
   * $ curl -d '{"id":"scrtusd", "name":"SCRT/USD price feed", "updateMode":"listen"}' -H "Content-Type: application/json" -X POST http://localhost:3000/relay/feed/price
   * 
   * @param feedConfig 
   * @returns 
   */
  @Post('/relay/feed/price')
  @UseFilters(new CustExceptionFilter())
  async addFeedPricePair(@Body() feedConfig: FeedConfig): Promise<DataFeedEnableResult>  {
    this.logger.debug('Request for enabling data feed. payload: '+JSON.stringify(feedConfig));
    
    const valid = validateOrReject(feedConfig, VALID_OPT).catch(errors => {
      throw this.httpExceptionService.clientError(HttpStatus.BAD_REQUEST, feedConfig, errors);
    });
    
    const result = await valid.then(() => {
      const resultAction = this.feedHandlerService.enableDataFeed(feedConfig)
      .then((actionRes: DataFeedEnableResult) => {
        this.logger.log('Data feed enabled: ' + JSON.stringify(actionRes));
        return actionRes;
      })
      .catch((error: Error) => {
        throw this.httpExceptionService.serverError(HttpStatus.INTERNAL_SERVER_ERROR, feedConfig, error);
      });
      return resultAction;
    });
    return result;
  }



}

