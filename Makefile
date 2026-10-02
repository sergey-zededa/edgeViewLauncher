# Convenience wrappers around the npm scripts in package.json, which remain
# the source of truth for build commands. Run `make help` for the list.

# Equivalent of `. "$HOME/.cargo/env"`: rustup's default install location, so
# Tauri finds cargo even in a shell opened before Rust was installed.
export PATH := $(HOME)/.cargo/bin:$(PATH)

.DEFAULT_GOAL := help
.PHONY: help deps rust-toolchain no-running-app quit backend frontend dev run test test-go test-frontend test-rust vet check build build-mac build-windows build-linux

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

deps: ## Install root and frontend npm dependencies
	npm ci
	cd frontend && npm ci

# npm writes node_modules/.package-lock.json on install, so these reinstall
# only when missing or when the lockfile changes.
node_modules/.package-lock.json: package-lock.json
	npm ci

frontend/node_modules/.package-lock.json: frontend/package-lock.json
	cd frontend && npm ci

NODE_DEPS := node_modules/.package-lock.json frontend/node_modules/.package-lock.json

rust-toolchain:
	@command -v cargo >/dev/null 2>&1 || { \
		echo "Rust (cargo) is required for Tauri. Install it with:"; \
		echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; \
		echo "then open a new terminal (or run: source \$$HOME/.cargo/env)."; \
		exit 1; }

# The app is single-instance: if any copy is already running (e.g. the
# installed one, often only visible as a tray icon), the dev build just
# focuses it and exits. Fail early with a clear message instead.
APP_PROCS := [e]dgeview-launcher$$|[e]dgeview-backend -port

no-running-app:
	@if pgrep -f '$(APP_PROCS)' >/dev/null; then \
		echo "EdgeView Launcher is already running, so the dev build would exit immediately:"; \
		pgrep -fl '$(APP_PROCS)' | sed 's/^/  /'; \
		echo "Quit it with: make quit"; \
		exit 1; fi

quit: ## Quit any running EdgeView Launcher (installed or dev), incl. its backend
	@osascript -e 'tell application "EdgeView Launcher" to quit' >/dev/null 2>&1 || true
	@for i in 1 2 3 4 5; do pgrep -f '$(APP_PROCS)' >/dev/null || break; sleep 1; done
	@if pgrep -f '$(APP_PROCS)' >/dev/null; then pkill -TERM -f '$(APP_PROCS)'; sleep 1; fi
	@if pgrep -f '$(APP_PROCS)' >/dev/null; then echo "Still running:"; pgrep -fl '$(APP_PROCS)'; exit 1; \
		else echo "EdgeView Launcher is not running."; fi

backend: ## Build the Go backend sidecar (macOS ARM64)
	npm run build:backend:mac

frontend: frontend/node_modules/.package-lock.json ## Build the frontend only
	npm run build:frontend

dev: no-running-app $(NODE_DEPS) rust-toolchain backend ## Rebuild the backend, then start Vite + Tauri in dev mode
	npm run dev

run: dev ## Alias for dev

test: test-go test-frontend test-rust ## Run Go, frontend and Rust tests

test-go: ## Run Go tests
	go test ./...

test-frontend: frontend/node_modules/.package-lock.json ## Run frontend tests (non-watch)
	cd frontend && npm test -- --run

test-rust: rust-toolchain ## Run Rust tests
	cd src-tauri && cargo test

vet: ## Run go vet
	go vet ./...

check: vet test frontend backend ## Vet, test and build everything (pre-PR check)

build: build-mac ## Production build (macOS ARM64)

build-mac: $(NODE_DEPS) rust-toolchain ## Production build for macOS ARM64
	npm run build:mac

build-windows: $(NODE_DEPS) rust-toolchain ## Production build for Windows x64
	npm run build:windows

build-linux: $(NODE_DEPS) rust-toolchain ## Production build for Linux x64
	npm run build:linux
