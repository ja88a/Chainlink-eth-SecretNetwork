use cosmwasm_std::{
    to_binary, Api, Env, Extern,
    log,
//    StdResult,  Binary,
    Storage, Querier, StdError,
    InitResult, InitResponse,
    HandleResult, HandleResponse,
    QueryResult, // QueryResponse
};

use crate::msg::{InitMsg, QueryMsg, QueryAnswer, HandleMsg, HandleAnswer, ResponseStatus};
use crate::store::{config, config_read, load, save, STORE_KEY_CONFIG, STORE_KEY_DATA};
use crate::data::{OracleConfig, LatestRoundData, OracleStatus};

use secret_toolkit::utils::{pad_handle_result, pad_query_result};


// ===============================================================================
// ===============================================================================
// ==
// == INIT Requests
// ==
//

/// pad handle responses and log attributes to blocks of 256 bytes to prevent leaking info based on response size
pub const BLOCK_SIZE: usize = 256;

/// Contract Init main method / entry point
pub fn init<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    msg: InitMsg,
) -> InitResult {

    let owner = deps.api.canonical_address(&env.message.sender)?;
    let oracle_config = OracleConfig::init(msg, owner);
    
    //let store_config_result = 
    match oracle_config {
    /*
        Ok(state) => {
            println!("Init - storing oracle config:\n{:#?}", &state);
            config(&mut deps.storage).save(&state)?;
        },*/
        Ok(state) => {
            //println!("Init - storing oracle config:\n{:#?}", &state);
            save(&mut deps.storage, STORE_KEY_CONFIG, &state)?;
        },
        Err(error) => return Err(StdError::generic_err(
            format!("Failed to init Oracle Contract {:?}", error)
        )), // TODO Remove Error details
    };

    let config_stored: OracleConfig = load(&mut deps.storage, STORE_KEY_CONFIG).unwrap();
    let log_config = log("config", format!("{:?}", config_stored));
    let logs = vec![log_config];

    return Ok(InitResponse { // ::default()),
        messages: vec![],
//        log: vec![],
        log: logs,
    });
}

// ===============================================================================
// ==
// == HANDLE Requests
// ==
//

/// Contract Handle main method / entry point
pub fn handle<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    msg: HandleMsg,
) -> HandleResult {
    let response = match msg {
        HandleMsg::SetLatestRoundData { data, .. } => set_latest_round_data(deps, env, data),
        HandleMsg::SetOracleStatus { status, .. } => set_oracle_status(deps, env, status),
    };
    return pad_handle_result(response, BLOCK_SIZE);
}

fn set_latest_round_data<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    _env: Env,
    data: LatestRoundData,
) -> HandleResult {
    let sender_address_raw = deps.api.canonical_address(&_env.message.sender)?;
    let config : OracleConfig = load(&deps.storage, STORE_KEY_CONFIG)?;
    if sender_address_raw != config.owner {
        return Err(StdError::Unauthorized { backtrace: None });
    }

    save(&mut deps.storage, STORE_KEY_DATA, &data)?;

    let status = ResponseStatus::Success;

    return Ok(HandleResponse {  // ::default()
        messages: vec![],
        log: vec![],
        data: Some(to_binary(&HandleAnswer::SetLatestRoundData {status})?),
    });
}

fn set_oracle_status<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    oracle_status: OracleStatus,
) -> HandleResult {
    let sender_address_raw = deps.api.canonical_address(&env.message.sender)?;
    config(&mut deps.storage).update(|mut state| {
        if sender_address_raw != state.owner {
            return Err(StdError::Unauthorized { backtrace: None });
        }
        //validateStatusChange(state.oracle_status, status);
        state.oracle_status = oracle_status;
        Ok(state)
    })?;

    return Ok(HandleResponse {  // ::default()
        messages: vec![],
        log: vec![],
        data: Some(to_binary(&HandleAnswer::SetOracleStatus {status: ResponseStatus::Success})?),
    });
}

// ===============================================================================
// ==
// == QUERY Requests
// ==
//

pub fn query<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>,
    msg: QueryMsg,
) -> QueryResult {
    let response: QueryResult = match msg {
        QueryMsg::GetOracleConfig {} => get_oracle_config(deps),
        QueryMsg::GetLatestRoundData {} => get_latest_round_data(deps),
//        QueryMsg::GetOracleStatus {} => get_latest_round_data(deps),
    };
    pad_query_result(response, BLOCK_SIZE)
}

fn get_oracle_config<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>
) -> QueryResult {
    /*
    let state_config: OracleConfig = config_read(&deps.storage).load()?;
*/
    let state_config: OracleConfig = load(&deps.storage, STORE_KEY_CONFIG)?;
    //Ok(CountResponse { count: state.count })
/*
    return Ok(QueryResponse {
        log: vec![],
    });
    return to_binary(&state_config);
*/  
    return to_binary(&QueryAnswer::OracleConfig {
        data: state_config,
        status: ResponseStatus::Success,
    });
}

