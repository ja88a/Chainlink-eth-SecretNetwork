import { NestFactory } from '@nestjs/core/nest-factory';
import { configKafka } from '@relayd/common';
import { FeedHandlerModule } from './feed-handler.module';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';

async function bootstrap() {

  const app = await NestFactory.create(FeedHandlerModule, {
    // logger: ['error', 'warn'],
    // logger: false,
  });

  app.connectMicroservice(configKafka);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  
  app.enableShutdownHooks();

  await app.startAllMicroservicesAsync();
  await app.listen(3000);
}
bootstrap();
