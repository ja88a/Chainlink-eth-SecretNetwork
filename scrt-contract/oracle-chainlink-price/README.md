# Secret Oracle Price Contract

## General
### Oracle Price CosmWasm contract
Template of oracle contracts reflecting data feeds, addressing first the representation of price feeds.
2 main parts:
- the oracle contract configuration: make the contract purpose clear to others and publicly discoverable
- manage the data: gets updated from off-chain services, granted to do so, and expose these data to consumer contracts

### Status
This is a work a progress. This v0.1 is functional but will be further reviewed & enhanced.


### Secret & CosmWasm guidance
This is a secret Oracle Price contract in Rust to run in [Secret Network](https://github.com/enigmampc/SecretNetwork).

To understand the framework better, please read the overview in the [cosmwasm repo](https://github.com/CosmWasm/cosmwasm/blob/master/README.md),
and dig into the [cosmwasm docs](https://www.cosmwasm.com). 
This assumes you understand the theory and just want to get coding.

Check out [Developing](./Developing.md) to explain more on how to run tests and develop code. Or go through the [online tutorial](https://www.cosmwasm.com/docs/getting-started/intro) to get a better feel of how to develop.

[Publishing](./Publishing.md) contains useful information on how to publish your contract to the world, once you are ready to deploy it on a running blockchain. And [Importing](./Importing.md) contains information about pulling in other contracts or crates that have been published.


## Dev Setup

### Required tools
- Rust & Cargo - using rustup.rs as toolchain manager is highly recommended
- CosmWasm as Rust toolchain target
- GNU Make - to run the many available build scripts available in Makefile (for Linux / WSL)
- Docker - to run the best optimization of your Secret contract

### Available script commands
```
make [help]
```

### Setup
```
make init wasm
```

### Test
```
make test
```

### Contract compilation
All-in-one local clean up, schema generation, run tests and generate the optimized contract:
```
make all-clean
```

Raw contract wasm generation + targz reported in ```./dist```:
```
make wasm
```

Locally optimized:
```
make wasm-opt
```

### Production ready compiled & optmized wasm
Based on [enigmampc/secret-contract-optimizer]()
```
docker run --rm -v "$(pwd)":/contract \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  enigmampc/secret-contract-optimizer
```

Available via:
```
make wasm-scrt
```
