# SecretNetwork Contracts Updater with Chainlink Oracles data

## General

Update target oracle contracts data that are deployed on the Secret Network.

It mostly deals with a wrapping of the enigma/SecretJS client SDK for our purpose.

## Requirements

- Yarn: to install and run. NPM is an alternative (but was not used directly by default here)
- Secret Network Web3 Provider: either an online Web3 Provider or a local SN node


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

You can consider deploying locally a full Secret Netwrok node, or using such service provider, like the Figment.io DataHub.

## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```
