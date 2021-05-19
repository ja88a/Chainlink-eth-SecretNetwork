OUTPUT_CONTRACT_NAME=cw_scrt_oracle_price

.DEFAULT_GOAL := help
.PHONY: help clear version version-host init clean schema test wasm wasm-opt all

help:
	@echo "Available make targets:"	
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	| sed -n 's/^\(.*\): \(.*\)##\(.*\)/\1\3/p' 
	
all: | init version schema test wasm wasm-opt wasm-scrt ## All-in-one build, test and release optimized Contract WASM

all-clean:| clear init clean version-host version all ## All-in-one cleanup, build, test and release optimized Contract WASM

version: ## Show your toolchain versions
	-@make --version
	-@rustup --version
	-@rustup toolchain list | grep -i default
	-@rustup target list | grep -i installed
	@cargo version

version-host: ## Display hosting linux info
	-@hostnamectl
	-@lsb_release -a 
	-@uname -r
	-@cat /etc/os-release  

wasm: ## Build the contract wasm
	RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown
	cp ./target/wasm32-unknown-unknown/release/$(OUTPUT_CONTRACT_NAME).wasm ./dist
	cat ./dist/$(OUTPUT_CONTRACT_NAME).wasm | gzip -9 > ./dist/$(OUTPUT_CONTRACT_NAME).wasm.gz

wasm-opt: ## Optimize the built contract wasm, based on wasm-opt
	wasm-opt -Os ./dist/$(OUTPUT_CONTRACT_NAME).wasm -o ./dist/$(OUTPUT_CONTRACT_NAME)-opt.wasm
	cat ./dist/$(OUTPUT_CONTRACT_NAME)-opt.wasm | gzip -9 > ./dist/$(OUTPUT_CONTRACT_NAME)-opt.wasm.gz

wasm-scrt: ## Build an optimized contract wasm for SecretNetwork, based on Docker image 'enigmampc/secret-contract-optimizer'
	docker run --rm -v "$(PWD)":/contract \
  		--mount type=volume,source="$(shell basename $(PWD))_cache",target=/code/target \
  		--mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  		enigmampc/secret-contract-optimizer:1.0.4

schema: ## Generate contract schema
	cargo schema

schema-convert:
	npx compile-schemas-to-typescript ./schema ./dist/types
	cat dist/types/*.d.ts > dist/types/contract.d.ts

test: ## Tests execution, as found in your crate lib
	RUST_BACKTRACE=0 cargo test

clean: ## Clean up your local build and release directories
	cargo clean
	-rm -rf ./dist/*

clearscrn:
	clear

init: ## Create required default build dirs
	-mkdir ./dist
