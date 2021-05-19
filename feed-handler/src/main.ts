import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
//import { Transport } from '@nestjs/microservices';
import { configMS} from "./configMS";
import { configKafka } from './clRelay.config';
import { ClRelayModule } from './jobhandler/clRelay.module';

async function bootstrap() {
  // const app = await NestFactory.create();

  const app = await NestFactory.create(AppModule, { // ClRelayModule
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
