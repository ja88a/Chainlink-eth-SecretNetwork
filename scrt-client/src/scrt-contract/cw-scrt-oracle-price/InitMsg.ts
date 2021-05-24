//export type Uint128 = string;
export type OracleStatus = 'Testing' | 'Running' | 'Stopped';
export type OracleType = 'PriceFeed' | 'Other';

export interface InitMsg {
  data_source: string;
  data_source_id?: string | null;
  oracle_description?: string | null;
  oracle_name: string;
  oracle_price_pair?: CurrencyPair | null;
  oracle_status?: OracleStatus | null;
  oracle_type?: OracleType | null;
  oracle_value_decimals: number;
}
export interface CurrencyPair {
  base: TokenInfo;
  quote: TokenInfo;
}
/**
 * TokenInfo response
 */
export interface TokenInfo {
  decimals: number;
  name: string;
  symbol: string;
  total_supply?: number | null;
}
