/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */
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