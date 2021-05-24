import { ValidatorOptions } from 'class-validator';
import { KafkaOptions, Transport } from '@nestjs/microservices';

/**
 * Broker Kafka Server Configuration
 */
export const configKafka: KafkaOptions = {
  transport: Transport.KAFKA,

  options: {
    client: {
      clientId: 'CLRelayClient',
      // TODO PROD Review ENV config
      brokers: ['127.0.0.1:9092'],
    },
    consumer: {
      groupId: 'CLRelay',
      allowAutoTopicCreation: true,
    },
  }
};

/**
 * Data Object IO validation
 */
// TODO PROD Review settings
export const VALID_OPT: ValidatorOptions = {
  skipMissingProperties: false,
  whitelist: true,
  forbidNonWhitelisted: true,
  //groups: string[],
  dismissDefaultMessages: true,
  validationError: {
    target: true,
    value: true,
  },
  forbidUnknownValues: true,
  stopAtFirstError: true
};

/**
 * Possible config values for the External communication of the service's runtime errors
 */
export enum EErrorExt {
  DEBUG = 'debug',
  STANDARD = 'standard',
  DENY = 'deny',
  // TODO PROD Change to STD or DENY
  default = DEBUG
};