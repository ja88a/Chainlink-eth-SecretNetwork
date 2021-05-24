export type QueryAnswer =
  | {
      latest_round_data: {
        data: LatestRoundData;
        status: ResponseStatus;
      };
    }
  | {
      oracle_status: {
        data: OracleStatus;
        status: ResponseStatus;
      };
    }
  | {
      oracle_config: {
        data: OracleConfig;
        status: ResponseStatus;
      };
    };

//export type Uint128 = string;
export type ResponseStatus = 'success' | 'failure';
export type OracleStatus = 'Testing' | 'Running' | 'Stopped';
export type OracleType = 'PriceFeed' | 'Other';

/**
 * Binary is a wrapper around Vec<u8> to add base64 de/serialization with serde. It also adds some helper methods to help encode inline.
 *
 * This is only needed as serde-json-{core,wasm} has a horrible encoding for Vec<u8>
 */
export type Binary = string;

/**
 * Latest round data for an Oracle of type Aggregator
 */
export interface LatestRoundData {
  current: number;
  updated_at: number;
}
/**
 * Oracle config
 */
export interface OracleConfig {
  data_source: string;
  data_source_id: string;
  oracle_description: string;
  oracle_name: string;
  oracle_price_pair?: CurrencyPair | null;
  oracle_status: OracleStatus;
  oracle_type: OracleType;
  oracle_value_decimals: number;
  owner: Binary;
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
