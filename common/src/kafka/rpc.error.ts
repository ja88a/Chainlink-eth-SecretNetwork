import { Catch } from "@nestjs/common/decorators/core/catch.decorator";
import { ArgumentsHost } from "@nestjs/common/interfaces/features/arguments-host.interface";
import { Logger } from "@nestjs/common/services/logger.service";
import { BaseRpcExceptionFilter } from "@nestjs/microservices/exceptions/base-rpc-exception-filter";
import { throwError } from "rxjs/internal/observable/throwError";

import { CompressionTypes, Kafka } from "kafkajs";
import { ETopic } from "../config/kafka.config";
import { KafkaUtils, RelaydKClient } from "./kafka.utils";

export enum EErrorType {
  SOURCE_CONFIG_NETWORK_NOSUPPORT = 'source.config.handling.network.nosupport',
  SOURCE_CONFIG_INVALID = 'source.config.invalid',
  SOURCE_CONFIG_HANDLING_FAIL = 'source.config.handling.fail',
  SOURCE_CONFIG_MERGE_FAIL = 'source.config.merge.fail',
  SOURCE_CONFIG_GENERAL_FAIL = 'source.config.general.fail',

  SOURCE_POLLING_CAST_FAIL = 'source.polling.cast.fail',
  SOURCE_POLLING_HANDLE_FAIL = 'source.polling.handle.fail',
}

@Catch(Error)
export class RpcExceptionFilterCust extends BaseRpcExceptionFilter {

  private static instances: Map<string, RpcExceptionFilterCust>;

  static for(instanceId?: string): RpcExceptionFilterCust {
    const instId: string = instanceId || '*'
    if (RpcExceptionFilterCust.instances === undefined)
      RpcExceptionFilterCust.instances = new Map();
    let inst = RpcExceptionFilterCust.instances.get(instId);
    if (inst == undefined)
      inst = new RpcExceptionFilterCust(instId);
    RpcExceptionFilterCust.instances.set(instId, inst);
    return inst;
  }

  static shutdown(): void {
    if (RpcExceptionFilterCust.instances)
      RpcExceptionFilterCust.instances.forEach((filter: RpcExceptionFilterCust, key: string) => {
        filter.shutdown();
      });
  }

  private readonly logger = new Logger(RpcExceptionFilterCust.name);

  /** Kafka client for sending errors to a dedicated queue */
  private kafka: Kafka;

  constructor(instanceId?: string) {
    super();
    this.logger.debug('Initializing '+instanceId);
    const configKafkaClient = KafkaUtils.getConfigKafkaClient(RelaydKClient.ERR + '_' + instanceId);
    this.kafka = new Kafka(configKafkaClient);
  }

  async shutdown(): Promise<void> {
    this.logger.debug('Shutting down');
    if (this.kafka) {
      await this.kafka.consumer().disconnect().catch((error) => this.logger.error('Failed to disconnect kafka consumer \n' + error));
      await this.kafka.producer().disconnect().catch((error) => this.logger.error('Failed to disconnect kafka producer \n' + error));
    }
    else 
      this.logger.warn('No kafka initialized');
  }

  catch(exception: any, host: ArgumentsHost): any {
    const ctx = host.switchToRpc();

    const ctxData = ctx.getData();
    const context = ctx.getContext();
    this.logger.debug('Exception\n' + exception + '\n== Context: ' + JSON.stringify(context) + '\n== Data: ' + JSON.stringify(ctxData));

    const errorRecord = {
      context: ctxData,
      error: exception,
    };

    const producer = this.kafka.producer();
    producer.connect().then(() => {
      producer.send({
        topic: ETopic.ERROR_FEED,
        messages: [{
          key: ctxData.key,
          value: JSON.stringify(errorRecord)
        }]
      }).then(() => {
        this.logger.warn('Error caught and cast to \'' + ETopic.ERROR_FEED + '\' with key \'' + ctxData.key + '\'\n' + JSON.stringify(errorRecord));
      }).catch((error) => {
        this.logger.error('Failed to cast error.\n' + JSON.stringify(errorRecord) + '\n' + error);
      });
    }).catch((error) => {
      this.logger.error('Failed to kConnect to cast error\n' + errorRecord + '\n' + error);
    });

    return throwError(exception.message);
  }

}


