import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';
import { HttpExceptionService } from '@relayd/common';

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
      expect(appController.addFeedPricePair(null).then((result) => { console.error('unexpected result '+result) })).toThrow();
      //toBe<string>('Chainlink Relayer here');
    });
  });

  describe('Test adding a new valid price feed config', () => {
    it('should return a client error', () => {
      //expect(appController.addFeedPricePair(null)).toThrowError();
      expect(appController.addFeedPricePair(null).then((result) => { console.error('unexpected result '+result) })).toThrow();
      //toBe<string>('Chainlink Relayer here');
    });
  });
});
