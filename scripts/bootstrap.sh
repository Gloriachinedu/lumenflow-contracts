#!/usr/bin/env bash
# scripts/bootstrap.sh — Install all dependencies needed to develop LumenFlow locally.
# Supports Linux (x86_64/arm64) and macOS.
set -euo pipefail

STELLAR_CLI_VERSION="21.4.1"
WASM_TARGET="wasm32-unknown-unknown"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
warn()    { echo "[WARN]  $*"; }
error()   { echo "[ERROR] $*" >&2; exit 1; }

has() { command -v "$1" &>/dev/null; }

OS="$(uname -s)"
ARCH="$(uname -m)"

# ── Rust ──────────────────────────────────────────────────────────────────────

install_rust() {
    if has cargo; then
        success "Rust already installed: $(cargo --version)"
    else
        info "Installing Rust via rustup..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env"
        success "Rust installed: $(cargo --version)"
    fi
}

install_wasm_target() {
    if rustup target list --installed | grep -q "$WASM_TARGET"; then
        success "WASM target already present: $WASM_TARGET"
    else
        info "Adding Rust target $WASM_TARGET..."
        rustup target add "$WASM_TARGET"
        success "WASM target added: $WASM_TARGET"
    fi
}

# ── Stellar CLI ───────────────────────────────────────────────────────────────

install_stellar_cli() {
    if has stellar; then
        success "Stellar CLI already installed: $(stellar --version 2>&1 | head -1)"
        return
    fi

    info "Installing Stellar CLI v${STELLAR_CLI_VERSION}..."

    case "$OS" in
        Linux)
            case "$ARCH" in
                x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
                aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
                *) error "Unsupported Linux architecture: $ARCH" ;;
            esac
            URL="https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-${TRIPLE}.tar.gz"
            curl -sSfL "$URL" | tar -xz -C /tmp
            install -m 755 /tmp/stellar "$HOME/.cargo/bin/stellar" 2>/dev/null || \
                sudo install -m 755 /tmp/stellar /usr/local/bin/stellar
            ;;
        Darwin)
            if has brew; then
                brew install stellar/tap/stellar-cli
            else
                case "$ARCH" in
                    x86_64)  TRIPLE="x86_64-apple-darwin" ;;
                    arm64)   TRIPLE="aarch64-apple-darwin" ;;
                    *) error "Unsupported macOS architecture: $ARCH" ;;
                esac
                URL="https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-${TRIPLE}.tar.gz"
                curl -sSfL "$URL" | tar -xz -C /tmp
                sudo install -m 755 /tmp/stellar /usr/local/bin/stellar
            fi
            ;;
        *) error "Unsupported OS: $OS" ;;
    esac

    success "Stellar CLI installed: $(stellar --version 2>&1 | head -1)"
}

# ── Docker ────────────────────────────────────────────────────────────────────

check_docker() {
    if has docker && docker info &>/dev/null 2>&1; then
        success "Docker is running: $(docker --version)"
    else
        warn "Docker is not installed or not running."
        warn "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        warn "Docker is required only for local Stellar network (stellar network container start local)."
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
    echo "============================================"
    echo "  LumenFlow — Local Environment Bootstrap"
    echo "============================================"
    echo "OS: $OS / ARCH: $ARCH"
    echo ""

    install_rust
    install_wasm_target
    install_stellar_cli
    check_docker

    echo ""
    echo "============================================"
    echo "  Bootstrap complete!"
    echo "============================================"
    echo ""
    echo "Verify installation:"
    echo "  rustc --version"
    echo "  cargo --version"
    echo "  stellar --version"
    echo "  docker --version"
    echo ""
    echo "Build the contract:"
    echo "  cargo build --target wasm32-unknown-unknown --release --package lumenflow"
    echo ""
    echo "Run tests:"
    echo "  ./scripts/test.sh"
    echo ""
    echo "Deploy (local):"
    echo "  stellar network container start local"
    echo "  NETWORK=local SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh"
}

main "$@"
