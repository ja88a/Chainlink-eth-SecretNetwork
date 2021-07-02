import { Type } from 'class-transformer';
import {
  Length,
  IsEnum,
  IsDefined,
  IsEthereumAddress,
  IsOptional,
  Max,
  MaxLength,
  Contains,
  ValidateIf,
  ValidateNested,
  Min,
  IsPositive,
  ArrayMaxSize,
  IsDate,
  IsDateString,
  IsNumber,
} from 'class-validator';
import { 
  ESourceCastReason, 
  ESourceStatus 
} from './source.data';

/** Main Type of Data Feed */
export enum EFeedDataType {
  /** Price data feed */
  PRICE = 'price',
  default = PRICE,
};

/**
 * Config parameters of the feed's handled data, its values
 */
export class FeedConfigData {
  /** 
   * Feed's data type 
   * @example 'price'
   */
  @IsDefined()
  @IsEnum(EFeedDataType)
  type: EFeedDataType;

  /** 
   * For price feeds, specification of the price pair's quote currency
   * @example 'usd' for the pair 'BTC/USD'
   */
  @IsOptional()
  @ValidateIf(o => o.type === EFeedDataType.PRICE)
  @Length(3, 6)
  quote?: string;

  /** 
   * For price feeds, specification of the price pair's base currency
   * @example 'btc' for the pair 'BTC/USD'
   */
  @IsOptional()
  @ValidateIf(o => o.type === EFeedDataType.PRICE)
  @Length(3, 6)
  base?: string;
};

/** Possible networks of data feeds' Source contract */
export enum EFeedSourceNetwork {
  ETH_MAIN = 'eth-mainnet',
  ETH_TEST_RINKEBY = 'eth-testnet-rinkeby',
//  ETH_TEST_ROPSTEN = 'eth-ropsten',
  ETH_TEST_KOVAN = 'eth-testnet-kovan',
//  BSC_MAIN = 'bsc-mainnet',
  default = ETH_MAIN
};

/** Supported types of source contract to extract data from */
export enum EFeedSourceType {
  /** Chainlink EA Aggregator Proxy contract */
  CL_AGGR_PROX = 'cl-aggregator-proxy',
  /** Chainlink EA Aggregator contract */
  CL_AGGR = 'cl-aggregator',
  default = CL_AGGR_PROX
};

/** Event signature for data source updates */
export enum EFeedSourceEvent {
  /** Chainlink Aggregator contracts AnswerUpdated event signature */
  ANSWER_UPDATED = 'AnswerUpdated(int256,uint256,uint256)',
  /** Custom contract event signature (to be specified) */
  CUSTOM = 'custom',
  default = ANSWER_UPDATED
};

/** Supported modes to watch for source contract updates */
export enum EFeedSourcePoll {
  /** Monitor / Listen to emitted update events */
  EVENT = 'event',
  /** Time-based regular polling to check for data changes */
  TIMEPERIOD = 'period',
  default = EVENT
};

/** Notification mode of source contract's data updates */
export enum EFeedSourceNotifOn {
  /** Emit an event only where the source contract data has changed */
  CHANGE = 'change',
  /** Emit an event every time the source contract value was checked/polled */
  CHECK = 'check',
  default = CHANGE
};

/** Supported the source contract's function to use when pulling its data */
export enum EFeedSourceFunction {
  LATEST_ROUND_DATA = 'latestRoundData',
  LAST_UPDATED = 'lastUpdated',
  default = LATEST_ROUND_DATA
}

/**
 * Specification of the Source data
 */
export class FeedConfigSourceData {
  /** Data path to the field value - Not Supported */
  // TODO source data's path-based extraction support
  @IsOptional()
  @Length(1, 50)
  path?: string;

  /** Number of Decimals for the data values */
  @IsOptional()
  @Min(0)
  @Max(30)
  decimals?: number = 18;

  /** Last seen source data value */
  @IsOptional()
//  @IsNumber()
  value?: any; //number;

  /** Last time the source data value was reported as changed */
  // TODO Review if moving to more optimal epoch time (number)
  @IsOptional()
  // @IsPositive()
  // time?: number;
  @IsDateString()
  time?: string;

  // TODO Review if timeChecked & timeChanged on source data shall be considered
}

