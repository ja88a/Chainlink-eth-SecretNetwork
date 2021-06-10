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
    if (this.ethConnectService) await this.ethConnectService.shutdown(signal);
    RpcExceptionFilterCust.shutdown();
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

    const feedId = message.key.toString();

    const contractSource: FeedConfigSource = JSON.parse(JSON.stringify(message.value)); // JSON.parse(message.value.toString())
    //const contractSource: FeedConfigSource = JSON.parse(message.value.toString()); // JSON.parse(message.value.toString())
    this.logger.log(`Received Contract: '${message.value}'\n${JSON.stringify(contractSource)}`);

    // 0. Validate the contract input
    // 1. Check right source network
    // 2. Dispatch to the right service for processing
    // 3. Update the topic

    // const valid = validateOrReject(contractSource, VALID_OPT).catch((errors) => {
    //   throw new RpcException({ input: contractSource, message: 'Input object validation failed', error: errors });
    // });
    const validInput = validate(contractSource)
      .then((errorValid) => {
        this.logger.debug('Contract validation result:' + JSON.stringify(errorValid));
        if (errorValid.length > 0) {
          throw new RpcException({
            input: contractSource,
            message: 'Input source contract validation failed for ' + feedId,
            error: errorValid,
          });
        }
      })
      .catch((error) => {
        throw new RpcException({
          input: contractSource,
          message: 'Validation of input source Contract failed for ' + feedId,
          error: error,
        });
        // this.logger.error('VALIDATION ERROR on ' + contractSource + '\n' + error);
      });

    return validInput.then(async () => {
      try {
        // Source contract's network compatibility
        const isCompatible = await this.ethConnectService.checkNetworkMatch(contractSource.network);
        if (!isCompatible) {
          const countLasNetworkCompatibilityIssues = this.ethConnectService.countIssueRecentSerie(
            contractSource,
            EContractCastReason.FAILURE_NETWORK_NOT_MATCHING,
          );
          // TODO Review non-sense number: must consider nb of eth clients available
          if (countLasNetworkCompatibilityIssues < 4) {
            this.ethConnectService.castContractConfig(
              feedId,
              contractSource,
              EContractCastReason.FAILURE_NETWORK_NOT_MATCHING,
            );
          } else {
            this.logger.warn(
              "No network match found for source contract of '" +
                feedId +
                "'. Contract: " +
                JSON.stringify(contractSource),
            );
          }
        }

        // Handle the contract config
        const contractSourceUpd = await this.ethConnectService
          .handleSourceContract(contractSource)
          .then((configUpd) => {
            //this.ethConnectService.castContractConfig(feedId, configUpd, EContractCastReason.SUCCESS_HANDLING);
            return configUpd;
          })
          .catch((error) => {
            throw new Error('Failed to handle Source Contract for ' + feedId + ' \nError: ' + error);
          });
        this.logger.log('ETH Source contract for ' + feedId + ' updated & cast:\n' + JSON.stringify(contractSourceUpd));
      } catch (error) {
        throw new Error(
          'Failed to process source contract for feed ' +
            feedId +
            '\n' +
            JSON.stringify(contractSource) +
            '\nError: ' +
            error,
        );
      }
    });
  }
}
