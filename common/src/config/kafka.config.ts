import { Transport } from "@nestjs/microservices/enums/transport.enum";
import { CompressionTypes, ConsumerConfig, KafkaConfig, ProducerConfig } from "@nestjs/microservices/external/kafka.interface";
import { KafkaOptions } from "@nestjs/microservices/interfaces/microservice-configuration.interface";
import { KafkaStreamsConfig } from "kafka-streams";

const KAFKA_CLIENT_ID = 'kClient_';
const KAFKA_GROUP_ID = 'kGroupRelayd';
const KAFKA_HOST_PORT = '127.0.0.1:9092';

export const configKafkaClient: KafkaConfig = {
  clientId: KAFKA_CLIENT_ID,
  // TODO PROD Review brokers config: Kafka hostname
  brokers: [KAFKA_HOST_PORT],
  // ssl?: tls.ConnectionOptions | boolean
  // sasl?: SASLOptions
  // connectionTimeout?: number
  // authenticationTimeout?: number
  // reauthenticationThreshold?: number
  // requestTimeout?: number
  // enforceRequestTimeout?: boolean
  // retry?: RetryOptions
  // socketFactory?: ISocketFactory
  // logLevel?: logLevel
  // logCreator?: logCreator
}

export const configKafkaConsumer: ConsumerConfig = {
  groupId: KAFKA_GROUP_ID,
  // TODO PROD Review Kafka config allowAutoTopicCreation
  //allowAutoTopicCreation: true,
  // partitionAssigners?: PartitionAssigner[]
  // metadataMaxAge?: number
  // sessionTimeout?: number
  // rebalanceTimeout?: number
  // heartbeatInterval?: number
  // maxBytesPerPartition?: number
  // minBytes?: number
  // maxBytes?: number
  // maxWaitTimeInMs?: number
  // retry?: RetryOptions & { restartOnFailure?: (err: Error) => Promise<boolean> }
  // maxInFlightRequests?: number
  // readUncommitted?: boolean
  // rackId?: string
}

export const configKafkaProducer: ProducerConfig = {
  // createPartitioner?: ICustomPartitioner
  // retry?: RetryOptions
  // metadataMaxAge?: number
  // allowAutoTopicCreation?: boolean
  // idempotent?: boolean
  // transactionalId?: string
  // transactionTimeout?: number
  // maxInFlightRequests?: number
}

// compression: CompressionTypes.GZIP,

/**
 * Broker Kafka Server Configuration
 */
export const configKafka: KafkaOptions = {
  transport: Transport.KAFKA,

  options: {
    client: configKafkaClient,
    consumer: configKafkaConsumer,
    producer: configKafkaProducer,
    // postfixId?: string;
    // run?: Omit<ConsumerRunConfig, 'eachBatch' | 'eachMessage'>;
    // subscribe?: Omit<ConsumerSubscribeTopic, 'topic'>;
    // send?: Omit<ProducerRecord, 'topic' | 'messages'>;
    // serializer?: Serializer;
    // deserializer?: Deserializer;
  }
};

export const configKafkaNative: KafkaStreamsConfig = {
  noptions: {
    'metadata.broker.list': KAFKA_HOST_PORT,
    'group.id': KAFKA_GROUP_ID,
    'client.id': KAFKA_CLIENT_ID,
    'event_cb': true,
    'compression.codec': 'none', // TODO PROD default compression: none, gzip, snappy, lz4
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
 * App default topics / channels for emiting or listening to messages
 */
export enum ETopic {
  ERROR_FEED = 'relayd.error.feed',
  ERROR_SOURCE = 'relayd.error.source',
  FEED_CONFIG = 'relayd.feed',
  SOURCE_CONFIG = 'relayd.source',
  SOURCE_DATA = 'relayd.source.data',
  SOURCE_POLLING = 'relayd.source.polling',
}

export type ITopicConfig = {
  name: string;
  numPartitions?: number;
  replicationFactor?: number;
};

/**
 * Configuration of messaging topics / channels
 */
export const configKafkaTopics: Map<String, ITopicConfig> = new Map([
  [ETopic.ERROR_FEED, { name: ETopic.ERROR_FEED, numPartitions: 1, replicationFactor: 1 }],
  [ETopic.ERROR_SOURCE, { name: ETopic.ERROR_SOURCE, numPartitions: 1, replicationFactor: 1 }],
  [ETopic.FEED_CONFIG, { name: ETopic.FEED_CONFIG, numPartitions: 1, replicationFactor: 1 }],
  [ETopic.SOURCE_CONFIG, { name: ETopic.SOURCE_CONFIG, numPartitions: 1, replicationFactor: 1 }],
  [ETopic.SOURCE_DATA, { name: ETopic.SOURCE_DATA, numPartitions: 1, replicationFactor: 1 }],
  [ETopic.SOURCE_POLLING, { name: ETopic.SOURCE_POLLING, numPartitions: 1, replicationFactor: 1 }],
]);

// export class CustStorage extends KStorage {
//   constructor() {
//     super({ // options
//     });
//   } 
// }