# Chainlink Oracles data Relayer to SecretNetwork
# All-in-One Node (integration project)

## General

A NestJS app server integrating all 3 modules composing that solution to grab Chainlink oracle contracts' data
and have their value (price feed) reported to related SecretNetwork contracts.


## Requirements

- Yarn: to install packages and run a local app server. NPM is an alternative (but was not used directly by default here)

## Install

```bash
yarn
```

Installs packages for all workspaces.

## Build

```bash
yarn build
```

## Run

```bash
yarn start
```

## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```
