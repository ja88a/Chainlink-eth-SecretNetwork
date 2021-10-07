import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { KafkaUtils, RelaydKClient, RelaydKGroup } from '@relayd/common';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    //logger: ['error', 'warn'],
    //logger: false,
  });

  const msConfig = KafkaUtils.getConfigKafka(RelaydKClient.SCRT, RelaydKGroup.SCRT);
  app.connectMicroservice(msConfig);

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
