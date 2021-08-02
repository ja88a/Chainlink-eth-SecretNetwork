import { IsOptional, IsBoolean, IsEnum, IsString, IsUrl, Length, Max, Min, ValidateIf, validateSync } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { ValidatorOptions } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { EEthersNetwork } from './ethers.config';
//import { Injectable } from '@nestjs/common';
import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';

/**
 * Data Object IO validation
 */
// TODO PROD Review settings
export const VALID_OPT: ValidatorOptions = {
  skipMissingProperties: false,
  forbidUnknownValues: true, // PROD: true
  whitelist: true,
  forbidNonWhitelisted: true,
  //groups: string[],
  dismissDefaultMessages: true,
  validationError: {
    target: true,
    value: true,
  },
  stopAtFirstError: true
};

/**
 * Possible config values for the External communication mode of service's runtime errors
 */
export enum EExternalCommunicationMode {
  DEBUG = 'debug',
  STANDARD = 'standard',
  DENY = 'deny',
  // TODO PROD Review ext com mode to be Set to STD or DENY
  default = STANDARD
};

export enum EConfigRunMode {
  PROD = 'prod',
  DEV_LOCAL = 'dev.local',
  DEV_CLUSTER = 'dev.cluster',
  default = PROD,
}

export enum ESourceValidMode {
  MINIMAL = 'min',
  OPTIMAL = 'optimal',
  FULL = 'full',
  default = OPTIMAL,
}

class RelaydConfigDefaultCore {
  @IsOptional()
  //@Length(3, 30)
  @IsEnum(EEthersNetwork)
  ETH_PROVIDER_NETWORK_ID?: EEthersNetwork = EEthersNetwork.ETH_MAIN;

  @IsOptional()
  @Length(3, 30)
  ETH_PROVIDER_TYPE?: string = 'default';

  @IsOptional()
  @ValidateIf(o => o.ETH_PROVIDER_TYPE === 'local')
  @IsUrl()
  ETH_PROVIDER_LOCAL_URL?: string;

  @IsOptional()
  @Length(32, 64)
  ETH_ETHERSCAN_API_KEY?: string;

  @IsOptional()
  @ValidateIf(o => o.ETH_PROVIDER_TYPE === 'default')
  @Length(32, 64)
  ETH_INFURA_PROJECT_ID: string;

  @IsOptional()
  @ValidateIf(o => o.ETH_PROVIDER_TYPE === 'default')
  @Length(32, 64)
  ETH_INFURA_PROJECT_SECRET: string;

  @IsOptional()
  @Length(32, 64)
  ETH_ALCHEMY_API_KEY: string;

  @IsOptional()
  @Length(20, 64)
  ETH_POCKET_APP_KEY: string;

  @Length(3, 30)
  SECRET_CHAIN_ID: string;
  @Length(30, 200)
  SECRET_REST_URL: string;
  @Length(30, 200)
  SECRET_RPC_URL: string;
  @Length(40, 60)
  SECRET_ACCOUNT_ADDRESS: string;
  @Length(100, 255)
  SECRET_ACCOUNT_MNEMONIC: string;

  @IsOptional()
  @IsEnum(EExternalCommunicationMode)
  APP_EXTERNAL_COM_MODE?: EExternalCommunicationMode = EExternalCommunicationMode.default;

  @IsOptional()
  @IsEnum(EConfigRunMode)
  APP_RUN_MODE?: EConfigRunMode = EConfigRunMode.default;
}

class RelaydConfigDefaultProd extends RelaydConfigDefaultCore {
  /**
   * Maximum number of recast of a source contract config
   * to other clients, when the expected network support is not supported.
   */
  // TODO Review that non-sense static number: must consider nb of eth clients available or have topic contract filters / stream
  @IsOptional()
  @Min(0)
  @Max(10)
  MAX_RECAST_NETWORK_SOURCE_NOT_MATCHING?: number = 4;

  /** Max number of days since last update of contract's data in order 
   * to be considered as valid, i.e. not stall and so rejected */
  @IsOptional()
  @Min(1)
  @Max(188)
  SOURCE_DATA_LAST_UPDATE_MAX_DAYS?: number = 30;

  @IsOptional()
  @IsEnum(ESourceValidMode)
  SOURCE_CONTRACT_VALIDATION_MODE?: ESourceValidMode = ESourceValidMode.default;

  /**
   * Maximum number of recast of a source contract config
   * to other clients, when the expected network support is not supported.
   */
  @IsOptional()
  @Min(0)
  @Max(5)
  MAX_RECAST_SOURCE_HANDLING_FAIL?: number = 2;

