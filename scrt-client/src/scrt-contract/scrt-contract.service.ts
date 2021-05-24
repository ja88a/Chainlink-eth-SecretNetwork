import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
//import { ClientRequest } from 'http';
import { CosmWasmClient } from 'secretjs/types/cosmwasmclient';
import { QueryAnswer } from './cw-scrt-oracle-price/QueryAnswer';
import { QueryMsg } from './cw-scrt-oracle-price/QueryMsg';


export const MSG = {
  QUERY: {
    CONFIG: "config",
    DATA: "data",
  }
};

export type TMsgArgs = [{ key: string, value: any }];

@Injectable()
export class ScrtContractService {
  private readonly logger = new Logger(ScrtContractService.name);

  constructor(private configService: ConfigService) { }

  createQueryMsg(type: string, args: TMsgArgs): QueryMsg {
    let msg: QueryMsg = null;
    switch (type) {
      case MSG.QUERY.CONFIG:
        msg = {
          get_oracle_config: {}
        }
        break;
      case MSG.QUERY.DATA:
        msg = {
          get_latest_round_data: {}
        }
        break;
      default:
        break;
    }
    return msg;
  }

  queryContract(
    client: CosmWasmClient,
    contractAddr: string,
    queryType: string,
    args: TMsgArgs,
  ): Promise<QueryAnswer> {
    const queryMsg = this.createQueryMsg(queryType, args)

    return client.queryContractSmart(contractAddr, queryMsg);
  }

}