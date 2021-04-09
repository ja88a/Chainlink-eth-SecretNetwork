use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use cosmwasm_std::{Uint128, CanonicalAddr, StdResult};
use secret_toolkit::snip20::{TokenInfo};

use crate::msg::{InitMsg};

/// Oracle config
#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct OracleConfig {
    pub oracle_name: String,
    pub oracle_description: Option<String>,
    pub oracle_status: OracleStatus, 
    pub oracle_type: OracleType,
    pub oracle_value_decimals: i8,
    pub oracle_price_pair: Option<CurrencyPair>,
    pub data_source: String,
    pub data_source_id: Option<String>,
    pub owner: CanonicalAddr, // TODO Check option HumanAddr
}

impl OracleConfig {
    pub fn init(
        msg: InitMsg, 
        owner_addr: CanonicalAddr
    ) -> StdResult<OracleConfig> {
//        msg.validate()?;
        let oracle = OracleConfig { 
            oracle_name: msg.oracle_name,
            oracle_description: msg.oracle_description,
            oracle_status: match msg.oracle_status {
                None => OracleStatus::Testing,
                Some(status) => status,
            },
            oracle_type: match msg.oracle_type {
                None => OracleType::PriceFeed,
                Some(otype) => otype,
            },
            data_source: msg.data_source,
            data_source_id: msg.data_source_id,
            oracle_value_decimals: msg.oracle_value_decimals,
            oracle_price_pair: msg.oracle_price_pair,
            owner: owner_addr,
        };
        return Ok(oracle);
    }
} 

#[derive(Serialize, Deserialize, Clone, Debug, JsonSchema)]
pub enum OracleStatus{
    Testing,
    Running,
    Stopped,
} 

#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub enum OracleType{
    PriceFeed,
//    TokenMetrics,
    Other,
} 

#[derive(Serialize, Deserialize, Clone, Debug, JsonSchema)]
pub struct CurrencyPair {
    pub base: TokenInfo,
    pub quote: TokenInfo,
}

/// Latest round data for an Oracle of type Aggregator
#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct LatestRoundData {
    current: i128, //int256,
    updated_at: Uint128, //uint256,
//    roundId: Uint128, //uint80,
//    startedAt: Uint128, //uint256,
//    answeredInRound: Uint128, //uint80,
}  
