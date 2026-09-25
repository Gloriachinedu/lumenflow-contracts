use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Select a named profile from .lumenflow.toml (overrides LUMENFLOW_PROFILE env var)
    #[arg(long, value_name = "PROFILE", env = "LUMENFLOW_PROFILE")]
    profile: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Pay a merchant
    Pay {
        /// Merchant address
        #[arg(short, long)]
        merchant: String,
        /// Amount to pay
        #[arg(short, long)]
        amount: i128,
        /// Order ID
        #[arg(short, long)]
        order_id: String,
        /// Read payments from a CSV file and submit as a batch
        #[arg(long, value_name = "FILE", conflicts_with_all = ["merchant", "amount", "order_id"])]
        batch_file: Option<PathBuf>,
        /// Print what would be submitted without executing
        #[arg(long)]
        dry_run: bool,
    },
    /// Refund operations
    Refund {
        #[command(subcommand)]
        action: RefundCommands,
    },
    /// View payment history
    History {
        /// Merchant address to filter by
        #[arg(short, long)]
        merchant: String,
    },
    /// View global statistics (admin only)
    Stats,
}

#[derive(Subcommand)]
enum RefundCommands {
    /// Initiate a refund
    Init {
        /// Order ID to refund
        #[arg(short, long)]
        order_id: String,
        /// Amount to refund
        #[arg(short, long)]
        amount: i128,
    },
}

/// Per-profile configuration section.
/// Each field mirrors the top-level [Config] fields so that profile values
/// override the defaults when the profile is selected.
#[derive(Debug, Deserialize, Default, Clone)]
struct ProfileConfig {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
}

/// Top-level .lumenflow.toml structure.
///
/// Example:
/// ```toml
/// network = "testnet"
/// contract_id = "CAAAA..."
/// source_account = "SAAAA..."
///
/// [profiles.local]
/// network = "local"
/// contract_id = "CBBBB..."
/// rpc_url = "http://localhost:8000/soroban/rpc"
///
/// [profiles.testnet]
/// network = "testnet"
/// contract_id = "CCCCC..."
///
/// [profiles.mainnet]
/// network = "mainnet"
/// contract_id = "CDDDD..."
/// ```
#[derive(Debug, Deserialize, Default)]
struct Config {
    /// Default profile name used when --profile is not supplied
    default_profile: Option<String>,
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
    /// Named profiles; keys are profile names (e.g. "local", "testnet", "mainnet")
    #[serde(default)]
    profiles: HashMap<String, ProfileConfig>,
}

/// Resolved, flat configuration after merging defaults → profile → env vars.
#[derive(Debug, Default)]
struct ResolvedConfig {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
    active_profile: Option<String>,
}

