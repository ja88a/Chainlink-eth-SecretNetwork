import { EthConnectService } from './eth-connect.service';

import { 
  ETopic, 
  EErrorType, 
  FeedConfigSource, 
  ESourceCastReason, 
  ESourceStatus, 
  RelaydConfigService, 
  EConfigRunMode
} from '@relayd/common';
import { ProviderNetwork } from '@relayd/common';
import { HttpExceptionFilterCust, RpcExceptionFilterCust } from '@relayd/common';

import { Controller, UseFilters } from '@nestjs/common/decorators/core';
import { Get } from '@nestjs/common/decorators/http';
import { Logger } from '@nestjs/common/services/logger.service';

import { MessagePattern } from '@nestjs/microservices/decorators/message-pattern.decorator';
import { Payload } from '@nestjs/microservices/decorators/payload.decorator';
import { KafkaMessage } from '@nestjs/microservices/external/kafka.interface';
import { validate } from 'class-validator';

@Controller()
export class EthConnectController {
  private readonly logger = new Logger(EthConnectController.name);

  constructor(
    private readonly ethConnectService: EthConnectService,
//    private readonly httpExceptionService: HttpExceptionService,
    private readonly config: RelaydConfigService,
  ) { }

  async onModuleInit(): Promise<void> {
    this.ethConnectService.init()
      .catch(async (error) => {
        this.logger.error('ETH Connection service failed to init. Stopping it \n'+error);
        await this.onApplicationShutdown('INIT_FAIL');
      });
  }

