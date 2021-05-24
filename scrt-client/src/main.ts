import { ValidationPipe } from '@nestjs/common/pipes';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configKafka } from '@relayd/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    //logger: ['error', 'warn'],
    //logger: false,
  });
  
  app.connectMicroservice(configKafka);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    })
  );
  
  await app.startAllMicroservicesAsync();
  
  await app.listen(3000);
}
bootstrap();
