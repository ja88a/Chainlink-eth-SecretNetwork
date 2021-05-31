import { KafkaConfig } from 'kafkajs';
import { ValidatorOptions } from 'class-validator';
import { KafkaOptions, Transport } from '@nestjs/microservices';
import { KafkaStreamsConfig } from 'kafka-streams';

const KAFKA_CLIENT_ID = 'CLRelayClient';
const KAFKA_GROUP_ID = 'CLRelayGroup';
const KAFKA_HOST_PORT = '127.0.0.1:9092';


export const configKafkaClient: KafkaConfig = {
  clientId: KAFKA_CLIENT_ID,
  // TODO PROD Review Kafka config: Kafka hostname
  brokers: [KAFKA_HOST_PORT],
}

export const configKafkaConsumer = {
  groupId: KAFKA_GROUP_ID,
  // TODO PROD Review Kafka config allowAutoTopicCreation
  allowAutoTopicCreation: true,
}

/**
 * Broker Kafka Server Configuration
 */
export const configKafka: KafkaOptions = {
  transport: Transport.KAFKA,

  options: {
    client: configKafkaClient,
    consumer: configKafkaConsumer,
  }
};

export const configKafkaNative: KafkaStreamsConfig = {
  noptions: {
      'metadata.broker.list': KAFKA_HOST_PORT,
      'group.id': KAFKA_GROUP_ID,
      'client.id': KAFKA_CLIENT_ID,
      'event_cb': true,
      'compression.codec': 'snappy',
      'api.version.request': true,

      'socket.keepalive.enable': true,
      'socket.blocking.max.ms': 100,

      'enable.auto.commit': false,
      'auto.commit.interval.ms': 100,

      'heartbeat.interval.ms': 250,
      'retry.backoff.ms': 250,

      'fetch.min.bytes': 100,
      'fetch.message.max.bytes': 2 * 1024 * 1024,
      'queued.min.messages': 100,

      'fetch.error.backoff.ms': 100,
      'queued.max.messages.kbytes': 50,

      'fetch.wait.max.ms': 1000,
      'queue.buffering.max.ms': 1000,

      'batch.num.messages': 10000
  },
  tconf: {
      'auto.offset.reset': 'earliest',
      'request.required.acks': 1
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
 * App default topics / channels for emiting or listening to messages
 */
export enum ETopics {
  FEED = 'relayd.feed',
  CONTRACT = 'relayd.contract'
} 

export type ETopicConfig = {
  name: string,
  numPartitions?: number,
  replicationFactor?: number,
};

/**
 * Configuration of messaging topics / channels
 */
// export const configKafkaTopics: Map<String, ETopicConfig> = new Map();
// configKafkaTopics.set(ETopics.FEED, {name: 'relayd.feed', numPartitions: 1, replicationFactor:1});
// configKafkaTopics.set(ETopics.CONTRACT, {name: 'elayd.contract', numPartitions: 1, replicationFactor:1});
export const configKafkaTopics: Map<String, ETopicConfig> = new Map([
  [ETopics.FEED, {name: 'relayd.feed', numPartitions: 1, replicationFactor:1}],
  [ETopics.CONTRACT, {name: 'relayd.contract', numPartitions: 1, replicationFactor:1}],
]);