fn load_config(path: Option<PathBuf>, profile_override: Option<String>) -> Result<ResolvedConfig> {
    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));

    // 1. Parse the TOML file (all defaults + profiles table)
    let raw: Config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        toml::from_str(&content)?
    } else {
        Config::default()
    };

    // 2. Determine which profile to activate:
    //    --profile flag > LUMENFLOW_PROFILE env var (clap already merged these into
    //    profile_override) > default_profile key in config > no profile
    let active_profile = profile_override.or_else(|| raw.default_profile.clone());

    // 3. Start from top-level defaults
    let mut resolved = ResolvedConfig {
        network: raw.network.clone(),
        contract_id: raw.contract_id.clone(),
        source_account: raw.source_account.clone(),
        rpc_url: raw.rpc_url.clone(),
        active_profile: active_profile.clone(),
    };

    // 4. Overlay the selected profile (if any)
    if let Some(ref name) = active_profile {
        match raw.profiles.get(name) {
            Some(p) => {
                if p.network.is_some() {
                    resolved.network = p.network.clone();
                }
                if p.contract_id.is_some() {
                    resolved.contract_id = p.contract_id.clone();
                }
                if p.source_account.is_some() {
                    resolved.source_account = p.source_account.clone();
                }
                if p.rpc_url.is_some() {
                    resolved.rpc_url = p.rpc_url.clone();
                }
            }
            None => {
                return Err(anyhow!(
                    "Profile '{}' not found in {}. Available profiles: [{}]",
                    name,
                    config_path.display(),
                    raw.profiles
                        .keys()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
    }

    // 5. Environment variables take highest precedence
    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK") {
        resolved.network = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_CONTRACT_ID") {
        resolved.contract_id = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_SOURCE") {
        resolved.source_account = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_RPC_URL") {
        resolved.rpc_url = Some(v);
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp_config = ".test_lumenflow_basic.toml";
        fs::write(
            temp_config,
            "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"",
        )?;
        let config = load_config(Some(PathBuf::from(temp_config)), None)?;
        assert_eq!(config.network.as_deref(), Some("local"));
        assert_eq!(config.contract_id.as_deref(), Some("C123"));
        assert_eq!(config.source_account.as_deref(), Some("S123"));
        fs::remove_file(temp_config)?;
        Ok(())
    }

    #[test]
    fn test_load_config_from_env() -> Result<()> {
        std::env::set_var("LUMENFLOW_NETWORK", "devnet");
        let config = load_config(None, None)?;
        assert_eq!(config.network.as_deref(), Some("devnet"));
        std::env::remove_var("LUMENFLOW_NETWORK");
        Ok(())
    }

    #[test]
    fn test_profile_selection() -> Result<()> {
        let temp_config = ".test_lumenflow_profiles.toml";
        fs::write(
            temp_config,
            r#"
network = "testnet"
contract_id = "CDEFAULT"

[profiles.local]
network = "local"
contract_id = "CLOCAL"
rpc_url = "http://localhost:8000/soroban/rpc"

[profiles.testnet]
network = "testnet"
contract_id = "CTESTNET"

[profiles.mainnet]
network = "mainnet"
contract_id = "CMAINNET"
"#,
        )?;

        // No profile → use top-level defaults
        let cfg = load_config(Some(PathBuf::from(temp_config)), None)?;
        assert_eq!(cfg.network.as_deref(), Some("testnet"));
        assert_eq!(cfg.contract_id.as_deref(), Some("CDEFAULT"));
        assert!(cfg.active_profile.is_none());

        // Select "local" profile
        let cfg_local = load_config(Some(PathBuf::from(temp_config)), Some("local".into()))?;
        assert_eq!(cfg_local.network.as_deref(), Some("local"));
        assert_eq!(cfg_local.contract_id.as_deref(), Some("CLOCAL"));
        assert_eq!(
            cfg_local.rpc_url.as_deref(),
            Some("http://localhost:8000/soroban/rpc")
        );
        assert_eq!(cfg_local.active_profile.as_deref(), Some("local"));

        // Select "mainnet" profile
        let cfg_main = load_config(Some(PathBuf::from(temp_config)), Some("mainnet".into()))?;
        assert_eq!(cfg_main.network.as_deref(), Some("mainnet"));
        assert_eq!(cfg_main.contract_id.as_deref(), Some("CMAINNET"));

        fs::remove_file(temp_config)?;
        Ok(())
    }

    #[test]
    fn test_invalid_profile_returns_error() -> Result<()> {
        let temp_config = ".test_lumenflow_badprofile.toml";
        fs::write(temp_config, "[profiles.local]\nnetwork = \"local\"")?;
        let result = load_config(Some(PathBuf::from(temp_config)), Some("nonexistent".into()));
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("nonexistent"));
        fs::remove_file(temp_config)?;
        Ok(())
    }

    #[test]
    fn test_default_profile_from_config() -> Result<()> {
        let temp_config = ".test_lumenflow_defaultprofile.toml";
        fs::write(
            temp_config,
            r#"
default_profile = "testnet"
network = "local"

[profiles.testnet]
network = "testnet"
contract_id = "CTESTNET"
"#,
        )?;
        let cfg = load_config(Some(PathBuf::from(temp_config)), None)?;
        assert_eq!(cfg.network.as_deref(), Some("testnet"));
        assert_eq!(cfg.active_profile.as_deref(), Some("testnet"));
        fs::remove_file(temp_config)?;
        Ok(())
    }
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config, cli.profile)?;

    if let Some(ref p) = config.active_profile {
        println!("[profile: {}]", p);
    }

    match &cli.command {
        Commands::Pay {
            merchant,
            amount,
            order_id,
            batch_file: _,
            dry_run: _,
        } => {
            println!("Processing payment...");
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!(
                "  Network:  {}",
                config.network.as_deref().unwrap_or("testnet")
            );
            println!(
                "\nSuccess! Payment for order {} has been submitted.",
                order_id
            );
        }
        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, amount } => {
                println!("Initiating refund of {} for order {}...", amount, order_id);
                println!(
                    "  Contract: {}",
                    config.contract_id.as_deref().unwrap_or("N/A")
                );
            }
        },
        Commands::History { merchant } => {
            println!("Fetching payment history for merchant {}...", merchant);
            println!("  (Mock data)");
            println!("  - ORDER_001: 500 XLM");
            println!("  - ORDER_002: 1200 XLM");
        }
        Commands::Stats => {
            println!("Global LumenFlow Statistics:");
            println!("  Total Volume:   45,000.00");
            println!("  Total Payments: 128");
            println!("  Active Merch:   12");
        }
    }

    Ok(())
}
