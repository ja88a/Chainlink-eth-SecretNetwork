import { HttpStatus } from "@nestjs/common";
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

export enum EDataFeedUpdMode {
  LISTEN = 'listen',
  PULL = 'pull',
  default = LISTEN,
};

export enum EFeedDataType {
  PRICE = 'price',
  default = PRICE,
};

export class FeedConfigData {
  @IsEnum(EFeedDataType)
  type: EFeedDataType;

  @IsOptional()
  @ValidateIf(o => o.type === EFeedDataType.PRICE)
  @Length(3, 6)
  quote?: string;

  @IsOptional()
  @ValidateIf(o => o.type === EFeedDataType.PRICE)
  @Length(3, 6)
  base?: string;
};

export enum EFeedSourceNetwork {
  ETH_MAIN = 'eth-mainnet',
  ETH_TEST_RINKEBY = 'eth-testnet-rinkeby',
//  ETH_TEST_ROPSTEN = 'eth-ropsten',
  ETH_TEST_KOVAN = 'eth-testnet-kovan',
  BSC_MAIN = 'bsc-mainnet',
  default = ETH_MAIN
};

export enum EFeedSourceType {
  CL_AGGR_PROX = 'cl-aggregator-proxy',
  CL_AGGR = 'cl-aggregator',
  default = CL_AGGR_PROX
};

export enum EFeedSourceEvent {
  ANSWER_UPDATED = 'AnswerUpdated(int256,uint256,uint256)',
  CUSTOM = 'custom',
  default = ANSWER_UPDATED
};

export enum EFeedSourcePoll {
  EVENT = 'event',
  PERIOD = 'period',
  default = EVENT
};

export enum EFeedSourceNotifOn {
  CHANGE = 'change',
  CHECK = 'check',
  default = CHANGE
};

export enum EFeedSourceFunction {
  LATEST_ROUND_DATA = 'latestRoundData',
  //  LAST_UPDATED = 'lastUpdated',
}

export class FeedConfigSourceData {
  /** Data path to the field value */
  @IsOptional()
  @Length(1, 50)
  path?: string;

  /** Number of Decimals for the data values */
  @IsOptional()
  @Min(0)
  @Max(30)
  decimals?: Number = 18;

  /** Last data value set */
  @IsOptional()
  value?: unknown;

  /** Last time the source data value was reported as changed */
  @IsOptional()
  time?: Number;
}

export class FeedConfigSource {
  /** Source status, in terms of access to its functions and data */
  @IsOptional()
  @IsEnum(HttpStatus)
  status?: HttpStatus;

  /** Hosting network of the data Source (contract) */
  @IsOptional()
  @IsEnum(EFeedSourceNetwork)
  network?: EFeedSourceNetwork;

  /** Address of the source contract */
  @IsDefined()
  //@ValidateIf(o => o.network === EFeedSourceNetwork.ETH_MAIN || o.network === EFeedSourceNetwork.ETH_TEST)
  @IsEthereumAddress()
  contract: string;

  /** Type of the source contract */
  @IsOptional()
  @IsEnum(EFeedSourceType)
  type?: EFeedSourceType;

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

  /** Poll time period (seconds), if source is monitored via regular polling */
  @IsOptional()
  @ValidateIf(o => o.poll === EFeedSourcePoll.PERIOD)
  @Min(20)
  @Max(48 * 60 * 60)
  period?: Number = 120;

  /** Optional specification of the source contract method to use when querying */
  @IsOptional()
  @ValidateIf(o => o.poll === EFeedSourcePoll.PERIOD)
  @IsEnum(EFeedSourceFunction)
  function?: EFeedSourceFunction;

  /** Notification mode of the source contract value: every time it is checked or only when its value has changed (default) */
  @IsOptional()
  @IsEnum(EFeedSourceNotifOn)
  notif?: EFeedSourceNotifOn = EFeedSourceNotifOn.default;

  /** The source contract data info and values */
  @IsDefined()
  @ValidateNested()
  data: FeedConfigSourceData;
};


export enum EFeedTargetNetwork {
  SCRT_MAIN = 'scrt-mainnet',
  SCRT_TEST = 'scrt-holodeck-2',
  default = SCRT_TEST // TODO PROD Review default target network
};

export enum EFeedTargetType {
  CL_RELAY = 'cl-relay',
  CL_PRICE_AGGR_RELAY = 'price cl-aggregator-relay',
  CUSTOM = 'custom',
  default = CL_PRICE_AGGR_RELAY
};

export class FeedConfigTargetData {
  /** Number of Decimals for the data values */
  @IsOptional()
  @Min(0)
  @Max(30)
  decimals?: Number = 18;

  /** Last data value set */
  @IsOptional()
  value?: unknown;

  /** Last time the target data value was updated */
  @IsOptional()
  time?: Number;
};

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

  @IsOptional()
  @IsEnum(EFeedTargetNetwork) 
  type?: EFeedTargetType = EFeedTargetType.default;

  @ValidateIf(o => o.type === EFeedTargetType.CUSTOM)
  @Length(8, 30) 
  typeCustom? : string;

  /** The source contract data info and values */
  @IsOptional()
  @ValidateNested()
  data?: FeedConfigTargetData;
};

export class FeedConfig {
  @IsDefined()
  @Length(3, 12)
  id: string;

  @IsOptional() 
  version?: Number = 1; 

  @IsDefined()
  @Length(4, 30)
  name: string;

  @IsOptional()
  @IsEnum(EDataFeedUpdMode)
  updateMode?: EDataFeedUpdMode;

  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsDefined()
  @Length(46, 46)
  @Contains('secret')
  creator: string;

  @IsDefined()
  @Length(46, 46)
  @Contains('secret')
  owner: string;

  @IsDefined()
  @ValidateNested()
  data: FeedConfigData;

  @IsDefined()
  @ValidateNested()
  source: FeedConfigSource;
};


export class ContractUpdate {
  /** The feed the contract's update relates to */
  @IsDefined()
  feed: string;

  @IsDefined()
  version: Number;

  @IsDefined()
  author: string;

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

  /** Epoch time when the source value was detected as updated on source or updated on target */
  @IsDefined()
  @IsPositive()
  time: Number;
}
