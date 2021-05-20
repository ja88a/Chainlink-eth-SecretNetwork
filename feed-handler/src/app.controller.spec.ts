import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedHandlerController } from './feed-handler.controller';
import { FeedHandlerService } from './feed-handler.service';

describe('ClRelayController', () => {
  let appController: FeedHandlerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [FeedHandlerController],
      providers: [FeedHandlerService],
    }).compile();

    appController = app.get<FeedHandlerController>(FeedHandlerController);
  });

  describe('root', () => {
    it('should return "Chainlink Relayer here"', () => {
      expect(appController.addFeedPricePair(null)).toBe<string>('Chainlink Relayer here');
    });
  });
});
