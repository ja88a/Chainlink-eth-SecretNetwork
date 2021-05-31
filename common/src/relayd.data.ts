import { HttpStatus } from '@nestjs/common/enums/http-status.enum';
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
  MinLength,
  isPositive,
} from 'class-validator';

// TODO Remove Temporary struct
export type TMessageType0 = { id: string, name: string };

class RelayActionResult {
  status: HttpStatus;
  @Length(0, 30)
  message?: string;
  data?: any;
  error?: Error[];
}
export class DataFeedEnableResult extends RelayActionResult {

}


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
   * @example price
   */
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


// /** Feed update mode */
// export enum EDataFeedUpdMode {
//   /** Listen to update events */
//   LISTEN = 'listen',
//   /** Regular polling for value changes */
//   PULL = 'pull',
//   default = LISTEN,
// };
// export enum EFeedSourcePoll {
//   EVENT = 'event',
//   TIMEPERIOD = 'period',
//   default = EVENT
// };

/** Supported modes to watch for source contract updates */
export enum EFeedSourcePoll {
  /** Monitor / Listen to update events */
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
  /** Data path to the field value */
  // TODO source data's path-based extraction support
  @IsOptional()
  @Length(1, 50)
  path?: string;

  /** Number of Decimals for the data values */
  @IsOptional()
  @Min(0)
  @Max(30)
  decimals?: Number = 18;

  /** Last seen source data value */
  @IsOptional()
  value?: unknown;

  /** Last time the source data value was reported as changed */
  @IsOptional()
  time?: Number;

  // TODO Review if timeChecked & timeChanged on source data shall be considered
}

/** 
 * Source of a Data feed 
 */
export class FeedConfigSource {
  /** Source status, in terms of access to its functions and data */
  @IsOptional()
  @IsEnum(HttpStatus)
  status?: HttpStatus = HttpStatus.PARTIAL_CONTENT;

  /** Hosting network of the data Source (contract) */
  @IsOptional()
  @IsEnum(EFeedSourceNetwork)
  network?: EFeedSourceNetwork = EFeedSourceNetwork.default;

  /** Address of the source contract */
  @IsDefined()
  //@ValidateIf(o => o.network === EFeedSourceNetwork.ETH_MAIN || o.network === EFeedSourceNetwork.ETH_TEST)
  @IsEthereumAddress()
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
  period?: Number = 120;

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
//  @IsOptional()
  @ValidateIf(o => o.status == HttpStatus.OK)
  @ValidateNested()
  data?: FeedConfigSourceData;
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
  decimals?: Number = 18;

  /** Last set data value */
  @IsOptional()
  value?: unknown;

  /** Last time the target data value was updated */
  @IsOptional()
  @IsPositive()
  time?: Number;
};

/**
 * Target [contract] of relayed Data Feeds, its configuration
 */
export class FeedConfigTarget {
  /** Target status, in terms of access to its functions and data */
  @IsOptional()
  @IsEnum(HttpStatus)
  status?: HttpStatus = HttpStatus.NOT_FOUND;
  
  /** Target contract address */
  @IsOptional()
  @Length(46, 46)
  @Contains('secret')
  contract?: string;

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
  @ValidateIf(o => o.status === HttpStatus.OK)
  @ValidateNested()
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
  @Length(3, 12)
  id: string;

  /** Feed config version number, optional */
  @IsOptional() 
  version?: Number = 1; 

  /** Data Feed name
   * @example 'Chainlink price for BTC/USD' 
   */
  @IsDefined()
  @Length(8, 40)
  name: string;

  // @IsOptional()
  // @IsEnum(EDataFeedUpdMode)
  // updateMode?: EDataFeedUpdMode;

  /** Free text description of the Data Feed
   * @example 'Chainlink reference aggregated price for Bitcoin against USD' 
   */
  @IsOptional()
  @MaxLength(255)
  description?: string;

  /** Identification of the data feed initiator / creator */
  @IsDefined()
  @Length(46, 46)
  @Contains('secret')
  creator: string;

  /** Identification of the data feed owner */
  // TODO If feed owner undefined, use creator's oracle group by default
  // TODO Support for Group as feed owner
  @IsOptional()
  @Length(46, 46)
  @Contains('secret')
  owner?: string;

  /** Data feed data configuration */
  @IsDefined()
  @ValidateNested()
  data: FeedConfigData;

  /** Configuration of the data feed Source */
  @IsDefined()
  @ValidateNested()
  source: FeedConfigSource;

  /** Configuration of the data feed Target */
  @IsOptional()
  @ValidateNested()
  target?: FeedConfigTarget;
};


export class ContractUpdate {
  /** The feed the contract's update relates to */
  @IsDefined()
  feed: string;

  /** Version number of the contract update */
  @IsDefined()
  version: Number;

  /** ID of the issuer emiting the contract update */
  @IsDefined()
  issuer: string;

  /** Address of the source contract emiting a data value update */
  @ValidateIf(o => o.target === undefined)
  @IsEthereumAddress()
  source?: string;

  /** Address of the target contract emiting a data value update */
  @ValidateIf(o => o.source === undefined)
  @Length(46, 46)
  @Contains('secret')
  target?: string;

  /** Last extracted data value(s) */
  @IsDefined()
  value: unknown;

  /** Time since epoch (s) when the source value was detected as updated on source or updated on target */
  @IsDefined()
  @IsPositive()
  time: Number;
}
