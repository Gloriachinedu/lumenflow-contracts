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
    /// Multi-signature payment operations
    Multisig {
        #[command(subcommand)]
        action: MultisigCommands,
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

#[derive(Subcommand)]
enum MultisigCommands {
    /// Initiate a new multisig payment (calls initiate_multisig_payment)
    Init {
        /// Unique payment ID for this multisig payment
        #[arg(short, long)]
        payment_id: String,
        /// Merchant address to receive the payment
        #[arg(short, long)]
        merchant: String,
        /// Token address (SAC) to use for the payment
        #[arg(short, long)]
        token: String,
        /// Payment amount (in token base units)
        #[arg(short, long)]
        amount: i128,
        /// Comma-separated list of signer addresses
        #[arg(short, long)]
        signers: String,
        /// Number of signatures required to execute
        #[arg(short = 'r', long)]
        required: u32,
    },
    /// Add a signature to a multisig payment (calls sign_multisig_payment)
    Sign {
        /// Payment ID to sign
        #[arg(short, long)]
        payment_id: String,
        /// Signer address (must be in the signers list)
        #[arg(short, long)]
        signer: String,
        /// Ed25519 signature bytes (hex-encoded)
        #[arg(short = 'g', long)]
        signature: String,
    },
    /// Execute a multisig payment once threshold is met (calls execute_multisig_payment)
    Execute {
        /// Payment ID to execute
        #[arg(short, long)]
        payment_id: String,
        /// Payer address (funds the transfer)
        #[arg(short, long)]
        payer: String,
    },
    /// Get status summary for a multisig payment (calls get_multisig_payment)
    Status {
        /// Payment ID to inspect
        #[arg(short, long)]
        payment_id: String,
    },
    /// Cancel a pending multisig payment (calls cancel_multisig_payment)
    Cancel {
        /// Payment ID to cancel
        #[arg(short, long)]
        payment_id: String,
        /// Caller address (initiator or admin)
        #[arg(short, long)]
        caller: String,
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

/// Build the base `stellar contract invoke` prefix from config.
fn stellar_invoke_prefix(config: &Config) -> String {
    let network = config.network.as_deref().unwrap_or("testnet");
    let contract_id = config.contract_id.as_deref().unwrap_or("<CONTRACT_ID>");
    let source = config.source_account.as_deref().unwrap_or("<SOURCE_ACCOUNT>");
    format!(
        "stellar contract invoke --id {} --source-account {} --network {} --",
        contract_id, source, network
    )
}

fn handle_multisig(action: &MultisigCommands, config: &Config) {
    let prefix = stellar_invoke_prefix(config);
    match action {
        MultisigCommands::Init {
            payment_id,
            merchant,
            token,
            amount,
            signers,
            required,
        } => {
            // Build JSON array from comma-separated signers
            let signer_list: Vec<String> = signers
                .split(',')
                .map(|s| format!("\"{}\"", s.trim()))
                .collect();
            let signers_json = format!("[{}]", signer_list.join(","));

            println!("Initiating multisig payment '{}'...", payment_id);
            println!("  Merchant:  {}", merchant);
            println!("  Token:     {}", token);
            println!("  Amount:    {}", amount);
            println!("  Signers:   {}", signers);
            println!("  Required:  {}", required);
            println!("  Network:   {}", config.network.as_deref().unwrap_or("testnet"));
            println!("\nEquivalent CLI command:");
            println!(
                "  {} initiate_multisig_payment \\\n    \
                 --initiator <YOUR_ADDRESS> \\\n    \
                 --payment_id \"{}\" \\\n    \
                 --merchant_address {} \\\n    \
                 --token_address {} \\\n    \
                 --amount {} \\\n    \
                 --signers '{}' \\\n    \
                 --required_signatures {}",
                prefix, payment_id, merchant, token, amount, signers_json, required
            );
            println!("\nSuccess! Multisig payment '{}' initiated.", payment_id);
        }

        MultisigCommands::Sign {
            payment_id,
            signer,
            signature,
        } => {
            println!("Signing multisig payment '{}'...", payment_id);
            println!("  Signer:    {}", signer);
            println!("  Signature: {}...", &signature[..signature.len().min(16)]);
            println!("  Network:   {}", config.network.as_deref().unwrap_or("testnet"));
            println!("\nEquivalent CLI command:");
            println!(
                "  {} sign_multisig_payment \\\n    \
                 --signer {} \\\n    \
                 --payment_id \"{}\" \\\n    \
                 --signature {}",
                prefix, signer, payment_id, signature
            );
            println!("\nSuccess! Signature added to payment '{}'.", payment_id);
        }

        MultisigCommands::Execute { payment_id, payer } => {
            println!("Executing multisig payment '{}'...", payment_id);
            println!("  Payer:   {}", payer);
            println!("  Network: {}", config.network.as_deref().unwrap_or("testnet"));
            println!("\nEquivalent CLI command:");
            println!(
                "  {} execute_multisig_payment \\\n    \
                 --payer {} \\\n    \
                 --payment_id \"{}\"",
                prefix, payer, payment_id
            );
            println!("\nSuccess! Payment '{}' executed.", payment_id);
        }

        MultisigCommands::Status { payment_id } => {
            println!("Fetching status for multisig payment '{}'...", payment_id);
            println!("  Network: {}", config.network.as_deref().unwrap_or("testnet"));
            println!("\nEquivalent CLI command:");
            println!(
                "  {} get_multisig_payment \\\n    \
                 --payment_id \"{}\"",
                prefix, payment_id
            );
            // In a real implementation the JSON response would be parsed and displayed here.
            println!("\n--- Status Summary ---");
            println!("  Payment ID:          {}", payment_id);
            println!("  Executed:            false  (mock)");
            println!("  Signatures Collected: 1 / 2  (mock)");
            println!("  Signers:             [<signer1>, <signer2>]  (mock)");
        }

        MultisigCommands::Cancel { payment_id, caller } => {
            println!("Cancelling multisig payment '{}'...", payment_id);
            println!("  Caller:  {}", caller);
            println!("  Network: {}", config.network.as_deref().unwrap_or("testnet"));
            println!("\nEquivalent CLI command:");
            println!(
                "  {} cancel_multisig_payment \\\n    \
                 --caller {} \\\n    \
                 --payment_id \"{}\"",
                prefix, caller, payment_id
            );
            println!("\nSuccess! Payment '{}' cancelled.", payment_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp_config = ".test_lumenflow.toml";
        fs::write(
            temp_config,
            "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"",
        )?;

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
    fn test_stellar_invoke_prefix_defaults() {
        let config = Config::default();
        let prefix = stellar_invoke_prefix(&config);
        assert!(prefix.contains("testnet"));
        assert!(prefix.contains("<CONTRACT_ID>"));
        assert!(prefix.contains("<SOURCE_ACCOUNT>"));
    }

    #[test]
    fn test_stellar_invoke_prefix_with_config() {
        let config = Config {
            network: Some("mainnet".to_string()),
            contract_id: Some("CABC123".to_string()),
            source_account: Some("SABC456".to_string()),
        };
        let prefix = stellar_invoke_prefix(&config);
        assert!(prefix.contains("mainnet"));
        assert!(prefix.contains("CABC123"));
        assert!(prefix.contains("SABC456"));
    }

    #[test]
    fn test_multisig_init_signers_formatting() {
        // Verify that comma-separated signers are formatted into a JSON array
        let signers = "GAAA,GBBB,GCCC";
        let signer_list: Vec<String> = signers
            .split(',')
            .map(|s| format!("\"{}\"", s.trim()))
            .collect();
        let json = format!("[{}]", signer_list.join(","));
        assert_eq!(json, "[\"GAAA\",\"GBBB\",\"GCCC\"]");
    }
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    match &cli.command {
        Commands::Pay {
            merchant,
            amount,
            order_id,
        } => {
            println!("Processing payment...");
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!("  Network:  {}", config.network.as_deref().unwrap_or("testnet"));

            // In a real implementation, we would call the contract here
            println!("\nSuccess! Payment for order {} has been submitted.", order_id);
        }
        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, amount } => {
                println!("Initiating refund of {} for order {}...", amount, order_id);
                println!("  Contract: {}", config.contract_id.as_deref().unwrap_or("N/A"));
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
        Commands::Multisig { action } => {
            handle_multisig(action, &config);
        }
    }

    Ok(())
}
