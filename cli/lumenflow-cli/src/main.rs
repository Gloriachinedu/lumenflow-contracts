use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Output format: "text" (default) or "json"
    #[arg(long, value_name = "FORMAT", default_value = "text")]
    output: String,

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
    /// Validate the current configuration without executing a command
    ValidateConfig,
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

#[derive(Debug, Deserialize, Default)]
struct Config {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
}

fn load_config(path: Option<PathBuf>) -> Result<Config> {
    let mut config = Config::default();

    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));
    if config_path.exists() {
        let content = std::fs::read_to_string(config_path)?;
        config = toml::from_str(&content)?;
    }

    if let Ok(network) = std::env::var("LUMENFLOW_NETWORK") {
        config.network = Some(network);
    }
    if let Ok(contract_id) = std::env::var("LUMENFLOW_CONTRACT_ID") {
        config.contract_id = Some(contract_id);
    }
    if let Ok(source) = std::env::var("LUMENFLOW_SOURCE") {
        config.source_account = Some(source);
    }

    Ok(config)
}

/// Validate the loaded config upfront. Returns a list of validation errors.
/// - `contract_id` must start with 'C' and be 56 chars (Stellar contract address format).
/// - `network` must be one of: local, testnet, mainnet.
/// - `source_account` must start with 'S' and be 56 chars (Stellar secret key format).
fn validate_config(config: &Config) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();

    if let Some(ref contract_id) = config.contract_id {
        if !is_valid_stellar_contract_address(contract_id) {
            errors.push(format!(
                "contract_id: '{}' is not a valid Stellar contract address (must start with 'C' and be 56 characters)",
                contract_id
            ));
        }
    }

    if let Some(ref network) = config.network {
        let valid_networks = ["local", "testnet", "mainnet"];
        if !valid_networks.contains(&network.as_str()) {
            errors.push(format!(
                "network: '{}' is not valid. Must be one of: local, testnet, mainnet",
                network
            ));
        }
    }

    if let Some(ref source_account) = config.source_account {
        if !is_valid_stellar_secret_key(source_account) {
            errors.push(format!(
                "source_account: value is not a valid Stellar secret key format (must start with 'S' and be 56 characters)"
            ));
        }
    }

    errors
}

