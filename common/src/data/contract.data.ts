import { IsOptional, IsString } from 'class-validator';
import { IsEnum } from 'class-validator';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';
import {
  Length,
  IsDefined,
  IsEthereumAddress,
  Contains,
  ValidateIf,
  IsDateString,
  } from 'class-validator';

export class ProviderNetwork {
  name: string;
  chainId: number;
  type?: string;
};

/** Reason for casting a contract update */
export enum EContractCastReason {
  HANDLING_SUCCESS = 'contract.handling.success',
  HANDLING_FAILED = 'contract.handling.fail',
  FAILURE_NETWORK_NOT_MATCHING = 'failure.network.incompatible',
  HANDLING_VALIDATION_PARTIAL = 'contract.handling.valid.partial',
  HANDLING_VALIDATION_FAIL = 'contract.handling.invalid',
};

/** Supported contract statuses */
export enum EContractStatus {
  INI = HttpStatus.CONTINUE,
  OK = HttpStatus.OK,
  PARTIAL = HttpStatus.PARTIAL_CONTENT,
  FAIL = HttpStatus.METHOD_NOT_ALLOWED
};

//  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
export enum EResultFieldLatestRoundData {
  VALUE = 'answer',
  UPDATE_TIME = 'updatedAt',
};

export enum EContractDataUpdateReason {
  DATA_CHANGE = 'polling.data.change',
  PERIODIC = 'polling.periodic.check',
}; 

export enum EContractPollingChange {
  ADD_PERIODIC = 'polling.add.period',
  ADD_LISTEN_EVENT = 'polling.add.event',

  REMOVE_PERIODIC = 'polling.remove.period',
  REMOVE_LISTEN_EVENT = 'polling.remove.event',

  // ERROR_PERIODIC = 'polling.error.period',
  // ERROR_LISTEN_EVENT = 'polling.error.event',
};


export class ContractPollingInfo {
  /** Address of the polled ETH contract */
  @IsDefined()
  @IsEthereumAddress()  
  contract: string;
  
  /** ID of the contract handler, or issue reporter */
  @IsDefined()
  @Length(6, 40) 
  issuer: string;

  @IsDefined()
  @IsEnum(EContractPollingChange) 
  change: EContractPollingChange;

  @IsOptional()
  @Length(3, 255)
  info?: string;
};


export class ContractUpdate {
  /** The feed the contract's update relates to */
  @IsDefined()
  feed: string;
  
  /** Version number of the contract update */
  @IsDefined()
  version: number;
  
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
  @IsDateString()
  time: string;
};
