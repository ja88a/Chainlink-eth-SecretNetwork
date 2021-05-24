export type HandleAnswer =
  | {
      set_latest_round_data: {
        status: ResponseStatus;
      };
    }
  | {
      set_oracle_status: {
        status: ResponseStatus;
      };
    };
export type ResponseStatus = 'success' | 'failure';
