use cosmwasm_std::{
    to_binary, Api, Env, Extern,
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
    let oracle_state = OracleConfig::init(msg, owner);
    
    //let store_config_result = 
    match oracle_state {
        //Ok(data) => config_save(&mut deps.storage).save(&data)?,
        Ok(state) => save(&mut deps.storage, STORE_KEY_CONFIG, &state)?,
        Err(error) => return Err(StdError::generic_err(format!("Failed to init Oracle Contract {}", error.to_string()))),
    };

    return Ok(InitResponse { // ::default()),
        messages: vec![],
        log: vec![]
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
        QueryMsg::GetOracleContractInfo {} => get_oracle_config(deps),
        QueryMsg::GetLatestRoundData {} => get_latest_round_data(deps),
    };
    pad_query_result(response, BLOCK_SIZE)
}

fn get_oracle_config<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>
) -> QueryResult {
    let state_config: OracleConfig = config_read(&deps.storage).load()?;
    //Ok(CountResponse { count: state.count })
/*
    return Ok(QueryResponse {
        log: vec![],
    }); */
    
    return to_binary(&QueryAnswer::GetOracleConfig {
        config: state_config,
        status: ResponseStatus::Success,
    });
}

fn get_latest_round_data<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>
) -> QueryResult {
    //let stateData = config_read(&deps.storage).load()?;
    //Ok(OracleConfig { count: state.count })
    let state_data: LatestRoundData = load(&deps.storage, STORE_KEY_DATA)?;
    return to_binary(&QueryAnswer::GetLatestRoundData {
        status: ResponseStatus::Success,
//        quote: TokenInfo::default(),
        latest_round_data: state_data,
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
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{coins, from_binary}; //, StdError

    #[test]
    fn proper_initialization() {
        let mut deps = mock_dependencies(20, &[]);

        let msg_init = InitMsg {
            oracle_name: "Price of BTC in USD".to_string(),
            oracle_description: None,
            oracle_status: None,
            oracle_type: None,
            data_source: "Chainlink OffChainAggregator btc-usd.data.eth on Ethereum Mainnet".to_string(),
            data_source_id: Some("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419".to_string()),
            oracle_value_decimals: 8,
            oracle_price_pair: None,
        };
        let env = mock_env("creator", &coins(1000, "coins"));

        // we can just call .unwrap() to assert this was a success
        let res_init = init(&mut deps, env, msg_init).unwrap();
        assert_eq!(0, res_init.messages.len());

        // it worked, let's query the state
        let res_query_config = query(&deps, QueryMsg::GetOracleContractInfo {}).unwrap();
        let oracle_config: OracleConfig = from_binary(&res_query_config).unwrap();
        assert_eq!(8, oracle_config.oracle_value_decimals);
    }
/*
    #[test]
    fn increment() {
        let mut deps = mock_dependencies(20, &coins(2, "token"));

        let msg = InitMsg { count: 17 };
        let env = mock_env("creator", &coins(2, "token"));
        let _res = init(&mut deps, env, msg).unwrap();

        // anyone can increment
        let env = mock_env("anyone", &coins(2, "token"));
        let msg = HandleMsg::Increment {};
        let _res = handle(&mut deps, env, msg).unwrap();

        // should increase counter by 1
        let res = query(&deps, QueryMsg::GetCount {}).unwrap();
        let value: CountResponse = from_binary(&res).unwrap();
        assert_eq!(18, value.count);
    }

    #[test]
    fn reset() {
        let mut deps = mock_dependencies(20, &coins(2, "token"));

        let msg = InitMsg { count: 17 };
        let env = mock_env("creator", &coins(2, "token"));
        let _res = init(&mut deps, env, msg).unwrap();

        // not anyone can reset
        let unauth_env = mock_env("anyone", &coins(2, "token"));
        let msg = HandleMsg::Reset { count: 5 };
        let res = handle(&mut deps, unauth_env, msg);
        match res {
            Err(StdError::Unauthorized { .. }) => {}
            _ => panic!("Must return unauthorized error"),
        }

        // only the original creator can reset the counter
        let auth_env = mock_env("creator", &coins(2, "token"));
        let msg = HandleMsg::Reset { count: 5 };
        let _res = handle(&mut deps, auth_env, msg).unwrap();

        // should now be 5
        let res = query(&deps, QueryMsg::GetCount {}).unwrap();
        let value: CountResponse = from_binary(&res).unwrap();
        assert_eq!(5, value.count);
    }
*/
}
