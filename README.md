# Chainlink Oracles Data Bridge to Secret Network

## General
This repository contains the source of services and contracts for bridging Chainlink Oracle contracts' data towards Secret Network contracts. 

The overall solution and thoughts are reported in this project [https://github.com/ja88a/Chainlink-eth-SecretNetwork/wiki](wiki).

The project was developped, and still is, in the context of the Chainlink Spring 2021 Hackathon. Its proof-of-concept submission made on 2021-04-11 is available in devpost.com [https://devpost.com/software/chainlink-oracles-bridge-to-secret-network](here).

Some of the key tools / tech this project benefits from:
- [https://nestjs.com](NestJS) Best TypeScript app server development option
- [https://github.com/ethers-io/ethers.js](Ethers) Ethereum network client SDK in TypeScript
- [https://rustup.rs](RustUp) The full featured Rust toolchain installer
- [https://github.com/enigmampc/SecretNetwork](Secret Network) toolkits, ref docs and apps
- [https://github.com/CosmWasm/cosmwasm](CosmWasm) toolkits, ref docs and apps

## Tech Requirements

- Yarn
- Docker for running the services, and fully optimizing the Secret contracts
- Cargo and corresponding Rust toolkit for the Secret oracle contract development
- GNU Make to benefit from build scripts
 
Each module should define its own dependencies and provide minimum guidance. Still there are many different frameworks and technics used in order the full end-to-end solution.

## Install

```bash
yarn
```

Installs packages for all workspaces. Except for the Secret oracle contracts' dev projects. 

## Setup

```bash
yarn setup
```

Runs the setup step for all modules. Typically this step just compiles TypeScript, but may involve other tasks.

## Test

In order to test modules locally, you may need to set environment variables for the given API.

```bash
cd $module
yarn test
```

## Docker

To build a Docker container for a specific `$module`, use the following example:

```bash
make docker module=moduleName
```

The naming convention for Docker containers will be `$moduleName-module`.

Then run it with:

```bash
docker run -p 8080:8080 -e API_KEY='YOUR_API_KEY' -it moduleName-module:latest
```

## Serverless

Create the zip:

```bash
make zip module=moduleName
```

The zip will be created as `./$moduleName/dist/$moduleName-module.zip`.

### Install to AWS Lambda

- In Lambda Functions, create function
- On the Create function page:
  - Give the function a name
  - Use Node.js 12.x for the runtime
  - Choose an existing role or create a new one
  - Click Create Function
- Under Function code, select "Upload a .zip file" from the Code entry type drop-down
- Click Upload and select the `$moduleName-module.zip` file
- Handler:
  - index.handler (same as index.awsHandlerREST) for REST API Gateways (AWS Lambda default)
  - index.awsHandlerREST for REST API Gateways
  - index.awsHandlerHTTP for HTTP API Gateways
- Add the environment variable (repeat for all environment variables):
  - Key: API_KEY
  - Value: Your_API_key
- Save

By default, Lambda functions time out after 3 seconds. You may want to change that to 60s in case an API takes longer than expected to respond.

#### To Set Up an API Gateway (HTTP API)

If using a HTTP API Gateway, Lambda's built-in Test will fail, but you will be able to externally call the function successfully.

- Click Add Trigger
- Select API Gateway in Trigger configuration
- Under API, click Create an API
- Choose HTTP API
- Select the security for the API
- Click Add

#### To Set Up an API Gateway (REST API)

If using a REST API Gateway, you will need to disable the Lambda proxy integration for Lambda-based adapter to function.

- Click Add Trigger
- Select API Gateway in Trigger configuration
- Under API, click Create an API
- Choose REST API
- Select the security for the API
- Click Add
- Click the API Gateway trigger
- Click the name of the trigger (this is a link, a new window opens)
- Click Integration Request
- Uncheck Use Lamba Proxy integration
- Click OK on the two dialogs
- Click the Mapping Templates dropdown
- Check "When there are no templates defined (recommended)"
- Add new Content-Type `application/json`
- Use Mapping Template: 
```
#set($input.path("$").queryStringParameters = $input.params().querystring)
$input.json('$')
```
- Click Save
- Return to your function
- Remove the API Gateway and Save
- Click Add Trigger and use the same API Gateway
- Select the deployment stage and security
- Click Add

### Install to GCP

- In Functions, create a new function, choose to ZIP upload
- Select Node.js 12 for the Runtime
- Click Browse and select the `$moduleName-module.zip` file
- Select a Storage Bucket to keep the zip in
- Function to execute: gcpHandler
- Click More, Add variable (repeat for all environment variables)
  - NAME: API_KEY
  - VALUE: Your_API_key