  async onApplicationShutdown(signal: string): Promise<void> {
    this.logger.warn('Shutting down ETH Connect on signal ' + signal);
    await this.ethConnectService?.shutdown(signal)
      .catch(error => this.logger.error('Failed to properly shut down \n'+error));
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
  async handleSourceConfig(@Payload() message: KafkaMessage/*, @Ctx() context: KafkaContext*/): Promise<void> {
    //const originalMessage: KafkaMessage = context.getMessage();
    // const { headers, offset, timestamp } = originalMessage;
    //this.logger.debug(`Receiving msg on topic '${context.getTopic()}'. Value:\n${JSON.stringify(originalMessage)}`);

    const feedId = message.key.toString();

    const sourceConfig: FeedConfigSource = JSON.parse(JSON.stringify(message.value)); // JSON.parse(message.value.toString())
    this.logger.debug(`Received Source: '${sourceConfig.contract}'\n${JSON.stringify(sourceConfig)}`);

    // 0. Validate the contract input
    // 1. Check right source network
    // 2. Contract config handling
    // 3. Update the topic(s) with processing results

    if (sourceConfig === undefined || sourceConfig.status == ESourceStatus.FAIL) {
      this.logger.warn('Skipping Source \'' + sourceConfig?.contract + '\' for feed \'' + feedId + '\' with status \'' + sourceConfig?.status + '\'');
      return;
    }

    const validInput = await validate(sourceConfig) // TODO Fix the validation issue on contract config, VALID_OPT
      .then((errorValid) => {
        this.logger.debug('Source validation result:' + JSON.stringify(errorValid));
        if (errorValid.length > 0)
          return new Error('Input source validation failed with ' + errorValid.length + ' errors\n' + JSON.stringify(errorValid));
        return sourceConfig;
      })
      .catch((error) => {
        return new Error('Failed to validate Source \''+sourceConfig.contract+'\' for \''+feedId+'\' \n' +error);
      });

    if (validInput instanceof Error) {
      sourceConfig.status = ESourceStatus.FAIL;

      await this.ethConnectService.castSourceConfig(ETopic.SOURCE_CONFIG, feedId, sourceConfig,
        ESourceCastReason.HANDLING_VALIDATION_FAIL, ''+validInput)
        .then(async () => {
          await this.ethConnectService.castErrorSourceConfig(EErrorType.SOURCE_CONFIG_INVALID, sourceConfig, feedId, new Error('Validation of input source Contract has failed \n'+validInput));
        });

      return;
    }

    // Source contract's network compatibility
    const isCompatible = await this.ethConnectService.checkNetworkMatch(sourceConfig.network);
    if (!isCompatible) {
      const countLastNetworkCompatibilityIssues = 1 + this.ethConnectService.countIssueInLastRow(
        sourceConfig, ESourceCastReason.FAILURE_NETWORK_NOT_MATCHING);
      const msg = ESourceCastReason.FAILURE_NETWORK_NOT_MATCHING + " No network support found for Source Contract of '"
        + feedId + "'. Attempt '" + countLastNetworkCompatibilityIssues + '/' + this.config.maxRecastNetworkSourceNotMatching;
      this.logger.warn(msg);

      const keepTrying = countLastNetworkCompatibilityIssues < this.config.maxRecastNetworkSourceNotMatching;
      if (!keepTrying)
        sourceConfig.status = ESourceStatus.FAIL;

      const castResult = await this.ethConnectService.castSourceConfig(ETopic.SOURCE_CONFIG, feedId, sourceConfig,
        ESourceCastReason.FAILURE_NETWORK_NOT_MATCHING, msg)
        .catch((error) => {
          return new Error('Failed to cast source \'' + sourceConfig.contract + '\' update ('+ESourceCastReason.FAILURE_NETWORK_NOT_MATCHING+' fail)\n' + error);
        })
        .finally(() => {
          if (!keepTrying)
            this.ethConnectService.castErrorSourceConfig(EErrorType.SOURCE_CONFIG_NETWORK_NOSUPPORT, sourceConfig, feedId, new Error('No network support found for contract \'' + sourceConfig.contract + '\' of feed \'' + feedId + '\'\n' + msg));
        });

      if (castResult instanceof Error) {
        throw new Error('Failed to cast Source network support issue \n'+castResult);
        //this.ethConnectService.castErrorSourceConfig(EErrorType.SOURCE_CONFIG_GENERAL_FAIL, sourceConfig, feedId, castResult);
      }

      return;
    }

    // Handle the contract config
    const contractSourceUpd = await this.ethConnectService
      .handleSourceContract(sourceConfig, feedId)
      .then(async (configUpd) => {
        if (configUpd === undefined) {
          this.logger.debug('No further source handling required for \''+sourceConfig.contract+'\'');
          return undefined;
        }

        return await this.ethConnectService.castSourceConfig(ETopic.SOURCE_CONFIG, feedId, configUpd,
          ESourceCastReason.HANDLING_SUCCESS, 'Status: '+configUpd.status)
          .then(() => {
            return configUpd;
          });
      })
      .catch(async (error) => {
        const countLastSerieOfHandlingErrors = 1 + this.ethConnectService.countIssueInLastRow(sourceConfig, ESourceCastReason.HANDLING_FAILED);
        const msg = ESourceCastReason.HANDLING_FAILED + ': Failed to handle Source \'' + sourceConfig.contract + '\' for \'' + feedId +
          '\'. Attempt ' + (countLastSerieOfHandlingErrors) + '/' + this.config.maxRecastSourceHandlingFail + ' \n' + error;
        
        this.logger.warn(msg);

        const keepTrying = countLastSerieOfHandlingErrors < this.config.maxRecastSourceHandlingFail;
        if (!keepTrying)
          sourceConfig.status = ESourceStatus.FAIL;

        return await this.ethConnectService.castSourceConfig(ETopic.SOURCE_CONFIG, feedId, sourceConfig,
          ESourceCastReason.HANDLING_FAILED, msg)
          .then(() => {
            return sourceConfig;
          })
          .catch((error) => {
            return new Error('Failed to cast source \'' + sourceConfig.contract + '\' config update (failure \''+ESourceCastReason.HANDLING_FAILED+'\') \n' + error);
          }).finally(async() => {
            if (!keepTrying)
              await this.ethConnectService.castErrorSourceConfig(EErrorType.SOURCE_CONFIG_HANDLING_FAIL, sourceConfig, feedId, new Error(msg));
          });
      });
      
    if (contractSourceUpd instanceof Error) {
      this.logger.error('Failed to handle source config \''+sourceConfig.contract+'\' for feed \''+feedId+'\' Casting the general source config error \n'+contractSourceUpd);
      await this.ethConnectService.castErrorSourceConfig(EErrorType.SOURCE_CONFIG_GENERAL_FAIL, sourceConfig, feedId, contractSourceUpd);
      return;
    }

    if (contractSourceUpd === undefined)
      this.logger.debug('Source \'' + sourceConfig.contract + '\' for \'' + feedId + '\' processed');
    else {
      this.logger.log('Source \'' + sourceConfig.contract + '\' for \'' + feedId + '\' updated & cast');
      if (this.config.appRunMode !== EConfigRunMode.PROD)
        this.logger.debug(JSON.stringify(contractSourceUpd || sourceConfig));
    }
  }

}
