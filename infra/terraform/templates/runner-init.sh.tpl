#!/usr/bin/env bash
# templates/runner-init.sh.tpl
# Cloud-init script to register a GitHub Actions self-hosted runner on Ubuntu 22.04.
set -euo pipefail

# Install dependencies
apt-get update -y
apt-get install -y curl jq unzip

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.87.0
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown

# Create runner user
useradd -m runner || true
cd /home/runner

# Download the latest GitHub Actions runner
RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | tr -d 'v')
curl -fsSL "https://github.com/actions/runner/releases/download/v$${RUNNER_VERSION}/actions-runner-linux-x64-$${RUNNER_VERSION}.tar.gz" \
  | tar -xz -C /home/runner

chown -R runner:runner /home/runner

# Register the runner
sudo -u runner /home/runner/config.sh \
  --url "https://github.com/${github_repo}" \
  --token "${github_token}" \
  --name "${runner_name}" \
  --labels "self-hosted,Linux,X64,lumenflow" \
  --unattended

# Install and start as a systemd service
/home/runner/svc.sh install runner
/home/runner/svc.sh start