fn get_latest_round_data<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>
) -> QueryResult {
    //let stateData = config_read(&deps.storage).load()?;
    //Ok(OracleConfig { count: state.count })
    let state_data: LatestRoundData = load(&deps.storage, STORE_KEY_DATA)?;
    return to_binary(&QueryAnswer::LatestRoundData {
//        quote: TokenInfo::default(),
        data: state_data,
        status: ResponseStatus::Success,
    });
}

// ===============================================================================
// ===============================================================================
// ==
// == TESTS
// ==
//

#[cfg(test)]
mod tests {
    use super::*;
//    use std::any::Any;
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{coins, from_binary, Uint128};
    use cosmwasm_std::{StdResult, QueryResponse, StdError};
//    use cosmwasm_std::{Querier, Binary};
    use crate::data::{OracleType};
//    use string_generator::{gen_string};

    fn helper_extract_query_answer_data_config(
        query_result: StdResult<QueryResponse>,
    ) -> OracleConfig {
        //let answer: QueryAnswer = from_binary(&resp.as_ref().unwrap().data.as_ref().unwrap()).unwrap();
        let answer: QueryAnswer = from_binary(&query_result.as_ref().unwrap()).unwrap();
        return match answer {
            QueryAnswer::OracleConfig {data, ..} => data,
            _ => OracleConfig::default(),
        }  
    }

    fn helper_extract_handle_answer_set_lastrounddata(
        handle_result: &StdResult<HandleResponse>,
    ) -> ResponseStatus {
        let handle_answer: HandleAnswer = from_binary(&handle_result.as_ref().unwrap().data.as_ref().unwrap()).unwrap();
        //let handle_answer: HandleAnswer = from_binary(&handle_result.as_ref().unwrap()).unwrap();
        return match handle_answer {
            HandleAnswer::SetLatestRoundData {status, ..} => status,
            _ => ResponseStatus::Failure,
        }  
    }

    fn helper_extract_query_answer_data_lastround(
        query_result: StdResult<QueryResponse>,
    ) -> LatestRoundData {
        //let answer: QueryAnswer = from_binary(&resp.as_ref().unwrap().data.as_ref().unwrap()).unwrap();
        let answer: QueryAnswer = from_binary(&query_result.as_ref().unwrap()).unwrap();
        return match answer {
            QueryAnswer::LatestRoundData {data, ..} => data,
            _ => LatestRoundData::default(),
        }  
    }

    fn helper_init_initmsg() -> InitMsg { 
        return InitMsg {
            oracle_name: "BTC/USD".to_string(),
            oracle_description: None,
            oracle_status: None,
            oracle_type: None,
            data_source: "CL OffChainAggregator on Ethereum Mainnet".to_string(),
            data_source_id: Some("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419".to_string()),
            oracle_value_decimals: 8,
            oracle_price_pair: None,
        }
    } 

    #[test]
    fn init_query_config() {
        let mut deps = mock_dependencies(20, &[]);
        let env = mock_env("creator", &coins(1000, "coins"));
        let msg_init = helper_init_initmsg();

        // calling .unwrap() asserts the init request has been successful
        let res_init: InitResponse = init(&mut deps, env, msg_init).unwrap();
        assert_eq!(0, res_init.messages.len());
        assert_eq!(1, res_init.log.len());
        if res_init.log.len() > 0 {
            println!("Stored oracle config (from IniMsg logs):\n{:#?}", res_init.log[0]);
        }
        //println!("Init reponse msg: {:?}", res_init.messages[0]);

        // Query the state
        let res_query_config_result: QueryResult = query(&deps, QueryMsg::GetOracleConfig {});
        //query(&deps, QueryMsg::GetOracleContractInfo {}).Ok(|res| { println!("") }).Err(|error|{ println!("")});
        let res_query_config_answer = &res_query_config_result.unwrap();

        let oracle_config_tmp: StdResult<QueryAnswer> = from_binary(&res_query_config_answer);
        match &oracle_config_tmp {
            Err(error) => println!("ERROR Failed to access OracleConfigAnswer from query:\n{:#?}", error),
            _ => println!("Accessed OracleConfigAnswer"),
        }
        //let oracle_config_tmp2: StdResult<OracleConfig> = from_binary(&res_query_config).expect("Failed to extract oracle config from state");

        let oracle_config_res: QueryAnswer = from_binary(&res_query_config_answer).unwrap();
        //let oracle_config: OracleConfig = from_binary(&res_query_config).unwrap();
        match oracle_config_res{
            QueryAnswer::OracleConfig {data, status} => {
                println!("{:#?}", data);
                assert_eq!(8, data.oracle_value_decimals);        
                assert_eq!(ResponseStatus::Success, status);
            },
            _ => {
                StdError::generic_err("Non-matching QueryAnswer returned");
                ()
            }
        }

        let oracle_config = helper_extract_query_answer_data_config(query(&deps, QueryMsg::GetOracleConfig {}));
        assert_eq!(8, oracle_config.oracle_value_decimals);
        assert_eq!(OracleType::PriceFeed, oracle_config.oracle_type);
    }

