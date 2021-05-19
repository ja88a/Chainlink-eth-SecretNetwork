import { Body, Controller, Get, Logger, OnModuleInit, Post } from '@nestjs/common';
import { ClRelayService } from './clRelay.service';
import { Ctx, MessagePattern, KafkaContext, Payload } from '@nestjs/microservices';
import { FeedConfig, DataFeedEnableResult, TMessageType0 } from './clRelay.data';
import { UseFilters } from '@nestjs/common';
import { CustExceptionFilter, HttpExceptionService } from './http.error';
import { HttpStatus } from '@nestjs/common';
import { validateOrReject } from 'class-validator';
import { VALID_OPT } from './clRelay.config';

@Controller()
export class ClRelayController implements OnModuleInit {
  constructor(
    private readonly clRelayService: ClRelayService,
    private readonly httpExceptionService: HttpExceptionService
    ) { }

  private readonly logger = new Logger(ClRelayController.name, true);

  async onModuleInit() {
    this.clRelayService.init();
  }

  @Get('/relay/test/msg')
  sendTestMsg(): any {
    return this.clRelayService.sendTestMsg();
  }

  @MessagePattern('test.send.msg')
  handleTestMsg(@Payload() message: TMessageType0, @Ctx() context: KafkaContext): any {
    return this.clRelayService.handleTestMsg(message, context);
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
      const resultAction = this.clRelayService.enableDataFeed(feedConfig)
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

