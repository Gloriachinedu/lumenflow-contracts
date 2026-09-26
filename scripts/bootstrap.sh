#!/usr/bin/env bash
# scripts/bootstrap.sh — Idempotent, platform-aware local dev environment setup
#
# Resolves: #855
#
# This script installs all tools required to develop LumenFlow locally.
# It is safe to run multiple times — every step checks whether the tool is
# already present and at the correct version before doing anything.
#
# Supported platforms:
#   Linux   x86_64, aarch64
#   macOS   x86_64 (Intel), arm64 (Apple Silicon)
#
# Usage:
#   ./scripts/bootstrap.sh           # full install
#   ./scripts/bootstrap.sh --check   # dry-run: report status without installing
#
# Exit codes:
#   0  all required tools are installed and at the correct version
#   1  an error occurred (see stderr)
#   2  --check mode: one or more tools are missing (non-blocking in normal mode)

set -euo pipefail

# ── Pinned versions ────────────────────────────────────────────────────────────
# Update these when the project updates its toolchain.
REQUIRED_STELLAR_VERSION="22.8.1"
REQUIRED_RUST_CHANNEL="1.87.0"          # matches rust-toolchain.toml
WASM_TARGET="wasm32-unknown-unknown"
NODE_MIN_MAJOR=18                        # minimum Node.js version for scripts

# ── Helpers ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
skip()    { echo -e "${GREEN}[SKIP]${RESET}  $* (already installed)"; }

has() { command -v "$1" &>/dev/null; }

# Semver comparison: returns 0 if $1 >= $2 (both as "major.minor.patch")
version_ge() {
  local a b
  IFS='.' read -ra a <<< "$1"
  IFS='.' read -ra b <<< "$2"
  for i in 0 1 2; do
    local av="${a[$i]:-0}" bv="${b[$i]:-0}"
    if (( 10#$av > 10#$bv )); then return 0; fi
    if (( 10#$av < 10#$bv )); then return 1; fi
  done
  return 0
}

OS="$(uname -s)"
ARCH="$(uname -m)"
CHECK_ONLY=false
MISSING=0

[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

# ── Platform detection ─────────────────────────────────────────────────────────

detect_platform() {
  case "$OS" in
    Linux)
      case "$ARCH" in
        x86_64)  PLATFORM="linux-x86_64"  ;;
        aarch64) PLATFORM="linux-aarch64" ;;
        *)
          error "Unsupported Linux architecture: $ARCH"
          error "Supported: x86_64, aarch64"
          exit 1
          ;;
      esac
      ;;
    Darwin)
      case "$ARCH" in
        x86_64) PLATFORM="macos-x86_64"  ;;
        arm64)  PLATFORM="macos-arm64"   ;;
        *)
          error "Unsupported macOS architecture: $ARCH"
          error "Supported: x86_64, arm64"
          exit 1
          ;;
      esac
      ;;
    *)
      error "Unsupported OS: $OS"
      error "Supported: Linux, macOS"
      exit 1
      ;;
  esac
}

# ── Rust ───────────────────────────────────────────────────────────────────────

check_rust() {
  if has rustc && has cargo; then
    local version
    version=$(rustc --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "0.0.0")
    if version_ge "$version" "$REQUIRED_RUST_CHANNEL"; then
      success "Rust $version (>= $REQUIRED_RUST_CHANNEL) ✓"
      return 0
    else
      warn "Rust $version is installed but $REQUIRED_RUST_CHANNEL is required"
      return 1
    fi
  fi
  return 1
}

install_rust() {
  if check_rust; then
    skip "Rust"
    return
  fi

  if $CHECK_ONLY; then
    warn "[CHECK] Rust is not installed or outdated"
    MISSING=$((MISSING + 1))
    return
  fi

  info "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain "$REQUIRED_RUST_CHANNEL" --no-modify-path

  # Source cargo env if not already in PATH
  if ! has cargo; then
    # shellcheck source=/dev/null
    source "${CARGO_HOME:-$HOME/.cargo}/env" 2>/dev/null || true
  fi

  success "Rust installed: $(rustc --version)"
}

# ── Rust toolchain (pin to rust-toolchain.toml) ───────────────────────────────

check_wasm_target() {
  rustup target list --installed 2>/dev/null | grep -q "^${WASM_TARGET}$"
}

install_wasm_target() {
  if check_wasm_target; then
    skip "WASM target $WASM_TARGET"
    return
  fi

  if $CHECK_ONLY; then
    warn "[CHECK] WASM target $WASM_TARGET is not installed"
    MISSING=$((MISSING + 1))
    return
  fi

  info "Adding Rust target $WASM_TARGET..."
  rustup target add "$WASM_TARGET"
  success "WASM target added: $WASM_TARGET"
}

# ── Stellar CLI ────────────────────────────────────────────────────────────────

check_stellar() {
  if ! has stellar; then
    return 1
  fi
  local version
  version=$(stellar --version 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "0.0.0")
  if version_ge "$version" "$REQUIRED_STELLAR_VERSION"; then
    success "Stellar CLI $version (>= $REQUIRED_STELLAR_VERSION) ✓"
    return 0
  else
    warn "Stellar CLI $version is installed but $REQUIRED_STELLAR_VERSION is required"
    return 1
  fi
}

