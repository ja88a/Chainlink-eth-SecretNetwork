import { ValidationPipe } from '@nestjs/common/pipes';
import { NestFactory } from '@nestjs/core';
import { EthConnectModule } from './eth-connect.module';
import { configKafka } from '@relayd/common';

async function bootstrap() {
  const app = await NestFactory.create(EthConnectModule, {
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
