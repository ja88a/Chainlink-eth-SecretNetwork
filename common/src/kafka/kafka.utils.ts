import { Logger } from "@nestjs/common/services/logger.service";
import { ClientKafka } from "@nestjs/microservices/client/client-kafka";
import { Admin, ITopicConfig, KafkaConfig, Producer } from "@nestjs/microservices/external/kafka.interface";
import { KafkaOptions } from "@nestjs/microservices/interfaces/microservice-configuration.interface";
import { KafkaStreams, KafkaStreamsConfig, KStream, StreamDSL } from "kafka-streams";
import { deepCopyJson } from "../utils/misc.utils";
import { configKafka, configKafkaClient, configKafkaNative, configKafkaTopics, ETopic } from "../config/kafka.config";
import { EErrorType } from "./rpc.error";
import { Kafka } from "kafkajs";

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
  * Create the required topics, if necessary, i.e. not already existing
  * 
  * @param topicsIn the topics to be created, if not specified all known default topics are processed
  * @param clientKafka the kafka client instance to use for reaching the admin API
  * @param logger logger instance
  * @returns 
  */
  static async createTopics(topics: ETopic[], clientKafka: ClientKafka, logger: Logger): Promise<boolean> {
    try {
      const kafkaAdmin: Admin = clientKafka.createClient().admin();
      const topicsExisting = await kafkaAdmin.listTopics();

      const appTopics: ITopicConfig[] = [];
      topics.forEach(topicName => {
        const topicExists = topicsExisting.includes(topicName);
        if (!topicExists) {
          logger.debug('Create Topic \'' + topicName + '\' from ' + JSON.stringify(configKafkaTopics.get(topicName)));
          appTopics.push({
            topic: topicName,
            numPartitions: configKafkaTopics.get(topicName).numPartitions | 1,
            replicationFactor: configKafkaTopics.get(topicName).replicationFactor | 1,
          })
        }
      });

      const resultStore: Promise<boolean>[] = [];
      if (appTopics.length > 0) {
        const result = kafkaAdmin.createTopics({
          topics: appTopics,
          waitForLeaders: true,
        }).then((success) => {
          logger.log('Creation of ' + appTopics.length + ' default topics - Issues met: ' + !success);
          return true;
        }).catch((error) => {
          throw new Error('Failed to create topics ' + JSON.stringify(appTopics) + '\n' + error);
        });
        resultStore.push(result);
      }

      return await Promise.all(resultStore)
        .then((results: boolean[]) => {
          let finalResult = true;
          results.forEach(element => {
            finalResult = finalResult && element;
          });
          return finalResult;
        }).catch((error) => {
          throw new Error('Failed to create a default Topic \n' + error);
        });
    } catch (error) {
      throw new Error('Failed to create missing default Topics \n' + error);
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
  static async initKStreamWithLogging(streamFactory, topicName: string, logger: Logger): Promise<KStream> {
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
        logger.debug('Logging kStream on \'' + topicName + '\' initiated');
      },
      (error) => {
        throw new Error('Kafka client failed to run Logging Stream on \'' + topicName + '\'\n' + error.stack);
      }
    );
    
    return topicStream;
  }

  /**
   * 
   * @param streamFactory 
   * @param topic 
   * @param key 
   * @param value 
   * @param stream 
   * @returns 
   */
  static async writeToStream(streamFactory: KafkaStreams, topic: ETopic, key: string, value: any, stream?: StreamDSL) {
    // //  PATCH used for example to ensure a feed config is immediately available in the local kTable
    // // Used when having 1 stream and 1 table initiated on the same topic..
    // if (stream) {
    //   stream.writeToStream({
    //     key: key,
    //     value: JSON.stringify(value),
    //   });
    // }

    const tmpStream = streamFactory.getKStream(null);
    tmpStream.to(topic);
    return await tmpStream.start().then(_ => {
      tmpStream.writeToStream({
        key: key,
        value: value instanceof Object ? JSON.stringify(value) : value, // TODO Review Serialization format 
      });
      setTimeout(() => tmpStream.close(), 2000); // TODO review that default timeout for closing a producer stream
    })
    .catch(error => {
      throw new Error('Failed to write message to stream \''+topic+'\' with key \''+key+'\'');
    });
  }

  /**
   * 
   * @param errorTopic 
   * @param errorType 
   * @param key 
   * @param input 
   * @param prevError 
   * @param msg 
   * @param kafkaProducer 
   * @param logger 
   */
  static async castError(errorTopic: ETopic, errorType: EErrorType, key: string, input: any, prevError: any, 
    msg?: string, kafkaProducer?: Producer, logger?: Logger) {
    const aLogger = logger !== undefined ? logger : Logger;

    const errorInfo = {
      type: errorType,
      input: input,
      message: msg,
      error: '' + prevError,
    };

    aLogger.error('Processing Error caught\n'+prevError);
    aLogger.warn('Casting Error to \''+errorTopic+'\' with key \''+key+'\'\n'+JSON.stringify(errorInfo));

    let kProducer: Producer;
    let disconnect = false;
    if (kafkaProducer === undefined) {
      disconnect = true;
      const configKafkaClient = KafkaUtils.getConfigKafkaClient(RelaydKClient.ERR + '_generic');
      kProducer = (new Kafka(configKafkaClient)).producer();
    }
    else
      kProducer = kafkaProducer;
    
    await kProducer.connect().then(async () => {
      return await kProducer.send({
        topic: errorTopic,
        messages: [{
          key: key,
          value: JSON.stringify(errorInfo)
        }]
      });
    })
    .catch((error) => {
      aLogger.error('Failed to kConnect for casting Error\n'+JSON.stringify(errorInfo)+'\n'+error);
    })
    //.finally(() => { if (disconnect) kProducer.disconnect()});
  }
}