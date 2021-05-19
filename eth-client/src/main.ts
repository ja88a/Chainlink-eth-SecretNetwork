import { NestFactory } from '@nestjs/core';
import { EthConnectModule } from './eth-connect.module';

async function bootstrap() {
  const app = await NestFactory.create(EthConnectModule, {
    //logger: ['error', 'warn'],
    //logger: false,
  });
  await app.listen(3000);
}
bootstrap();