  /** 
   * Number of successive errors met while polling a contract data
   * before interrupting that polling mechanism
   */
  @IsOptional()
  @Min(0)
  @Max(5)
  MAX_SUCCESSIVE_ERROR_TO_STOP_POLLING?: number = 3;

  /** Maximum number of contract issues to be kept, i.e. length of its updates' history  */
  @IsOptional()
  @Min(0)
  @Max(20)
  SOURCE_ISSUE_MAX_NUMBER?: number = 10;

  /** Maximum number of entries about a source contract handling, e.g. polling info */
  @IsOptional()
  @Min(1)
  @Max(20)
  SOURCE_MAX_HANDLE?: number = 10;

  /** 
   * Allow or not a relayd node to handle multiple polling of the same data source. 
   * 
   * Caution: The periodic or event-based polling of each data source is expected to be spread across the particpating nodes
   * so that the retrieved data are confirmed by different actors. So in production that allowance is forbidden */
  // TODO PROD Forbid same node to handle multiple polling of the same contract (set to 'false')
  @IsOptional()
  @IsBoolean()
  SOURCE_POLLING_ALLOW_MULTIPLE_BY_SAME_HANDLER?: boolean = false;

  /** Allow or not a relayd node to handle different types of polling, e.g. event & periodic, on the same data source */
  @IsOptional()
  @IsBoolean()
  SOURCE_POLLING_ALLOW_MULTIPLE_TYPE_BY_SAME_HANDLER?: boolean = false;

  /** Expected number of event-based polling / listeners on each source contract */
  @IsOptional()
  @Min(2)
  @Max(10)
  SOURCE_NB_EVENT_LISTENER?: number = 3

  @IsOptional()
  @Min(2)
  @Max(10)
  SOURCE_NB_PERIODIC_QUERIER?: number = 3;
}

class RelaydConfigDefaultDev extends RelaydConfigDefaultProd {
  @IsOptional()
  @IsBoolean()
  SOURCE_POLLING_ALLOW_MULTIPLE_BY_SAME_NODE?: boolean = true;

  @IsOptional()
  @IsBoolean()
  SOURCE_POLLING_ALLOW_MULTIPLE_TYPE_BY_SAME_HANDLER?: boolean = true;

  SOURCE_NB_EVENT_LISTENER?: number = 3;

  SOURCE_NB_PERIODIC_QUERIER?: number = 3;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(
    RelaydConfigDefaultProd,
    config,
    { enableImplicitConversion: true },
  );
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error('Invalid Environment configuration\n' + errors.toString());
  }
  return validatedConfig;
}

@Injectable()
export class RelaydConfigService {

  private default: RelaydConfigDefaultProd | RelaydConfigDefaultDev;

  constructor(private configService: ConfigService) {
    const configMode = this.configService.get<string>('APP_RUN_MODE', EConfigRunMode.default);
    switch (configMode) {
      case EConfigRunMode.DEV_LOCAL:
        this.default = new RelaydConfigDefaultDev();
        break;

      default:
        this.default = new RelaydConfigDefaultProd();
        break;
    }
  }

  // _______________________________________________________
  //
  // General App Settings
  // 

  get appRunMode(): EConfigRunMode {
    return this.configService.get<EConfigRunMode>('APP_RUN_MODE', this.default.APP_RUN_MODE);
  }

  get appExternalCommunicationMode(): EExternalCommunicationMode {
    return this.configService.get<EExternalCommunicationMode>('APP_EXTERNAL_COM_MODE', this.default.APP_EXTERNAL_COM_MODE);
  }

  // _______________________________________________________
  //
  // Ethereum connection
  // 

  get ethProviderNetworkId(): string {
    return this.configService.get<string>('ETH_PROVIDER_NETWORK_ID', this.default.ETH_PROVIDER_NETWORK_ID);
  }

  get ethProviderType(): string {
    return this.configService.get<string>('ETH_PROVIDER_TYPE', this.default.ETH_PROVIDER_TYPE);
  }

  get ethProviderLocalUrl(): string {
    return this.configService.get<string>('ETH_PROVIDER_LOCAL_URL', this.default.ETH_PROVIDER_LOCAL_URL);
  }

  get ethEtherscanApiKey(): string {
    return this.configService.get<string>('ETH_ETHERSCAN_API_KEY', this.default.ETH_ETHERSCAN_API_KEY);
  }

