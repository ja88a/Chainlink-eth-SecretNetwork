import { ValidatorOptions } from 'class-validator';
import { KafkaOptions, Transport } from '@nestjs/microservices';
import { KafkaStreamsConfig } from 'kafka-streams';

const KAFKA_CLIENT_ID = 'CLRelayClient';
const KAFKA_GROUP_ID = 'CLRelayGroup';
const KAFKA_HOST_PORT = '127.0.0.1:9092';


/**
 * Broker Kafka Server Configuration
 */
export const configKafka: KafkaOptions = {
  transport: Transport.KAFKA,

  options: {
    client: {
      clientId: KAFKA_CLIENT_ID,
      // TODO PROD Review Kafka config: Kafka hostname
      brokers: [KAFKA_HOST_PORT],
    },
    consumer: {
      groupId: KAFKA_GROUP_ID,
      // TODO PROD Review Kafka config allowAutoTopicCreation
      allowAutoTopicCreation: true,
    },
  }
};

export const configKafkaNative: KafkaStreamsConfig = {
  noptions: {
      "metadata.broker.list": KAFKA_HOST_PORT,
      "group.id": KAFKA_GROUP_ID,
      "client.id": KAFKA_CLIENT_ID,
      "event_cb": true,
      "compression.codec": "snappy",
      "api.version.request": true,

      "socket.keepalive.enable": true,
      "socket.blocking.max.ms": 100,

      "enable.auto.commit": false,
      "auto.commit.interval.ms": 100,

      "heartbeat.interval.ms": 250,
      "retry.backoff.ms": 250,

      "fetch.min.bytes": 100,
      "fetch.message.max.bytes": 2 * 1024 * 1024,
      "queued.min.messages": 100,

      "fetch.error.backoff.ms": 100,
      "queued.max.messages.kbytes": 50,

      "fetch.wait.max.ms": 1000,
      "queue.buffering.max.ms": 1000,

      "batch.num.messages": 10000
  },
  tconf: {
      "auto.offset.reset": 'earliest',
      "request.required.acks": 1
  },
  batchOptions: {
      batchSize: 5,
      commitEveryNBatch: 1,
      concurrency: 1,
      commitSync: false,
      noBatchCommits: false
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

/**
 * Messaging topics / channels for etmiting or listening to
 */
export enum ETopics {
  FEED = 'relayd.feed',
  CONTRACT = 'relayd.contract'
} 