// import { Result } from 'ethers/lib/utils';
// export convertToLastAnswered(result: Result, : T) {
// }
import { isNumber } from 'class-validator';
import { ethers } from 'ethers';

export enum ValueTypeDate {
  DATE_EPOCH_MS = 'date.epoch.ms',
  DATE_ISO = 'date.iso',
  DATE_UTC = 'date.military',
  DATE_RAW = 'date.raw',
  default = DATE_ISO,
} 

export interface ConversionConfig {
  decimals?: number;
  divider?: number;
  commify?: boolean;
  date?: ValueTypeDate;
}

export enum ValueType {
  PRICE,
  DATE,
  NUMBER
}

export enum EthDecimalsPrice {
  FIAT = 8,
  ETH = 18,
};

export const convertContractInputValue: any = 
  (value: any, type: ValueType, converter?: ConversionConfig) => {
  
  const divider = converter?.divider;

  if (type == ValueType.DATE) {
    const timeMs = value* 1000;
    const dateFormat = converter?.date ? converter.date : ValueTypeDate.default;
    switch(dateFormat) {
      case ValueTypeDate.DATE_EPOCH_MS:
        return timeMs;
      case ValueTypeDate.DATE_ISO:
        return new Date(timeMs).toISOString();
      case ValueTypeDate.DATE_UTC:
        return new Date(timeMs).toUTCString();
      default:
        let resultNumber: number = +value;
        return resultNumber;
    }
  }
  
  if (type == ValueType.PRICE) {
    let result: string = value;
    const decimals = converter?.decimals;
    if (decimals > 0)
      result = ethers.utils.formatUnits(result, decimals);
    if (converter?.commify)
      return ethers.utils.commify(result);
    let resultNumber: number = +result;
    if (divider && divider != 0 && isNumber(result))
      resultNumber = resultNumber / divider;
    return resultNumber;
  }

  if (type == ValueType.NUMBER) {
    let result: string = value;
    if (converter?.commify)
      return ethers.utils.commify(result);
    let resultNumber: number = +result;
    if (divider && divider != 0 && isNumber(result))
      resultNumber = resultNumber / divider;
    return resultNumber;
  }

  return value;
}