    #[test]
    fn handle_query_latest_round_data() {
        let mut deps = mock_dependencies(20, &[]);
        
        let msg_init = helper_init_initmsg();
        let env = mock_env("creator", &coins(1000, "coins"));
        let res_init: InitResponse = init(&mut deps, env, msg_init).unwrap();
        if res_init.log.len() > 0 {
            println!("Oracle Init config (from IniMsg logs):\n{:#?}", res_init.log[0]);
        }

        let latest_round_data = LatestRoundData {
            current: Uint128(1000100000000),
            updated_at: Uint128(1618091710),
        };
        let handle_msg = HandleMsg::SetLatestRoundData {
            data: latest_round_data,
        };

        let env = mock_env("creator", &coins(1000, "coins"));
        let handle_res = handle(&mut deps, env, handle_msg);
        let handle_answer_data = helper_extract_handle_answer_set_lastrounddata(&handle_res);
        assert_eq!(ResponseStatus::Success, handle_answer_data);

        // Query the state
        let lastest_round_data = helper_extract_query_answer_data_lastround(query(&deps, QueryMsg::GetLatestRoundData {}));
        println!("Latest round data retrieved:\n{:#?}", &lastest_round_data);
        assert_eq!(Uint128(1000100000000), lastest_round_data.current);
        assert_eq!(Uint128(1618091710), lastest_round_data.updated_at);
        //panic!("show me the logs");

        /*
        let handle_ans = handle_res.unwrap();
        let handle_answ: StdResult<HandleAnswer> = from_binary(&handle_ans);
        let handle_answer: HandleAnswer = handle_answ.unwrap();

        //let oracle_config: OracleConfig = from_binary(&res_query_config).unwrap();
        match handle_answer {
            HandleAnswer::SetLatestRoundData {status} => {
                println!("{:#?}", status);
                assert_eq!(ResponseStatus::Success, status);        
            },
            _ => {
                StdError::generic_err("Non-matching QueryAnswer returned");
                ()
            }
        }
        */
    }

    #[test]
    fn handle_twice_query_latest_round_data() {
        let mut deps = mock_dependencies(20, &[]);
        
        let msg_init = helper_init_initmsg();
        let env = mock_env("creator", &coins(1000, "coins"));
        let _res_init: InitResponse = init(&mut deps, env, msg_init).unwrap();

        let handle_msg = HandleMsg::SetLatestRoundData {
            data: LatestRoundData {
                current: Uint128(1000100000000),
                updated_at: Uint128(1618091710),
            },
        };
        let handle_msg2 = HandleMsg::SetLatestRoundData {
            data: LatestRoundData {
                current: Uint128(2000200000000),
                updated_at: Uint128(1618091720),
            },
        };

        let env = mock_env("creator", &coins(1000, "coins"));
        let handle_res = handle(&mut deps, env, handle_msg);
        let handle_answer_data = helper_extract_handle_answer_set_lastrounddata(&handle_res);
        assert_eq!(ResponseStatus::Success, handle_answer_data);

        // Query the state
        let lastest_round_data = helper_extract_query_answer_data_lastround(query(&deps, QueryMsg::GetLatestRoundData {}));
        println!("Latest round data retrieved:\n{:#?}", &lastest_round_data);
        assert_eq!(Uint128(1000100000000), lastest_round_data.current);
        assert_eq!(Uint128(1618091710), lastest_round_data.updated_at);

        let env = mock_env("creator", &coins(1000, "coins"));
        let handle_res2 = handle(&mut deps, env, handle_msg2);
        let handle_answer_data2 = helper_extract_handle_answer_set_lastrounddata(&handle_res2);
        assert_eq!(ResponseStatus::Success, handle_answer_data2);

        // Query the state
        let lastest_round_data2 = helper_extract_query_answer_data_lastround(query(&deps, QueryMsg::GetLatestRoundData {}));
        println!("Latest round data retrieved:\n{:#?}", &lastest_round_data2);
        assert_eq!(Uint128(2000200000000), lastest_round_data2.current);
        assert_eq!(Uint128(1618091720), lastest_round_data2.updated_at);
        //panic!("show me stdout");
    } 
}
