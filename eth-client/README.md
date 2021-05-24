# Ethereum Watcher of Chainlink oracles contracts

## General

Watch for data & their update on target chainlink oracle contracts (price feed Aggregators) deployed on the Ethereum network.

Technically it mostly deals with a wrapping of the [ethers-io/Ethers.js](https://github.com/ethers-io/ethers.js) ethereum client SDK, embedded in [NestJS](https://nestjs.com) modules.

2 main methods are implemented in order to extract price changes from a Chainlink oracle contract & trigger an update event: 
* listening to contracts emitted events 'AnswerUpdated', using a web socket connection
* cron-based regular polling of contracts data 'latestRoundData'

There are 2 main APIs exposed to interact with this service: a REST API & a Kafka one.

## Requirements

- Yarn: to install and run. NPM is an alternative (but was not used directly by default here)
- Web3 Provider: either an online Ethereum Web3 Provider or a local provider is deployed, e.g. OpenEthereum


## Basics
### Install

```bash
yarn
```

Installs packages for all workspaces.


### Build

```bash
yarn build
```

### Run

```bash
yarn start
```

## Ethereum Web3 Provider
Your Web3 provider info are to be configured using a dotenv ```.env``` configuration, a sample file ```.env.example``` is provided: to be copied, renamed and populated according to your setup.


## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```
