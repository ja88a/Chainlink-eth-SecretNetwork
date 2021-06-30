import { NestFactory } from '@nestjs/core';
import { KafkaUtils, RelaydKClient, RelaydKGroup } from '@relayd/common';
import { EthConnectModule } from './eth-connect.module';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(EthConnectModule, {
    //logger: ['error', 'warn'],
    //logger: false,
  });

  const msConfig = KafkaUtils.getConfigKafka(RelaydKClient.ETH, RelaydKGroup.ETH);
  app.connectMicroservice(msConfig);

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