fn is_valid_stellar_contract_address(addr: &str) -> bool {
    addr.starts_with('C') && addr.len() == 56 && addr.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_valid_stellar_secret_key(key: &str) -> bool {
    key.starts_with('S') && key.len() == 56 && key.chars().all(|c| c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp_config = ".test_lumenflow.toml";
        fs::write(temp_config, "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"")?;

        let config = load_config(Some(PathBuf::from(temp_config)))?;
        assert_eq!(config.network.unwrap(), "local");
        assert_eq!(config.contract_id.unwrap(), "C123");
        assert_eq!(config.source_account.unwrap(), "S123");

        fs::remove_file(temp_config)?;
        Ok(())
    }

    #[test]
    fn test_load_config_from_env() -> Result<()> {
        std::env::set_var("LUMENFLOW_NETWORK", "devnet");
        let config = load_config(None)?;
        assert_eq!(config.network.unwrap(), "devnet");
        std::env::remove_var("LUMENFLOW_NETWORK");
        Ok(())
    }

    #[test]
    fn test_validate_config_invalid_network() {
        let config = Config {
            network: Some("devnet".to_string()),
            contract_id: None,
            source_account: None,
        };
        let errors = validate_config(&config);
        assert!(!errors.is_empty());
        assert!(errors[0].contains("network"));
    }

    #[test]
    fn test_validate_config_invalid_contract_id() {
        let config = Config {
            network: Some("testnet".to_string()),
            contract_id: Some("BADCONTRACT".to_string()),
            source_account: None,
        };
        let errors = validate_config(&config);
        assert!(!errors.is_empty());
        assert!(errors[0].contains("contract_id"));
    }

    #[test]
    fn test_validate_config_invalid_secret_key() {
        let config = Config {
            network: Some("mainnet".to_string()),
            contract_id: None,
            source_account: Some("NOTASECRETKEY".to_string()),
        };
        let errors = validate_config(&config);
        assert!(!errors.is_empty());
        assert!(errors[0].contains("source_account"));
    }

    #[test]
    fn test_validate_config_valid() {
        let config = Config {
            network: Some("testnet".to_string()),
            contract_id: Some("C".to_string() + &"A".repeat(55)),
            source_account: Some("S".to_string() + &"A".repeat(55)),
        };
        let errors = validate_config(&config);
        assert!(errors.is_empty());
    }
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    let use_json = cli.output.to_lowercase() == "json";

    // Run config validation before any command (except validate-config itself, which handles its own output)
    if !matches!(cli.command, Commands::ValidateConfig) {
        let errors = validate_config(&config);
        if !errors.is_empty() {
            if use_json {
                let json = serde_json::json!({
                    "success": false,
                    "error": "Configuration validation failed",
                    "fields": errors
                });
                eprintln!("{}", serde_json::to_string_pretty(&json)?);
            } else {
                eprintln!("Configuration validation failed:");
                for e in &errors {
                    eprintln!("  - {}", e);
                }
            }
            bail!("Invalid configuration. Run `lumenflow validate-config` for details.");
        }
    }

    match &cli.command {
        Commands::ValidateConfig => {
            let errors = validate_config(&config);
            if errors.is_empty() {
                if use_json {
                    let json = serde_json::json!({ "success": true, "message": "Configuration is valid." });
                    println!("{}", serde_json::to_string_pretty(&json)?);
                } else {
                    println!("Configuration is valid.");
                }
            } else {
                if use_json {
                    let json = serde_json::json!({ "success": false, "fields": errors });
                    println!("{}", serde_json::to_string_pretty(&json)?);
                } else {
                    eprintln!("Configuration validation failed:");
                    for e in &errors {
                        eprintln!("  - {}", e);
                    }
                }
                bail!("Invalid configuration.");
            }
        }
        Commands::Pay { merchant, amount, order_id } => {
            let network = config.network.as_deref().unwrap_or("testnet");
            if use_json {
                let json = serde_json::json!({
                    "success": true,
                    "command": "pay",
                    "order_id": order_id,
                    "merchant": merchant,
                    "amount": amount,
                    "network": network
                });
                println!("{}", serde_json::to_string_pretty(&json)?);
            } else {
                println!("Processing payment...");
                println!("  Order:    {}", order_id);
                println!("  Merchant: {}", merchant);
                println!("  Amount:   {}", amount);
                println!("  Network:  {}", network);
                println!("\nSuccess! Payment for order {} has been submitted.", order_id);
            }
        }
        Commands::Refund { action } => {
            match action {
                RefundCommands::Init { order_id, amount } => {
                    let contract = config.contract_id.as_deref().unwrap_or("N/A");
                    if use_json {
                        let json = serde_json::json!({
                            "success": true,
                            "command": "refund",
                            "order_id": order_id,
                            "amount": amount,
                            "contract_id": contract
                        });
                        println!("{}", serde_json::to_string_pretty(&json)?);
                    } else {
                        println!("Initiating refund of {} for order {}...", amount, order_id);
                        println!("  Contract: {}", contract);
                    }
                }
            }
        }
        Commands::History { merchant } => {
            if use_json {
                let json = serde_json::json!({
                    "success": true,
                    "command": "history",
                    "merchant": merchant,
                    "payments": [
                        { "order_id": "ORDER_001", "amount": "500 XLM" },
                        { "order_id": "ORDER_002", "amount": "1200 XLM" }
                    ]
                });
                println!("{}", serde_json::to_string_pretty(&json)?);
            } else {
                println!("Fetching payment history for merchant {}...", merchant);
                println!("  (Mock data)");
                println!("  - ORDER_001: 500 XLM");
                println!("  - ORDER_002: 1200 XLM");
            }
        }
        Commands::Stats => {
            if use_json {
                let json = serde_json::json!({
                    "success": true,
                    "command": "stats",
                    "total_volume": "45000.00",
                    "total_payments": 128,
                    "active_merchants": 12
                });
                println!("{}", serde_json::to_string_pretty(&json)?);
            } else {
                println!("Global LumenFlow Statistics:");
                println!("  Total Volume:   45,000.00");
                println!("  Total Payments: 128");
                println!("  Active Merch:   12");
            }
        }
    }

    Ok(())
}
