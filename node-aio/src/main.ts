//import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getConfigKafka, RelaydKClient } from '@relayd/common';
import { ValidationPipe } from '@nestjs/common/pipes';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    //logger: ['error', 'warn'],
    //logger: false,
  });

  const msConfig = getConfigKafka(RelaydKClient.AIO, RelaydKClient.AIO);
  app.connectMicroservice(msConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Starts listening for shutdown hooks
  app.enableShutdownHooks();

  await app.startAllMicroservicesAsync();

  await app.listen(3000);
}
bootstrap();
