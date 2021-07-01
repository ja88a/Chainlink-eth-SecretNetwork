import { EthConnectService } from './eth-connect.service';

import { ETopic, EErrorType, FeedConfigSource, EContractCastReason, EContractStatus, RelaydConfigService } from '@relayd/common';
import { ProviderNetwork } from '@relayd/common';
import { HttpExceptionFilterCust, HttpExceptionService, RpcExceptionFilterCust } from '@relayd/common';

import { Controller, UseFilters } from '@nestjs/common/decorators/core';
import { Get } from '@nestjs/common/decorators/http';
import { Logger } from '@nestjs/common/services/logger.service';

import { MessagePattern } from '@nestjs/microservices/decorators/message-pattern.decorator';
import { Payload } from '@nestjs/microservices/decorators/payload.decorator';
import { KafkaMessage, RecordMetadata } from '@nestjs/microservices/external/kafka.interface';
import { validate } from 'class-validator';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectController.name);

  constructor(
    private readonly ethConnectService: EthConnectService,
    private readonly httpExceptionService: HttpExceptionService,
    private readonly relaydConfig: RelaydConfigService,
  ) { }

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
  // @UseFilters(RpcExceptionFilterCust.for(EthConnectController.name))
  // listenEventAnswerUpdated(@Param('pair') pair: string): string {
  //   const contract = this.ethConnectService.getSourceContracts().get(pair);
  //   if (!contract) {
  //     this.logger.warn('Unknown contract key requested "' + pair + '" for listening to events AnswerUpdated');
  //     return '404';
  //   }
  //   this.ethConnectService.listenEventOracleAnswerUpdated(contract);
  //   return '200';
  // }

  @MessagePattern(ETopic.SOURCE_CONFIG)
  @UseFilters(RpcExceptionFilterCust.for(EthConnectController.name))
  handleContractConfig(@Payload() message: KafkaMessage/*, @Ctx() context: KafkaContext*/): void {
    //const originalMessage: KafkaMessage = context.getMessage();
    // const { headers, offset, timestamp } = originalMessage;
    //this.logger.debug(`Receiving msg on topic '${context.getTopic()}'. Value:\n${JSON.stringify(originalMessage)}`);

    const feedId = message.key.toString();

    const contractSource: FeedConfigSource = JSON.parse(JSON.stringify(message.value)); // JSON.parse(message.value.toString())
    this.logger.debug(`Received Contract: '${contractSource.contract}'\n${JSON.stringify(contractSource)}`);

    // 0. Validate the contract input
    // 1. Check right source network
    // 2. Contract config handling
    // 3. Update the topic(s) with processing results

    if (contractSource == undefined || contractSource.status == EContractStatus.FAIL) {
      this.logger.warn('Skipping Contract \'' + contractSource?.contract + '\' for feed \'' + feedId + '\' with status \'' + contractSource?.status + '\'');
      return;
    }

    // const valid = validateOrReject(contractSource, VALID_OPT).catch((errors) => {
    //   throw new RpcException({ input: contractSource, message: 'Input object validation failed', error: errors });
    // });
    const validInput = validate(contractSource) // TODO Fix the validation issue on contract config, VALID_OPT
      .then((errorValid) => {
        this.logger.debug('Contract validation result:' + JSON.stringify(errorValid));
        if (errorValid.length > 0)
          throw new Error('Input source contract validation failed with ' + errorValid.length + ' errors\n' + JSON.stringify(errorValid));
        return true;
      })
      .catch((error) => {
        contractSource.status = EContractStatus.FAIL;
        this.ethConnectService.castContractConfig(ETopic.SOURCE_CONFIG, feedId, contractSource,
          EContractCastReason.HANDLING_VALIDATION_FAIL, ''+error)
          .then(() => {
            this.castErrorConfigSource(EErrorType.CONTRACT_CONFIG_INVALID, contractSource, feedId, new Error('Validation of input source Contract has failed'));
          });
        return false;
      });

    validInput.then(async (isValid) => {
      if (!isValid)
        return;

      // Source contract's network compatibility
      const isCompatible = await this.ethConnectService.checkNetworkMatch(contractSource.network);
      if (!isCompatible) {
        const countLastNetworkCompatibilityIssues = 1 + this.ethConnectService.countIssueInLastRow(
          contractSource, EContractCastReason.FAILURE_NETWORK_NOT_MATCHING);
        const msg = EContractCastReason.FAILURE_NETWORK_NOT_MATCHING + " No network support found for Source Contract of '"
          + feedId + "'. Attempt '" + countLastNetworkCompatibilityIssues + '/' + this.relaydConfig.maxRecastNetworkSourceNotMatching;
        this.logger.warn(msg);

        const keepTrying = countLastNetworkCompatibilityIssues < this.relaydConfig.maxRecastNetworkSourceNotMatching;
        if (!keepTrying)
          contractSource.status = EContractStatus.FAIL;

        const castResult = this.ethConnectService.castContractConfig(ETopic.SOURCE_CONFIG, feedId, contractSource,
          EContractCastReason.FAILURE_NETWORK_NOT_MATCHING, msg)
          .then((result) => {
            if (result instanceof Error)
              throw result;
            return contractSource;
          })
          .catch((error) => {
            return new Error('Failed to cast contract \'' + contractSource.contract + '\' update ('+EContractCastReason.FAILURE_NETWORK_NOT_MATCHING+' fail)\n' + error);
          })
          .finally(() => {
            if (!keepTrying)
              this.castErrorConfigSource(EErrorType.CONTRACT_CONFIG_NETWORK_NOSUPPORT, contractSource, feedId, new Error('No network support found for contract \'' + contractSource.contract + '\' of feed \'' + feedId + '\'\n' + msg));
          });

        if (typeof castResult == Error.name)
          throw castResult;
        return;
      }

      // Handle the contract config
      const contractSourceUpd = await this.ethConnectService
        .handleSourceContract(contractSource)
        .then((configUpd) => {
          if (configUpd instanceof Error)
            throw configUpd;
          if (configUpd === undefined) {
            this.logger.debug('No source contract handling required for \''+contractSource.contract+'\'');
            return undefined;
          }
          const castResult = this.ethConnectService.castContractConfig(ETopic.SOURCE_CONFIG, feedId, configUpd,
            EContractCastReason.HANDLING_SUCCESS, 'Status: '+configUpd.status)
            .then((result: RecordMetadata[] | Error) => {
              if (result instanceof Error)
                throw result;
              return configUpd;
            })
            .catch((error) => {
              return new Error('Failed to cast contract \'' + configUpd.contract + '\' config updated (success)\n' + error);
            });

          if (castResult instanceof Error)
            throw castResult;

          return castResult;
        })
        .catch((error) => {
          const countLastSerieOfHandlingErrors = 1 + this.ethConnectService.countIssueInLastRow(contractSource, EContractCastReason.HANDLING_FAILED);
          const msg = EContractCastReason.HANDLING_FAILED + ': Failed to handle Source Contract \'' + contractSource.contract + '\' for \'' + feedId +
            '\'. Attempt ' + (countLastSerieOfHandlingErrors) + '/' + this.relaydConfig.maxRecastContractHandlingFail + ' \n' + error;
          this.logger.warn(msg);

          const keepTrying = countLastSerieOfHandlingErrors < this.relaydConfig.maxRecastContractHandlingFail;
          if (!keepTrying)
            contractSource.status = EContractStatus.FAIL;

          return this.ethConnectService.castContractConfig(ETopic.SOURCE_CONFIG, feedId, contractSource,
            EContractCastReason.HANDLING_FAILED, msg)
            .then((castResult: RecordMetadata[] | Error) => {
              if (castResult instanceof Error)
                throw castResult;
              return contractSource;
            })
            .catch((error) => {
              return new Error('Failed to cast contract \'' + contractSource.contract + '\'  config update ('+EContractCastReason.HANDLING_FAILED+' fail)\n' + error);
            }).finally(() => {
              if (!keepTrying)
                this.castErrorConfigSource(EErrorType.CONTRACT_CONFIG_HANDLING_FAIL, contractSource, feedId, new Error(msg));
            });
        });
      
      if (contractSourceUpd instanceof Error)
        throw contractSourceUpd;
      
      if (contractSourceUpd !== undefined)
        this.logger.log('ETH Source contract \'' + contractSource.contract + '\' for \'' + feedId + '\' updated & cast \n' + JSON.stringify(contractSourceUpd || contractSource));
        
    }).catch((error) => {
      this.castErrorConfigSource(EErrorType.CONTRACT_CONFIG_GENERAL_FAIL, contractSource, feedId, error);
    });
  }

  private castErrorConfigSource(errorType: EErrorType, contractSource: FeedConfigSource, feedId: string, prevError: any) {
    const errorInfo = {
      type: errorType,
      input: contractSource,
      message: 'Failure in ETH source contract \'' + contractSource.contract + '\' config handling for \'' + feedId + '\'',
      error: '' + prevError,
    };
    this.logger.error('ETH Source contract processing Error\n' + JSON.stringify(errorInfo));
    this.ethConnectService.castContractConfig(ETopic.ERROR_CONFIG, feedId, contractSource, 
      EContractCastReason.HANDLING_FAILED, JSON.stringify(errorInfo))
      .then((castResult) => {
        if (castResult instanceof Error)
          throw new Error('Failed to cast contract config to error queue\n' + castResult);
      })
      .catch((error) => {
        this.logger.error('Failed to cast error \'' + errorType + '\'/\'' + EContractCastReason.HANDLING_FAILED + '\' on contract \'' + contractSource.contract + '\' for feed \'' + feedId + '\'\nInitial Error: ' + JSON.stringify(prevError) + '\n\n' + error);
      });
  }
}
