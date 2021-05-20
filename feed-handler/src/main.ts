import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core/nest-factory';
//import { NestFactory } from '@nestjs/core';
//import { Transport } from '@nestjs/microservices';
import { FeedHandlerModule } from './feed-handler.module';
import { configKafka } from '@relayd/common';

async function bootstrap() {

  const app = await NestFactory.create(FeedHandlerModule, {
    // logger: ['error', 'warn'],
    // logger: false,
  });
  app.connectMicroservice(configKafka);
  // app.connectMicroservice(configMS);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  
  await app.startAllMicroservicesAsync();
  await app.listen(3000);
}
bootstrap();
