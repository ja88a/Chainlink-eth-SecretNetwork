import {
  Length,
  IsDefined,
  IsEthereumAddress,
  Contains,
  ValidateIf,
  IsPositive,
  IsDateString,
  IsOptional,
  IsNumber,
  Max,
  } from 'class-validator';

export class OracleData {
  @IsDefined()
  value: any;

  @IsDateString()
  time: string; // ISO date & time OR epoch number?

  @IsOptional()
  @IsNumber()
  round?: number = 0;

  @IsOptional()
  @IsPositive()
  @Max(30)
  decimals?: number;
};

export class OraclePriceData extends OracleData {
  @IsNumber()
  value: number = 0;

  @IsPositive()
  @Max(30)
  decimals: number;
};

export class ProviderNetwork {
  name: string;
  chainId: number;
  type?: string;
};

export enum EContractCastReason {
  SUCCESS_HANDLING = 'success.contract.handling',
  FAILURE_NETWORK_NOT_MATCHING = 'failure.network.incompatible',
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
