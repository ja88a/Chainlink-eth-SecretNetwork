export type QueryMsg =
  | {
      get_latest_round_data: Record<string, never>;
    }
  | {
      get_oracle_config: Record<string, never>;
    };
