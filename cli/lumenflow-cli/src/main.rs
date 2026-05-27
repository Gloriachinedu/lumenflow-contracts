use anyhow::Result;
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

    // 1. Try to load from file
    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));
    if config_path.exists() {
        let content = std::fs::read_to_string(config_path)?;
        config = toml::from_str(&content)?;
    }

    // 2. Override with environment variables
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
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    match &cli.command {
        Commands::Pay { merchant, amount, order_id } => {
            println!("Processing payment...");
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!("  Network:  {}", config.network.as_deref().unwrap_or("testnet"));
            
            // In a real implementation, we would call the contract here
            println!("\nSuccess! Payment for order {} has been submitted.", order_id);
        }
        Commands::Refund { action } => {
            match action {
                RefundCommands::Init { order_id, amount } => {
                    println!("Initiating refund of {} for order {}...", amount, order_id);
                    println!("  Contract: {}", config.contract_id.as_deref().unwrap_or("N/A"));
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
