export type HandleMsg =
  | {
      set_latest_round_data: {
        data: LatestRoundData;
      };
    }
  | {
      set_oracle_status: {
        status: OracleStatus;
      };
    };
//export type Uint128 = string;
export type OracleStatus = 'Testing' | 'Running' | 'Stopped';

/**
 * Latest round data for an Oracle of type Aggregator
 */
export interface LatestRoundData {
  current: number;
  updated_at: number;
}
