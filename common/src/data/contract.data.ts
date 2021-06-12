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

export enum EContractCastReason {
  HANDLING_SUCCESS = 'contract.handling.success',
  HANDLING_FAILED = 'contract.handling.fail',
  FAILURE_NETWORK_NOT_MATCHING = 'failure.network.incompatible',
  HANDLING_VALIDATION_PARTIAL = 'contract.handling.valid.partial',
} 

/** Supported contract statuses */
export enum EContractStatus {
  INI = HttpStatus.CONTINUE,
  OK = HttpStatus.OK,
  PARTIAL = HttpStatus.PARTIAL_CONTENT,
  FAIL = HttpStatus.METHOD_NOT_ALLOWED
}

//  latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
export enum EResultFieldLatestRoundData {
  VALUE = 'answer',
  UPDATE_TIME = 'updatedAt',
}

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
}
