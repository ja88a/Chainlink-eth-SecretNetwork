# Ethereum Watcher of Chainlink Oracles data

## General

Watch for data & their update on target chainlink oracle contracts (price feed Aggregators) deployed on the Ethereum network.

It mostly deals with a wrapping of the ethers-io/EthersJS ethereum client SDK for our purpose.

2 methods are tested to extract price changes & trigger an update event: 
* listening to contracts emitted events (but none), using a web socket connection
* cron-based regular pulling of contracts 'latestRoundData'


## Requirements

- Yarn: to install and run. NPM is an alternative (but was not used directly by default here)
- Web3 Provider: either an online Ethereum Web3 Provider or a local provider is deployed, e.g. OpenEthereum


## Install

```bash
yarn
```

Installs packages for all workspaces.


## Setup

### Basic
```bash
yarn setup
```

Runs the setup step for all modules. Typically this step just compiles TypeScript, but may involve other tasks.

### Ethereum Web3 Provider
Your Web3 provider info are to be configured using a ```.env``` configuration, a sample file ```.env.example``` is provided: to be copied, renamed and populated according to your setup.


## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```