install_stellar_cli() {
  if check_stellar; then
    skip "Stellar CLI"
    return
  fi

  if $CHECK_ONLY; then
    warn "[CHECK] Stellar CLI is not installed or outdated"
    MISSING=$((MISSING + 1))
    return
  fi

  info "Installing Stellar CLI v${REQUIRED_STELLAR_VERSION} for $PLATFORM ..."

  local url triple
  case "$PLATFORM" in
    linux-x86_64)  triple="x86_64-unknown-linux-gnu" ;;
    linux-aarch64) triple="aarch64-unknown-linux-gnu" ;;
    macos-x86_64)  triple="x86_64-apple-darwin" ;;
    macos-arm64)   triple="aarch64-apple-darwin" ;;
  esac

  if [[ "$PLATFORM" == macos-* ]] && has brew; then
    info "Installing via Homebrew..."
    brew install stellar/tap/stellar-cli
  else
    url="https://github.com/stellar/stellar-cli/releases/download/v${REQUIRED_STELLAR_VERSION}/stellar-cli-${REQUIRED_STELLAR_VERSION}-${triple}.tar.gz"
    info "Downloading $url ..."
    local tmpdir
    tmpdir="$(mktemp -d)"
    curl -sSfL "$url" | tar -xz -C "$tmpdir" stellar

    local install_dir="${CARGO_HOME:-$HOME/.cargo}/bin"
    if [[ -d "$install_dir" ]]; then
      install -m 755 "$tmpdir/stellar" "$install_dir/stellar"
    elif [[ -w /usr/local/bin ]]; then
      install -m 755 "$tmpdir/stellar" /usr/local/bin/stellar
    else
      sudo install -m 755 "$tmpdir/stellar" /usr/local/bin/stellar
    fi
    rm -rf "$tmpdir"
  fi

  success "Stellar CLI installed: $(stellar --version 2>&1 | head -1)"
}

# ── Docker ─────────────────────────────────────────────────────────────────────

check_docker() {
  if has docker && docker info &>/dev/null 2>&1; then
    success "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) ✓"
    return 0
  fi
  return 1
}

warn_docker() {
  if check_docker; then
    skip "Docker"
    return
  fi

  # Docker is optional — a warning, not an error
  warn "Docker is not installed or not running."
  warn "  Docker is required only for local Stellar network."
  warn "  Install: https://www.docker.com/products/docker-desktop"
  if $CHECK_ONLY; then
    MISSING=$((MISSING + 1))  # count it as missing in check mode
  fi
}

# ── Node.js ────────────────────────────────────────────────────────────────────

check_node() {
  if ! has node; then
    return 1
  fi
  local major
  major=$(node --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  if (( 10#$major >= NODE_MIN_MAJOR )); then
    success "Node.js v$major (>= $NODE_MIN_MAJOR) ✓"
    return 0
  else
    warn "Node.js v$major is installed but >= $NODE_MIN_MAJOR is required"
    return 1
  fi
}

warn_node() {
  if check_node; then
    skip "Node.js"
    return
  fi

  warn "Node.js >= $NODE_MIN_MAJOR is not installed."
  warn "  Required for scripts/restore-drill.mjs and scripts/backup-manager.mjs."
  warn "  Install: https://nodejs.org"
  if $CHECK_ONLY; then
    MISSING=$((MISSING + 1))
  fi
}

# ── Git hooks ──────────────────────────────────────────────────────────────────

install_git_hooks() {
  if [[ ! -d ".git" ]]; then
    warn "Not in a git repository — skipping hook installation"
    return
  fi

  local hooks_script="scripts/install_hooks.sh"
  if [[ -f "$hooks_script" ]]; then
    if $CHECK_ONLY; then
      info "[CHECK] Git hooks would be installed via $hooks_script"
      return
    fi
    info "Installing git hooks..."
    bash "$hooks_script"
    success "Git hooks installed"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  echo "============================================"
  echo "  LumenFlow — Local Environment Bootstrap"
  if $CHECK_ONLY; then
    echo "  Mode: CHECK ONLY (no changes will be made)"
  fi
  echo "============================================"
  detect_platform
  echo "  Platform: $OS / $ARCH ($PLATFORM)"
  echo ""

  install_rust
  install_wasm_target
  install_stellar_cli
  warn_docker
  warn_node
  install_git_hooks

  echo ""
  echo "============================================"

  if $CHECK_ONLY; then
    if [[ "$MISSING" -gt 0 ]]; then
      echo "  ⚠️  CHECK: $MISSING tool(s) missing or outdated."
      echo "============================================"
      echo ""
      echo "Run './scripts/bootstrap.sh' (without --check) to install them."
      exit 2
    else
      echo "  ✅ CHECK: All required tools are installed."
      echo "============================================"
      exit 0
    fi
  fi

  echo "  Bootstrap complete!"
  echo "============================================"
  echo ""
  echo "Verify your installation:"
  echo "  rustc --version"
  echo "  cargo --version"
  echo "  stellar --version"
  echo "  docker --version"
  echo "  node --version"
  echo ""
  echo "Build the contract:"
  echo "  cargo build --target $WASM_TARGET --release --package lumenflow"
  echo ""
  echo "Run tests:"
  echo "  ./scripts/test.sh"
  echo ""
  echo "Deploy (local):"
  echo "  stellar network container start local"
  echo "  NETWORK=local SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh"
}

main "$@"