/**
 * @deprecated use FeedConfigSourceData instead 
 */
 export class OraclePriceData extends FeedConfigSourceData {
  @IsNumber()
  value: number = 0;

  @IsPositive()
  @Max(30)
  decimals: number;

  @IsDateString()
  time: string; // ISO date & time OR epoch number?

  @IsOptional()
  @IsNumber() 
  round?: number;  
};

export class ProcessingIssue {
  @IsDefined()
  @Length(3, 40)
  issuer: string;

  @IsDefined()
  @IsEnum(ESourceCastReason)
  type: ESourceCastReason;

  @IsOptional()
  @MaxLength(255)
  info?: string;
} 

export class FeedConfigSourceHandle {
  @IsDefined()
  @Length(6, 40) 
  handler: string;

  @IsDefined()
  @IsEnum(EFeedSourcePoll) 
  type: EFeedSourcePoll;

  @IsDefined()
  @IsDateString()
  time: string;
} 

/** 
 * Source of a Data feed 
 */
export class FeedConfigSource {
  /** Source status, in terms of access to its functions and data */
  @IsOptional()
  @IsEnum(ESourceStatus)
  status?: ESourceStatus = ESourceStatus.INI;

  /** Reporting of issues while processing the contract */
  @IsOptional()
  @ArrayMaxSize(20) //RelaydConfig.contractIssueMaxNumber
  @ValidateNested()
  @Type(() => ProcessingIssue)
  issue?: ProcessingIssue[];

  /** Hosting network of the data Source (contract) */
  @IsOptional()
  @IsEnum(EFeedSourceNetwork)
  network?: EFeedSourceNetwork = EFeedSourceNetwork.default;

  /** Address of the source contract */
  @IsDefined()
  //@ValidateIf(o => o.network === EFeedSourceNetwork.ETH_MAIN || o.network === EFeedSourceNetwork.ETH_TEST)
  @IsEthereumAddress()
  @Length(41,43)
  contract: string;

  /** Type of the source contract */
  @IsOptional()
  @IsEnum(EFeedSourceType)
  type?: EFeedSourceType = EFeedSourceType.default;

  /** Polling mode to check for data changes: via listening to events or regularly querying the source contract */
  @IsOptional()
  @IsEnum(EFeedSourcePoll)
  poll?: EFeedSourcePoll = EFeedSourcePoll.default;

  /** Event type to listen to, if source is monitored via events */
  @IsOptional()
  @ValidateIf(o => o.poll === EFeedSourcePoll.EVENT)
  @IsEnum(EFeedSourceEvent)
  @Length(3, 40)
  event?: EFeedSourceEvent = EFeedSourceEvent.default;

  /** Custom event signature to listen to */
  @IsOptional()
  @ValidateIf(o => o.event === EFeedSourceEvent.CUSTOM)
  @IsDefined()
  @Length(10, 50)
  eventSignature?: string;

  /** Polling time period (seconds), if source is monitored via regular polling */
  @IsOptional()
  @ValidateIf(o => o.poll === EFeedSourcePoll.TIMEPERIOD)
  @Min(20)
  @Max(48 * 60 * 60)
  period?: number = 120;

  /** Optional specification of the source contract method to use when querying/pulling the contract data */
  @IsOptional()
  @ValidateIf(o => o.poll === EFeedSourcePoll.TIMEPERIOD)
  @IsEnum(EFeedSourceFunction)
  function?: EFeedSourceFunction = EFeedSourceFunction.default;

  /** Notification mode of the source contract value: every time it is checked or only when its value has changed (default) */
  @IsOptional()
  @IsEnum(EFeedSourceNotifOn)
  notif?: EFeedSourceNotifOn = EFeedSourceNotifOn.default;

  /** The source contract's data info */
  @IsOptional()
  //@ValidateIf(o => o.status == EContractStatus.OK)
  @ValidateNested()
  @Type(() => FeedConfigSourceData)
  data?: FeedConfigSourceData;

  @IsOptional()
  //@ValidateIf(o => o.status == EContractStatus.OK)
  @ArrayMaxSize(20) // RelaydConfig.contractSourceMaxHandle
  @ValidateNested()
  @Type(() => FeedConfigSourceHandle)
  handle?: FeedConfigSourceHandle[];
};

/** Supported target contracts' network */
export enum EFeedTargetNetwork {
  SCRT_MAIN = 'scrt-mainnet',
  SCRT_TEST = 'scrt-holodeck-2',
  default = SCRT_TEST // TODO PROD Review default target network
};

