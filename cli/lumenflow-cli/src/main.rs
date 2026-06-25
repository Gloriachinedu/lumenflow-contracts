use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;

// ── CLI definition ─────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Pay a merchant
    Pay {
        #[arg(short, long)]
        merchant: String,
        #[arg(short, long)]
        amount: i128,
        #[arg(short, long)]
        order_id: String,
    },
    /// Refund operations
    Refund {
        #[command(subcommand)]
        action: RefundCommands,
    },
    /// View payment history
    History {
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
        #[arg(short, long)]
        order_id: String,
        #[arg(short, long)]
        amount: i128,
    },
}

// ── Config ─────────────────────────────────────────────────────────────────────

const VALID_NETWORKS: &[&str] = &["local", "testnet", "mainnet"];

#[derive(Debug, Deserialize, Default)]
pub struct Config {
    pub network: Option<String>,
    pub contract_id: Option<String>,
    pub source_account: Option<String>,
}

/// A validated, ready-to-use config. All fields are guaranteed non-empty.
pub struct ValidatedConfig {
    pub network: String,
    pub contract_id: String,
    pub source_account: String,
}

/// Validation errors with actionable guidance.
#[derive(Debug, PartialEq)]
pub enum ConfigError {
    MissingField { field: &'static str, env_var: &'static str, toml_key: &'static str },
    InvalidNetwork { value: String },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::MissingField { field, env_var, toml_key } => write!(
                f,
                "Missing required config field: {field}\n  \
                 Set it via environment variable:  {env_var}=<value>\n  \
                 Or add to .lumenflow.toml:        {toml_key} = \"<value>\""
            ),
            ConfigError::InvalidNetwork { value } => write!(
                f,
                "Invalid network \"{value}\".\n  \
                 Allowed values: {networks}\n  \
                 Set LUMENFLOW_NETWORK or network = \"...\" in .lumenflow.toml.",
                networks = VALID_NETWORKS.join(", ")
            ),
        }
    }
}

impl std::error::Error for ConfigError {}

pub fn validate_config(cfg: Config) -> Result<ValidatedConfig, Vec<ConfigError>> {
    let mut errors: Vec<ConfigError> = Vec::new();

    // network
    let network = match cfg.network {
        None | Some(ref s) if s.trim().is_empty() => {
            errors.push(ConfigError::MissingField {
                field: "network",
                env_var: "LUMENFLOW_NETWORK",
                toml_key: "network",
            });
            String::new()
        }
        Some(n) => {
            if !VALID_NETWORKS.contains(&n.as_str()) {
                errors.push(ConfigError::InvalidNetwork { value: n.clone() });
            }
            n
        }
    };

    // contract_id
    let contract_id = match cfg.contract_id {
        None | Some(ref s) if s.trim().is_empty() => {
            errors.push(ConfigError::MissingField {
                field: "contract_id",
                env_var: "LUMENFLOW_CONTRACT_ID",
                toml_key: "contract_id",
            });
            String::new()
        }
        Some(v) => v,
    };

    // source_account
    let source_account = match cfg.source_account {
        None | Some(ref s) if s.trim().is_empty() => {
            errors.push(ConfigError::MissingField {
                field: "source_account",
                env_var: "LUMENFLOW_SOURCE",
                toml_key: "source_account",
            });
            String::new()
        }
        Some(v) => v,
    };

    if errors.is_empty() {
        Ok(ValidatedConfig { network, contract_id, source_account })
    } else {
        Err(errors)
    }
}

// ── Config loader ──────────────────────────────────────────────────────────────

pub fn load_config(path: Option<PathBuf>) -> Result<Config> {
    let mut config = Config::default();

    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        config = toml::from_str(&content)?;
    }

    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK")     { config.network         = Some(v); }
    if let Ok(v) = std::env::var("LUMENFLOW_CONTRACT_ID") { config.contract_id      = Some(v); }
    if let Ok(v) = std::env::var("LUMENFLOW_SOURCE")      { config.source_account   = Some(v); }

    Ok(config)
}

