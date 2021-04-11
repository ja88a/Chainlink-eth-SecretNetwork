//use schemars::JsonSchema;
use std::{any::type_name};
//use serde::{Deserialize, Serialize};
use serde::{de::DeserializeOwned, Serialize}; //, Deserialize

use cosmwasm_std::{ReadonlyStorage, StdError, StdResult, Storage};
//use cosmwasm_std::{Storage};
use cosmwasm_storage::{singleton, singleton_read, ReadonlySingleton, Singleton};

use secret_toolkit::serialization::{Bincode2, Serde};

//use crate::data::{CurrencyPair, OracleStatus, OracleType, LatestRoundData};
use crate::data::{OracleConfig};

/// Storage key dedicated to the Oracle Contract configuration data
pub static STORE_KEY_CONFIG: &[u8] = b"config";

/// Storage key dedicated to the Oracle Contract configuration data
pub static STORE_KEY_DATA: &[u8] = b"data";

/// Singleton-based pattern for writing in the storage - limited to changing the Oracle config here
pub fn config<S: Storage>(storage: &mut S) -> Singleton<S, OracleConfig> {
    singleton(storage, STORE_KEY_CONFIG)
}

/// Singleton-based pattern for reading data from the storage - limited to reading the Oracle config here
pub fn config_read<S: Storage>(storage: &S) -> ReadonlySingleton<S, OracleConfig> {
    singleton_read(storage, STORE_KEY_CONFIG)
}

/// Returns StdResult<()> resulting from saving an item to storage
///
/// # Arguments
///
/// * `storage` - a mutable reference to the storage this item should go to
/// * `key` - a byte slice representing the key to access the stored item
/// * `value` - a reference to the item to store
pub fn save<T: Serialize, S: Storage>(storage: &mut S, key: &[u8], value: &T) -> StdResult<()> {
    storage.set(key, &Bincode2::serialize(value)?);
    Ok(())
}

/// Removes an item from storage
///
/// # Arguments
///
/// * `storage` - a mutable reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn remove<S: Storage>(storage: &mut S, key: &[u8]) {
    storage.remove(key);
}

/// Returns StdResult<T> from retrieving the item with the specified key.  Returns a
/// StdError::NotFound if there is no item with that key
///
/// # Arguments
///
/// * `storage` - a reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn load<T: DeserializeOwned, S: ReadonlyStorage>(storage: &S, key: &[u8]) -> StdResult<T> {
    Bincode2::deserialize(
        &storage
            .get(key)
            .ok_or_else(|| StdError::not_found(type_name::<T>()))?,
    )
}

/// Returns StdResult<Option<T>> from retrieving the item with the specified key.
/// Returns Ok(None) if there is no item with that key
///
/// # Arguments
///
/// * `storage` - a reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn may_load<T: DeserializeOwned, S: ReadonlyStorage>(
    storage: &S,
    key: &[u8],
) -> StdResult<Option<T>> {
    match storage.get(key) {
        Some(value) => Bincode2::deserialize(&value).map(Some),
        None => Ok(None),
    }
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
    use cosmwasm_std::testing::{mock_dependencies};
//    use cosmwasm_std::{coins, from_binary};
//    use cosmwasm_std::{StdResult, Querier, StdError, Binary};
    use cosmwasm_std::{StdResult};
    use serde::{Deserialize, Serialize};

    static STORE_KEY_TEST: &[u8] = b"testKey";
    #[derive(Serialize, Deserialize, Debug)]
    struct SampleState {
        test_str: String,
    }

    #[test]
    fn save_simple() {
        let mut deps = mock_dependencies(20, &[]);

        let state = SampleState {
            test_str: String::from("test string"),
        };
        //config(&mut deps.storage).save(&state);
        let result:StdResult<()> = save(&mut deps.storage, STORE_KEY_TEST, &state);
        result.expect("Failed at saving test data");
    }

    #[test]
    fn save_and_read_simple() {
        let mut deps = mock_dependencies(20, &[]);

        let state = SampleState {
            test_str: String::from("test string"),
        };
        
        println!("Saving data in storage:\n{:#?}", state);
        let save_res:StdResult<()> = save(&mut deps.storage, STORE_KEY_TEST, &state);
        save_res.expect("Failed at saving test data");

        let load_res: StdResult<SampleState> = load(&deps.storage, STORE_KEY_TEST);
        match &load_res {
            Ok(state_stored) => {
                println!("Loaded data from storage:\n{:#?}", state_stored);
            },
            Err(error) => {
                println!("Failed to load data from storage:\n{:#?}", error);
            },
        };

        let state_stored = load_res.unwrap();
        assert_eq!("test string", state_stored.test_str)
    }
}