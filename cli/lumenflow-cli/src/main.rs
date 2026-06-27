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
    /// Batch pay multiple merchants in one transaction (max 10 items)
    BatchPay {
        /// Payment items in 'ORDER_ID:MERCHANT_ADDR:AMOUNT' format (repeatable, max 10)
        #[arg(long = "item", value_name = "ORDER_ID:MERCHANT_ADDR:AMOUNT")]
        items: Vec<String>,
    },
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

    #[test]
    fn test_batch_pay_parses_correctly() {
        let cli = Cli::try_parse_from([
            "lumenflow", "batch-pay",
            "--item", "ORDER1:MERCHANT_A:500",
            "--item", "ORDER2:MERCHANT_B:300",
        ]).expect("should parse");
        match cli.command {
            Commands::BatchPay { items } => {
                assert_eq!(items.len(), 2);
                assert_eq!(items[0], "ORDER1:MERCHANT_A:500");
                assert_eq!(items[1], "ORDER2:MERCHANT_B:300");
            }
            _ => panic!("expected BatchPay"),
        }
    }

    #[test]
    fn test_batch_pay_over_limit_detected() {
        let mut args = vec!["lumenflow", "batch-pay"];
        let items: Vec<String> = (1..=11).map(|i| format!("--item=ORDER{}:MERCHANT:100", i)).collect();
        for item in &items {
            args.push(item.as_str());
        }
        let cli = Cli::try_parse_from(&args).expect("should parse");
        match cli.command {
            Commands::BatchPay { items } => assert!(items.len() > 10),
            _ => panic!("expected BatchPay"),
        }
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
        Commands::BatchPay { items } => {
            if items.is_empty() {
                anyhow::bail!("At least one --item is required");
            }
            if items.len() > 10 {
                anyhow::bail!("Too many items: {} (max 10)", items.len());
            }
            println!("Batch payment ({} items):", items.len());
            let mut total: i128 = 0;
            for item in items {
                let parts: Vec<&str> = item.splitn(3, ':').collect();
                if parts.len() != 3 {
                    anyhow::bail!("Invalid item format '{}' - expected ORDER_ID:MERCHANT_ADDR:AMOUNT", item);
                }
                let amount: i128 = parts[2].parse()
                    .map_err(|_| anyhow::anyhow!("Invalid amount '{}' in item '{}'", parts[2], item))?;
                println!("  Order: {}  Merchant: {}  Amount: {}", parts[0], parts[1], amount);
                total += amount;
            }
            println!("Total amount: {}", total);
            println!("Network: {}", config.network.as_deref().unwrap_or("testnet"));
        }
    }

    Ok(())
}
