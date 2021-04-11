use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

//use cosmwasm_std::{Binary, CosmosMsg, HumanAddr, Querier, StdResult, Uint128};
//use cosmwasm_std::{Uint128}; // , StdResult, StdError
//use secret_toolkit::snip20::{register_receive_msg, token_info_query, transfer_msg, TokenInfo};
//use secret_toolkit::snip20::{TokenInfo};

//use crate::contract::BLOCK_SIZE;
use crate::data::{CurrencyPair, 
    OracleConfig, OracleStatus, OracleType, LatestRoundData};

//#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[derive(Serialize, Deserialize, JsonSchema)]
pub struct InitMsg {
    pub oracle_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oracle_description: Option<String>, // TODO review if Binary
    pub oracle_status: Option<OracleStatus>,
    pub oracle_type: Option<OracleType>,
    pub data_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_source_id: Option<String>,
    pub oracle_value_decimals: i8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oracle_price_pair: Option<CurrencyPair>,
}

impl InitMsg {
    /*
    fn validationError(msg: String) -> StdError {
        return StdError::NotFound {kind: msg, backtrace: None};
    }
    pub fn validate(&self) -> StdResult<String> {
        // oracle_type
        match self.oracle_type {
            None => return InitMsg::validationError({msg: String::from("Missing oracle type spec"}),
            Some(otype) =>  match otype {
                OracleType::PriceFeed => {
                    match self.oracle_price_pair {
                        None => self.validationError("Missing oracle_price_pair for oracle of type {}", String::from(OracleType::PriceFeed)),
                    }
                }
            }
        }
        return Ok(String::from("init msg ok"));
    }*/
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandleMsg {
    SetLatestRoundData { data: LatestRoundData },
    SetOracleStatus { status: OracleStatus }, 
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandleAnswer {
    SetLatestRoundData { status: ResponseStatus },
    SetOracleStatus { status: ResponseStatus },
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    GetLatestRoundData {},
    GetOracleConfig {},
//    GetOracleStatus {},
}

// We define a custom struct for each query response
#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryAnswer {
    LatestRoundData {
//        quote: TokenInfo,
        data: LatestRoundData,
        status: ResponseStatus,
    },
    OracleStatus {
//        requests: u32,
//        updates: u32,
//        updated_at: Uint128,
        data: OracleStatus,
        status: ResponseStatus,
    },
    OracleConfig {
        data: OracleConfig,
        status: ResponseStatus,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)] //
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    Success,
    Failure,
}