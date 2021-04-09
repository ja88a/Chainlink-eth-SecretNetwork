all:
	RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown
	cp ./target/wasm32-unknown-unknown/release/*.wasm ./contract.wasm
	cat ./contract.wasm | gzip -9 > ./contract.wasm.gz
	## The following line is not necessary, may work only on linux (extra size optimization)
	wasm-opt -Os ./contract.wasm -o ./contract-opt.wasm
	cat ./contract-opt.wasm | gzip -9 > ./contract-opt.wasm.gz

clean:
	cargo clean
	-rm -f ./contract*.wasm*
