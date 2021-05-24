# Chainlink Oracles data Relayer to SecretNetwork
# All-in-One Node (integration project)

## General


## Requirements

- Yarn: to install and run. NPM is an alternative (but was not used directly by default here)
- Secret Network Web3 Provider: either an online Web3 Provider or a local Secret node


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

### Secret Network Web3 Provider
Your Web3 provider info are to be configured using a ```.env``` configuration, a sample file ```.env.example``` is provided: to be copied, renamed and populated according to your setup.

You can consider deploying locally a full Secret Netwrok node, or using a service provider, e.g. [Figment.io DataHub](https://datahub.figment.io).

## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```
