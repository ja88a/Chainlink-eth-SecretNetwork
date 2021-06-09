import { Catch } from "@nestjs/common/decorators/core/catch.decorator";
import { ArgumentsHost } from "@nestjs/common/interfaces/features/arguments-host.interface";
import { Logger } from "@nestjs/common/services/logger.service";
import { BaseRpcExceptionFilter } from "@nestjs/microservices/exceptions/base-rpc-exception-filter";
import { throwError } from "rxjs/internal/observable/throwError";

import { configKafkaClient } from "../config/relayd.config";
import { CompressionTypes, Kafka } from "kafkajs";
import { ETopics } from '../config/relayd.config';

@Catch(Error)
export class RpcExceptionFilterCust extends BaseRpcExceptionFilter {
  
  private readonly logger = new Logger(RpcExceptionFilterCust.name);

  private static instance: Map<string, RpcExceptionFilterCust>;

  static for(instanceId?: string): RpcExceptionFilterCust {
    const instId: string = instanceId || '-'
    if (this.instance === undefined)
      this.instance = new Map();
    let inst = this.instance.get(instId);
    if (inst == undefined)
      inst = new RpcExceptionFilterCust(instId);
      this.instance.set(instId, inst);
    return inst;
  }

  private kafka: Kafka = new Kafka(configKafkaClient); 

  constructor(instanceId?: string) {
    super();
  }

  catch(exception: any, host: ArgumentsHost): any {
    const ctx = host.switchToRpc();

    const ctxData = ctx.getData();
    const context = ctx.getContext();
    this.logger.debug('Exception\n'+JSON.stringify(exception)+'\n== Context: '+JSON.stringify(context)+'\n== Data: '+JSON.stringify(ctxData));
    
    const errorRecord = {
      context: ctxData,
      error: exception,
    }; 
    
    const producer = this.kafka.producer();
    producer.connect().then(() => {
      producer.send({
        topic: ETopics.ERROR,
        compression: CompressionTypes.GZIP,
        messages: [{
          key: ctxData.key,
          value: JSON.stringify(errorRecord)
        }]
      }).then(() => {
        this.logger.warn('Error caught and cast to \''+ETopics.ERROR+'\' with key \''+ctxData.key+'\'\n'+JSON.stringify(errorRecord));
      }).catch((error) => { 
        this.logger.error('Failed to cast error.\n'+JSON.stringify(errorRecord)+'Error: '+error);
      }); 
    }).catch((error) => {
      this.logger.error('Failed to kConnect to cast error\n'+errorRecord+'\nError: '+error);
    });
    
    return throwError(exception.message);
  } 

}