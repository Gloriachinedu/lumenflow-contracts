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
    /// Merchant management operations
    Merchant {
        #[command(subcommand)]
        action: MerchantCommands,
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
enum MerchantCommands {
    /// Update a merchant profile
    Update {
        /// Merchant address to update
        #[arg(long)]
        address: String,
        /// New merchant name
        #[arg(long)]
        name: Option<String>,
        /// New merchant description
        #[arg(long)]
        description: Option<String>,
        /// New merchant contact information
        #[arg(long)]
        contact_info: Option<String>,
        /// New merchant category
        #[arg(long)]
        category: Option<String>,
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
    fn test_merchant_update_parses_optional_fields() {
        let cli = Cli::try_parse_from([
            "lumenflow",
            "merchant",
            "update",
            "--address",
            "GTEST123",
            "--name",
            "New Name",
            "--description",
            "Updated description",
            "--contact-info",
            "updated@example.com",
            "--category",
            "retail",
        ])
        .expect("merchant update should parse required options");

        match cli.command {
            Commands::Merchant { action } => match action {
                MerchantCommands::Update {
                    address,
                    name,
                    description,
                    contact_info,
                    category,
                } => {
                    assert_eq!(address, "GTEST123");
                    assert_eq!(name.as_deref(), Some("New Name"));
                    assert_eq!(description.as_deref(), Some("Updated description"));
                    assert_eq!(contact_info.as_deref(), Some("updated@example.com"));
                    assert_eq!(category.as_deref(), Some("retail"));
                }
            },
            _ => panic!("expected merchant action"),
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
        Commands::Merchant { action } => match action {
            MerchantCommands::Update {
                address,
                name,
                description,
                contact_info,
                category,
            } => {
                println!("Updating merchant profile for {}...", address);
                println!("  Contract: {}", config.contract_id.as_deref().unwrap_or("N/A"));

                if let Some(value) = name {
                    println!("  Name: {}", value);
                }
                if let Some(value) = description {
                    println!("  Description: {}", value);
                }
                if let Some(value) = contact_info {
                    println!("  Contact Info: {}", value);
                }
                if let Some(value) = category {
                    println!("  Category: {}", value);
                }

                println!("\nSuccess! Merchant profile updated for {}.", address);
            }
        },
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
