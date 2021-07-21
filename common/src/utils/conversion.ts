// import { Result } from 'ethers/lib/utils';
// export convertToLastAnswered(result: Result, : T) {
// }
import { isNumber } from 'class-validator';
import { BigNumber, ethers } from 'ethers';
import { ContractEvent } from '../data/source.data';

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

export class ConvertContractUtils {

  static convertValue(value: any, type: ValueType, converter?: ConversionConfig): any {
    const divider = converter?.divider;

    if (type == ValueType.DATE) {
      const timeMs = value* 1000; // Chainlink ETH contract specific: date-time express in Seconds
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

  static convertEventAnswerUpdated(event: ethers.Event, decimals: number): ContractEvent {
    return {
      current: ConvertContractUtils.convertValue(event.args[0]?.toNumber(), ValueType.PRICE, {decimals: decimals}),
      round: event.args[1]?.toNumber(),
      updatedAt: ConvertContractUtils.convertValue(event.args[2]?.toNumber(), ValueType.DATE),
    }
  }
  
  /**
   * Convert string from hex to utf8 and vice-versa
   * 
   * @param str text to be converted
   * @param from submitted string actual format
   * @returns converted text
   */
  static convertString(str: string, from: string) : string {
    const convert = (from, to) => str => Buffer.from(str, from).toString(to);
    const utf8toHex = convert('utf8', 'hex');
    const hexToUtf8 = convert('hex', 'utf8');
    if (from === 'utf8')
      return utf8toHex(str); 
    else 
      return hexToUtf8(str);
  }
}