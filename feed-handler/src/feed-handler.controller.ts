import { Controller } from '@nestjs/common/decorators/core/controller.decorator';
import { UseFilters } from '@nestjs/common/decorators/core/exception-filters.decorator';
import { Body } from '@nestjs/common/decorators/http';
import { Post } from '@nestjs/common/decorators/http/request-mapping.decorator';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';
import { Logger } from '@nestjs/common/services/logger.service';

import { 
  FeedConfig,
  HttpExceptionFilterCust,
  HttpExceptionService,
  RelayActionResult, 
  VALID_OPT 
} from '@relayd/common';

import { validateOrReject } from 'class-validator';

import { FeedHandlerService } from './feed-handler.service';

/**
 * Data Feed Handler controller
 */
@Controller()
export class FeedHandlerController { // implements OnModuleInit

  /** 
   * Default constructor 
   */
  constructor(
    private readonly feedHandlerService: FeedHandlerService,
    private readonly httpExceptionService: HttpExceptionService
  ) { }

  /** Dedicated logger instance */
  private readonly logger = new Logger(FeedHandlerController.name, true);

  /**
   * Default init method
   */
  async onModuleInit() {
    this.feedHandlerService.init()
      .catch(async (error) => {
        this.logger.error('Feed Handler service failed to init. Stopping it \n'+error);
        await this.onApplicationShutdown('INIT_FAIL');
      });
  }

  /**
   * Default shutdown method
   * @param signal Signal at the origin of this shutdown call
   */
  async onApplicationShutdown(signal: string) {
    this.logger.warn('Shutting down Feed Handler on signal ' + signal); // e.g. "SIGINT"
    if (this.feedHandlerService)
      await this.feedHandlerService.shutdown(signal)
        .catch((error) => this.logger.error('Improper shutdown \n'+error));
  }

  /**
   * Add or Enable a price feed by specifying its config. ID must be unique to create a new feed and corresponding oracle data contract.
   * 
   * @param feedConfig the data feed configuration to be added/created
   * @returns Result of the data feed addition
   */
  // $ curl -d '{"id":"scrtusd", "name":"SCRT/USD price feed", "updateMode":"listen"}' -H "Content-Type: application/json" -X POST http://localhost:3000/relay/feed/price
  @Post('/relay/feed/price')
  @UseFilters(HttpExceptionFilterCust.for())
  async addFeedPrice(@Body() feedConfig: FeedConfig): Promise<RelayActionResult> {
    this.logger.log('Request for adding a new Data Feed: ' + feedConfig.id);
    this.logger.debug('Payload:\n' + JSON.stringify(feedConfig));

    const valid = await validateOrReject(feedConfig, VALID_OPT) // 
      .catch(error => {
        throw this.httpExceptionService.clientError(HttpStatus.BAD_REQUEST, feedConfig, error);
      });

    return await this.feedHandlerService.createFeed(feedConfig)
      .then((result) => {
        this.logger.log('Feed submission result \n' + JSON.stringify(result));
        return result;
      })
      .catch((error) => {
        throw this.httpExceptionService.serverError(HttpStatus.INTERNAL_SERVER_ERROR, feedConfig, error);
      });
  }

}