// ── Entry point ────────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let raw_config = load_config(cli.config)?;

    let config = validate_config(raw_config).unwrap_or_else(|errors| {
        eprintln!("Configuration error(s) found:\n");
        for (i, e) in errors.iter().enumerate() {
            eprintln!("  {}. {}\n", i + 1, e);
        }
        std::process::exit(1);
    });

    match &cli.command {
        Commands::Pay { merchant, amount, order_id } => {
            println!("Processing payment...");
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!("  Network:  {}", config.network);
            println!("\nSuccess! Payment for order {} has been submitted.", order_id);
        }
        Commands::Refund { action } => {
            match action {
                RefundCommands::Init { order_id, amount } => {
                    println!("Initiating refund of {} for order {}...", amount, order_id);
                    println!("  Contract: {}", config.contract_id);
                }
            }
        }
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

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn full_config() -> Config {
        Config {
            network: Some("testnet".into()),
            contract_id: Some("C123456".into()),
            source_account: Some("SABC...".into()),
        }
    }

    #[test]
    fn test_valid_config_passes() {
        let result = validate_config(full_config());
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v.network, "testnet");
        assert_eq!(v.contract_id, "C123456");
    }

    #[test]
    fn test_missing_network_reports_error() {
        let cfg = Config { network: None, ..full_config() };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(e, ConfigError::MissingField { field: "network", .. })));
    }

    #[test]
    fn test_missing_contract_id_reports_error() {
        let cfg = Config { contract_id: None, ..full_config() };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(e, ConfigError::MissingField { field: "contract_id", .. })));
    }

    #[test]
    fn test_missing_source_account_reports_error() {
        let cfg = Config { source_account: None, ..full_config() };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(e, ConfigError::MissingField { field: "source_account", .. })));
    }

    #[test]
    fn test_all_missing_reports_three_errors() {
        let cfg = Config::default();
        let errors = validate_config(cfg).unwrap_err();
        assert_eq!(errors.len(), 3);
    }

    #[test]
    fn test_invalid_network_reports_error() {
        let cfg = Config { network: Some("devnet".into()), ..full_config() };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(e, ConfigError::InvalidNetwork { .. })));
    }

    #[test]
    fn test_valid_networks_accepted() {
        for net in ["local", "testnet", "mainnet"] {
            let cfg = Config { network: Some(net.into()), ..full_config() };
            assert!(validate_config(cfg).is_ok(), "Expected {net} to be valid");
        }
    }

    #[test]
    fn test_empty_string_treated_as_missing() {
        let cfg = Config { network: Some("  ".into()), ..full_config() };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(e, ConfigError::MissingField { field: "network", .. })));
    }

    #[test]
    fn test_error_message_contains_guidance() {
        let e = ConfigError::MissingField {
            field: "network",
            env_var: "LUMENFLOW_NETWORK",
            toml_key: "network",
        };
        let msg = e.to_string();
        assert!(msg.contains("LUMENFLOW_NETWORK"));
        assert!(msg.contains(".lumenflow.toml"));
    }

    #[test]
    fn test_invalid_network_error_message_lists_valid_values() {
        let e = ConfigError::InvalidNetwork { value: "wrongnet".into() };
        let msg = e.to_string();
        assert!(msg.contains("testnet"));
        assert!(msg.contains("mainnet"));
        assert!(msg.contains("local"));
    }

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp = ".test_lumenflow_269.toml";
        fs::write(temp, "network = \"testnet\"\ncontract_id = \"C999\"\nsource_account = \"S999\"")?;
        let config = load_config(Some(PathBuf::from(temp)))?;
        assert_eq!(config.network.unwrap(), "testnet");
        assert_eq!(config.contract_id.unwrap(), "C999");
        fs::remove_file(temp)?;
        Ok(())
    }

    #[test]
    fn test_load_config_missing_file_gives_defaults() -> Result<()> {
        let config = load_config(Some(PathBuf::from(".nonexistent_config_xyz.toml")))?;
        assert!(config.network.is_none());
        assert!(config.contract_id.is_none());
        Ok(())
    }
}
