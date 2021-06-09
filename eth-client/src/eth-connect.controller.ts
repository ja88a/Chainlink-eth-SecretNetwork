import { EthConnectService } from './eth-connect.service';

import { ETopics, FeedConfigSource, EContractCastReason } from '@relayd/common';
import { ProviderNetwork } from '@relayd/common';
import { HttpExceptionFilterCust, HttpExceptionService, RpcExceptionFilterCust } from '@relayd/common';

import { Controller, UseFilters } from '@nestjs/common/decorators/core';
import { Get, Param } from '@nestjs/common/decorators/http';
import { Logger } from '@nestjs/common/services/logger.service';

import { MessagePattern } from '@nestjs/microservices/decorators/message-pattern.decorator';
import { Payload } from '@nestjs/microservices/decorators/payload.decorator';
import { KafkaMessage } from '@nestjs/microservices/external/kafka.interface';
import { KafkaContext } from '@nestjs/microservices/ctx-host/kafka.context';
import { Ctx } from '@nestjs/microservices/decorators/ctx.decorator';
import { validate } from 'class-validator';
import { RpcException } from '@nestjs/microservices/exceptions/rpc-exception';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectController.name);

  constructor(
    private readonly ethConnectService: EthConnectService,
    private readonly httpExceptionService: HttpExceptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.ethConnectService.init();
  }

  async onApplicationShutdown(signal: string): Promise<void> {
    this.logger.warn('Shutting down ETH Connect on signal ' + signal);
    if (this.ethConnectService) this.ethConnectService.shutdown(signal);
  }

  @Get('eth/provider')
  @UseFilters(HttpExceptionFilterCust.for()) // EthConnectController.name
  provideEthConnectionInfo(): Promise<ProviderNetwork> {
    return this.ethConnectService.loadNetworkProviderInfo();
  }

  // http://localhost:3000/eth/event/listen/btcusd
  //  @Get('eth/event/listen/:pair')
  @UseFilters(RpcExceptionFilterCust.for(EthConnectController.name))
  listenEventAnswerUpdated(@Param('pair') pair: string): string {
    const contract = this.ethConnectService.getSourceContracts().get(pair);
    if (!contract) {
      this.logger.warn('Unknown contract key requested "' + pair + '" for listening to events AnswerUpdated');
      return '404';
    }
    this.ethConnectService.listenEventOracleAnswerUpdated(contract);
    return '200';
  }

  @MessagePattern(ETopics.CONTRACT)
  @UseFilters(RpcExceptionFilterCust.for(EthConnectController.name))
  handleFeedConfig(@Payload() message: KafkaMessage, @Ctx() context: KafkaContext): any {
    //const originalMessage: KafkaMessage = context.getMessage();
    // const { headers, offset, timestamp } = originalMessage;
    //this.logger.debug(`Receiving msg on topic '${context.getTopic()}'. Value:\n${JSON.stringify(originalMessage)}`);

    const contractSource: FeedConfigSource = JSON.parse(JSON.stringify(message.value)); // JSON.parse(message.value.toString())
    //const contractSource: FeedConfigSource = JSON.parse(message.value.toString()); // JSON.parse(message.value.toString())
    this.logger.log(`Received Contract: '${message.value}'\n${JSON.stringify(contractSource)}`);

    // 0. Validate the contract input
    // 1. Check right source network
    // 2. Dispatch to the right service for processing
    // 3. Update the topic

    const valid = validate(contractSource)
      .then((errorValid) => {
        this.logger.warn('validation result:\n' + JSON.stringify(errorValid));
        if (errorValid.length > 0) {
          throw new RpcException({
            input: contractSource,
            message: 'Input contract validation failed',
            error: errorValid,
          });
        }
      })
      .catch((error) => {
        throw new RpcException({
          input: contractSource,
          message: 'Validation of input source Contract failed',
          error: error,
        });
        // this.logger.error('VALIDATION ERROR on ' + contractSource + '\n' + error);
      });

    // const valid = validateOrReject(contractSource, VALID_OPT).catch((errors) => {
    //   throw new RpcException({ input: contractSource, message: 'Input object validation failed', error: errors });
    // });

    return valid.then(async () => {
      try {
        const isCompatible = await this.ethConnectService.checkNetworkMatch(contractSource.network);
        if (!isCompatible) {
          const countLasNetworkCompatibilityIssues = this.ethConnectService.countIssueRecentSerie(
            contractSource,
            EContractCastReason.FAILURE_NETWORK_NOT_MATCHING,
          );
          if (countLasNetworkCompatibilityIssues < 4) {
            // TODO Review non-sense number: must consider nb of eth clients available
            this.ethConnectService.castContractConfig(
              message.key.toString(),
              contractSource,
              EContractCastReason.FAILURE_NETWORK_NOT_MATCHING,
            );
          } else {
            this.logger.warn(
              "No network match found for source contract of '" +
                message.key.toString() +
                "'. Contract: " +
                JSON.stringify(contractSource),
            );
          }
        }
        this.logger.warn('Check out that ETH contract: ' + contractSource.contract);
        const contractSourceUpd = await this.ethConnectService.handleSourceContract(contractSource);
        //  return actionRes;
      } catch (error) {
        throw new Error('Failed to process source contract\n' + JSON.stringify(contractSource) + '\nError: ' + error); // this.httpExceptionService.serverError(HttpStatus.INTERNAL_SERVER_ERROR, contractSource, error);
      }
    });
  }
}
