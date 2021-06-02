import { feedConfigPrice_ok_min_1_btcusd } from './testdata/feed-config-price-1.data';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';
import { HttpExceptionService } from '@relayd/common';
import { feedConfigPrice_ok_1_btcusd_noproxy } from './testdata/feed-config-price-1.data'

describe('ClRelayController', () => {
  let appController: FeedHandlerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [FeedHandlerController],
      providers: [FeedHandlerService, HttpExceptionService],
    }).compile();

    appController = app.get<FeedHandlerController>(FeedHandlerController);
  });

  describe('Test adding a null price feed config', () => {
    it('should return a client error', () => {
      //expect(appController.addFeedPricePair(null)).toThrowError();
      expect(appController.addFeedPricePair(null).then((result) => { console.error('unexpected result ' + result) })).toThrow();
      //toBe<string>('Chainlink Relayer here');
    });
  });

  describe('Test adding a new valid price feed config 1', () => {
    it('should return a client error', () => {
      console.log('Test adding price feed config:\n' + JSON.stringify(feedConfigPrice_ok_1_btcusd_noproxy))
      expect(appController.addFeedPricePair(feedConfigPrice_ok_1_btcusd_noproxy)
        .then((result) => { console.error('unexpected result ' + result) })).toThrow();
    });
  });

  describe('Test adding a new min default valid price feed config 2', () => {
    it('should return a client error', () => {
      console.log('Test adding price feed config 2:\n' + JSON.stringify(feedConfigPrice_ok_min_1_btcusd))
      expect(appController.addFeedPricePair(feedConfigPrice_ok_min_1_btcusd)
        .then((result) => { console.error('unexpected result ' + result) })).toThrow();
    });
  });
});