/** Types of target feed contract */
export enum EFeedTargetType {
  /** Chainlink data feed that is relayed */
  CL_RELAY = 'cl-relay',
  /** Chainlink price feed based on their EA Aggregator solution */
  CL_PRICE_AGGR_RELAY = 'price cl-aggregator-relay',
  /** Custom data feed contract (to be specified) */
  CUSTOM = 'custom',
  default = CL_PRICE_AGGR_RELAY
};

/**
 * Data of a relayed data feed Target
 */
export class FeedConfigTargetData {
  /** Number of Decimals for the data values */
  // TODO Convert value(s) if source & target decimals differ
  @IsOptional()
  @Min(0)
  @Max(30)
  decimals?: number = 18;

  /** Last set data value */
  @IsOptional()
  value?: unknown;

  /** Last time the target data value was updated */
  @IsOptional()
  @IsPositive()
  time?: number;
};

/**
 * Target [contract] of relayed Data Feeds, its configuration
 */
export class FeedConfigTarget {
  /** Target status, in terms of access to its functions and data */
  @IsOptional()
  @IsEnum(ESourceStatus)
  status?: ESourceStatus = ESourceStatus.INI;
  
  /** Target contract address */
  @IsOptional()
  @Length(46, 46)
  @Contains('secret')
  contract?: string;

  /** Identification of the target contract owner
   * 
   * It actually also defines the data feed owner, considering the 2 bound to each other 
   * @example 'secret1p4ltddczms6hm3e7z3r8cufuwjqq3nq40GROUP' 
   */
  // TODO If feed owner undefined, use feed creator's default oracle group
  // TODO Support for a Group to be feed & contract owner, its members are granted handlers
  @IsOptional()
  @ValidateIf(o => o.status === ESourceStatus.OK)
  @Length(44, 46)
  @Contains('secret')
  owner?: string;

  /** Network hosting the feed's target contract */
  @IsOptional()
  @IsEnum(EFeedTargetNetwork) 
  network?: EFeedTargetNetwork = EFeedTargetNetwork.default;

  /** Type of data feed to be reported in the target contract */
  @IsOptional()
  @IsEnum(EFeedTargetType) 
  type?: EFeedTargetType = EFeedTargetType.default;

  /** Custom type of data feed */
  @ValidateIf(o => o.type === EFeedTargetType.CUSTOM)
  @Length(8, 40)
  typeCustom? : string;

  /** The target contract data info and values */
//  @IsOptional()
  @ValidateIf(o => o.status === ESourceStatus.OK)
  @ValidateNested()
  @Type(() => FeedConfigTargetData)
  data?: FeedConfigTargetData;
};

/**
 * Data Feed configuration
 */
export class FeedConfig {
  /** Unique data feed ID
   * @example 'cl-price-btcusd' 
   */
  @IsDefined()
  @Length(4, 40)
  id: string;

  /** Feed config version number, optional */
  @IsOptional() 
  version?: number = 1; 

  /** Data Feed name
   * @example 'Chainlink price for BTC/USD' 
   */
  @IsDefined()
  @Length(8, 80)
  name: string;

  /** Free text description of the Data Feed
   * @example 'Chainlink reference aggregated price for Bitcoin against USD' */
  @IsOptional()
  @MaxLength(256)
  description?: string;

  /** Identification of the data feed initiator / creator */
  @IsDefined()
  @Length(44, 46)
  @Contains('secret')
  creator: string;

  /** Feed 1st creation date & time */
  @IsOptional()
  @IsDate()
  dateCreated: string;

  /** Feed config last update date & time */
  @IsOptional()
  @IsDate()
  dateUpdated: string;

  /** Data feed data configuration */
  @IsDefined()
  @ValidateNested()
  @Type(() => FeedConfigData)
  data: FeedConfigData;

  /** Configuration of the data feed Source */
  @IsDefined()
  @ValidateNested()
  @Type(() => FeedConfigSource)
  source: FeedConfigSource;

  /** Configuration of the data feed Target */
  @IsOptional()
  @ValidateNested()
  @Type(() => FeedConfigTarget)
  target?: FeedConfigTarget;
};


/** 
 * Technical wrapping of FeedConfigSource to propagate polling & data updates on a source contract
 * at the config level 
 */
 export class FeedSourceConfigWrap {
  @IsDefined() 
  feedId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeedConfigSource)
  source?: FeedConfigSource;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeedConfigTarget)
  target?: FeedConfigTarget;
} 