  get ethInfuraProjectId(): string {
    return this.configService.get<string>('ETH_INFURA_PROJECT_ID', this.default.ETH_INFURA_PROJECT_ID);
  }

  get ethInfuraProjectSecret(): string {
    return this.configService.get<string>('ETH_INFURA_PROJECT_SECRET', this.default.ETH_INFURA_PROJECT_SECRET);
  }

  get ethAlchemyProjectKey(): string {
    return this.configService.get<string>('ETH_ALCHEMY_API_KEY', this.default.ETH_ALCHEMY_API_KEY);
  }

  get ethPocketAppKey(): string {
    return this.configService.get<string>('ETH_POCKET_APP_KEY', this.default.ETH_POCKET_APP_KEY);
  }

  // _______________________________________________________
  //
  // Source Contract Validation
  // 

  get sourceContractValidationMode(): string {
    return this.configService.get<string>('SOURCE_CONTRACT_VALIDATION_MODE', this.default.SOURCE_CONTRACT_VALIDATION_MODE);
  }

  get sourceDataLastUpdateMaxDays(): number {
    return this.configService.get<number>('SOURCE_DATA_LAST_UPDATE_MAX_DAYS', this.default.SOURCE_DATA_LAST_UPDATE_MAX_DAYS);
  }

  // _______________________________________________________
  //
  // Source Retries on Contracts
  // 

  get maxRecastNetworkSourceNotMatching(): number {
    return this.configService.get<number>('MAX_RECAST_NETWORK_SOURCE_NOT_MATCHING', this.default.MAX_RECAST_NETWORK_SOURCE_NOT_MATCHING);
  }

  get maxRecastSourceHandlingFail(): number {
    return this.configService.get<number>('MAX_RECAST_SOURCE_HANDLING_FAIL', this.default.MAX_RECAST_SOURCE_HANDLING_FAIL);
  }

  get maxSuccessiveErrorToStopPolling(): number {
    return this.configService.get<number>('MAX_SUCCESSIVE_ERROR_TO_STOP_POLLING', this.default.MAX_SUCCESSIVE_ERROR_TO_STOP_POLLING);
  }

  // _______________________________________________________
  //
  // Source Limits & Allowances
  // 

  get sourceIssueMaxNumber(): number {
    return this.configService.get<number>('SOURCE_ISSUE_MAX_NUMBER', this.default.SOURCE_ISSUE_MAX_NUMBER);
  }

  get sourcePollingAllowMultipleBySameIssuer(): boolean {
    return this.configService.get<boolean>('SOURCE_POLLING_ALLOW_MULTIPLE_BY_SAME_HANDLER', this.default.SOURCE_POLLING_ALLOW_MULTIPLE_BY_SAME_HANDLER);
  }
  
  get sourcePollingAllowMultipleTypeBySameIssuer(): boolean {
    return this.configService.get<boolean>('SOURCE_POLLING_ALLOW_MULTIPLE_TYPE_BY_SAME_HANDLER', this.default.SOURCE_POLLING_ALLOW_MULTIPLE_TYPE_BY_SAME_HANDLER);
  }

  get sourceMaxHandle(): number {
    return this.configService.get<number>('SOURCE_MAX_HANDLE', this.default.SOURCE_MAX_HANDLE);
  }

  get sourceNbEventListener(): number {
    return this.configService.get<number>('SOURCE_NB_EVENT_LISTENER', this.default.SOURCE_NB_EVENT_LISTENER);
  }
  
  get sourceNbPeriodicQuerier(): number {
    return this.configService.get<number>('SOURCE_NB_PERIODIC_QUERIER', this.default.SOURCE_NB_PERIODIC_QUERIER);
  }

  
  // _______________________________________________________
  //
  // Secret Network connection
  // 

  get secretChainId(): string {
    return this.configService.get<string>('SECRET_CHAIN_ID', this.default.SECRET_CHAIN_ID);
  }

  get secretRestUrl(): string {
    return this.configService.get<string>('SECRET_REST_URL', this.default.SECRET_REST_URL);
  }

  get secretRpcUrl(): string {
    return this.configService.get<string>('SECRET_RPC_URL', this.default.SECRET_RPC_URL);
  }

  get secretAccountAddress(): string {
    return this.configService.get<string>('SECRET_ACCOUNT_ADDRESS', this.default.SECRET_ACCOUNT_ADDRESS);
  }

  get secretAccountMnemonic(): string {
    return this.configService.get<string>('SECRET_ACCOUNT_MNEMONIC', this.default.SECRET_ACCOUNT_MNEMONIC);
  }
}
