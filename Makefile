NETWORK ?= local
WASM    := target/wasm32-unknown-unknown/release/lumenflow.wasm

.PHONY: build test lint deploy clean help

## build: compile the contract to WASM (release)
build:
	cargo build --target wasm32-unknown-unknown --release --package lumenflow

## test: run the full test suite
test:
	cargo test --all-features

## lint: run rustfmt check and clippy
lint:
	cargo fmt --all -- --check
	cargo clippy --all-targets --all-features -- -D warnings

## deploy: build and deploy to NETWORK (default: local)
deploy: build
	NETWORK=$(NETWORK) SOURCE_ACCOUNT=$(SOURCE_ACCOUNT) ./scripts/deploy.sh

## clean: remove build artifacts
clean:
	cargo clean

## help: print available targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
