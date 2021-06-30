import { Logger } from "@nestjs/common/services/logger.service";
import { ClientKafka } from "@nestjs/microservices/client/client-kafka";
import { Admin, ITopicConfig, KafkaConfig } from "@nestjs/microservices/external/kafka.interface";
import { KafkaOptions } from "@nestjs/microservices/interfaces/microservice-configuration.interface";
import { KafkaStreamsConfig, KStream } from "kafka-streams";
import { deepCopyJson } from "../utils/misc.utils";
import { configKafka, configKafkaClient, configKafkaNative, configKafkaTopics, ETopic } from "../config/kafka.config";

export enum RelaydKClient {
  AIO = 'relayd.aio',
  ETH = 'relayd.eth',
  ETH_STREAM = 'relayd.eth.stream',
  SCRT = 'relayd.scrt',
  FEED = 'relayd.feed',
  FEED_STREAM = 'relayd.feed.stream',
  ERR = 'relayd.error'
};

export enum RelaydKGroup {
  AIO = 'relayd.gaio',
  ETH = 'relayd.geth',
  SCRT = 'relayd.gscrt',
  FEED = 'relayd.gfeed',
  ERR = 'relayd.gerror'
};

export class KafkaUtils {

  static getConfigKafka(client: string, group: string, brokers?: string[]): KafkaOptions {
    const config: KafkaOptions = deepCopyJson(configKafka);
    const configClient: KafkaConfig = KafkaUtils.getConfigKafkaClient(client, brokers);
    config.options.client = configClient;
    if (group)
      config.options.consumer.groupId += '_' + group;
    return config;
  }

  static getConfigKafkaClient(client: string, brokers?: string[]): KafkaConfig {
    const configClient: KafkaConfig = deepCopyJson(configKafkaClient);
    configClient.clientId += client;
    if (brokers)
      configClient.brokers = brokers;
    return configClient;
  }

  static getConfigKafkaNative(client: RelaydKClient, group: string, brokerList?: string): KafkaStreamsConfig {
    const config: KafkaStreamsConfig = deepCopyJson(configKafkaNative);
    config.noptions['client.id'] += client;
    if (group)
      config.noptions['group.id'] += '_' + group;
    if (brokerList)
      config.noptions['metadata.broker.list'] = brokerList;
    return config;
  }

  /**
  * Create the required default topics, if necessary / not already existing
  */
  static async createTopicsDefault(clientKafka: ClientKafka, logger: Logger): Promise<boolean> {
    try {
      const kafkaAdmin: Admin = clientKafka.createClient().admin();
      //const kafkaAdmin: Admin = this.kafkaClient.admin();
      const topicsExisting = await kafkaAdmin.listTopics();

      const appTopics: ITopicConfig[] = [];
      for (const topic in ETopic) {
        const topicName = ETopic[topic];
        const topicExists = topicsExisting.includes(topicName);
        if (!topicExists) {
          logger.debug('Create Topic \'' + topicName + '\' from ' + JSON.stringify(configKafkaTopics.get(topicName)));
          appTopics.push({
            topic: topicName,
            numPartitions: configKafkaTopics.get(topicName).numPartitions | 1,
            replicationFactor: configKafkaTopics.get(topicName).replicationFactor | 1,
          })
        }
      }

      const resultStore: Promise<boolean>[] = [];
      if (appTopics.length > 0) {
        const result = kafkaAdmin.createTopics({
          topics: appTopics,
          waitForLeaders: true,
        }).then((success) => {
          logger.log('Creation of ' + appTopics.length + ' default topics - Success: ' + success);
          return true;
        }).catch((error) => {
          throw new Error('Failed to create topics ' + JSON.stringify(appTopics) + '\n' + error);
        });
        resultStore.push(result);
      }

      return Promise.all(resultStore)
        .then((results: boolean[]) => {
          let finalResult = true;
          results.forEach(element => {
            finalResult = finalResult && element;
          });
          return finalResult;
        }).catch((error) => {
          throw new Error('Failed to create default Topics\n' + error);
        });
    } catch (error) {
      throw new Error('Failed to create missing default Topics\n' + error);
    }
  }

  /**
   * Log info about the loaded (or not) native node-rdkafka librdkafka
   */
  static getKafkaNativeInfo(logger?: Logger): { feature: string, version: string } {
    let featureInfo: string;
    let versionInfo: string;
    try {
      const Kafka = require('node-rdkafka');
      featureInfo = Kafka.features;
      versionInfo = Kafka.librdkafkaVersion;
      logger?.debug('Kafka features: ' + featureInfo);
      logger?.debug('librdkafka version: ' + versionInfo);
    }
    catch (error) {
      logger?.warn('Failed loading node-rdkafka (native). Using kafkajs\n' + error);
    }
    return {
      feature: featureInfo,
      version: versionInfo
    };
  }

  /** 
   * Initialize a Stream on a given topic 
   */
  static async initKStreamWithLogging(streamFactory, topicName: string, logger: Logger): Promise<KStream | Error> {
    logger.debug('Creating kStream for \'' + topicName + '\'');
    const topicStream: KStream = streamFactory.getKStream(topicName);

    topicStream
      .forEach(message => {
        logger.debug('Record msg on stream \'' + topicName + '\': '
          + '\nKey: ' + (message.key ? message.key.toString('utf8') : '-')
          + '\nPartition: ' + message.partition
          + '\tOffset: ' + message.offset
          + '\tTimestamp: ' + message.timestamp
          + '\tSize: ' + message.size
          + '\nValue :' + (message.value ? message.value.toString('utf8') : null));
      });

    //const outputStreamConfig: KafkaStreamsConfig = null;
    await topicStream.start(
      () => {
        logger.debug('kStream on \'' + topicName + '\' ready. Started');
      },
      (error) => {
        logger.error('Kafka Failed to start Stream on \'' + topicName + '\'\n' + error);
      }
    );
    return topicStream;
  }
}