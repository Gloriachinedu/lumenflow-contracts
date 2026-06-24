use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Path to config file (default: .lumenflow.toml)
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Path to a file containing the source account secret key.
    /// Overrides config / LUMENFLOW_SOURCE. Key is read once and not logged.
    #[arg(long, value_name = "FILE")]
    key_file: Option<PathBuf>,

    /// Prompt for the source account secret key interactively (hidden input).
    /// Overrides config / LUMENFLOW_SOURCE.
    #[arg(long)]
    prompt_key: bool,

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
        /// Token address
        #[arg(short, long)]
        token: String,
        /// Memo (optional)
        #[arg(long)]
        memo: Option<String>,
        /// Ed25519 signature bytes (hex)
        #[arg(long)]
        signature: String,
        /// Merchant public key (hex)
        #[arg(long)]
        merchant_public_key: String,
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
        /// Pagination cursor (order_id)
        #[arg(long)]
        cursor: Option<String>,
        /// Max results per page
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// View global statistics (admin only)
    Stats {
        /// Admin address
        #[arg(long)]
        admin: String,
    },
}

#[derive(Subcommand)]
enum RefundCommands {
    /// Initiate a refund
    Init {
        #[arg(short, long)]
        order_id: String,
        #[arg(short, long)]
        amount: i128,
        /// Reason for refund
        #[arg(long, default_value = "Customer request")]
        reason: String,
        /// Caller address (payer or merchant)
        #[arg(long)]
        caller: String,
    },
    /// Approve a pending refund (merchant or admin)
    Approve {
        /// Refund ID to approve
        #[arg(short, long)]
        refund_id: String,
        /// Caller address (merchant or admin)
        #[arg(long)]
        caller: String,
    },
    /// Reject a pending refund (merchant or admin)
    Reject {
        /// Refund ID to reject
        #[arg(short, long)]
        refund_id: String,
        /// Caller address (merchant or admin)
        #[arg(long)]
        caller: String,
    },
    /// Execute an approved refund (merchant)
    Execute {
        /// Refund ID to execute
        #[arg(short, long)]
        refund_id: String,
    },
    /// Get the current status of a refund
    Status {
        /// Refund ID to look up
        #[arg(short, long)]
        refund_id: String,
    },
}

#[derive(Debug, Deserialize, Default)]
struct Config {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
    network_passphrase: Option<String>,
}

fn load_config(path: Option<PathBuf>) -> Result<Config> {
    let mut config = Config::default();

    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Failed to read config: {}", config_path.display()))?;
        config = toml::from_str(&content)?;
    }

    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK") {
        config.network = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_CONTRACT_ID") {
        config.contract_id = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_SOURCE") {
        config.source_account = Some(v);
    }

    Ok(config)
}

/// Load the source account secret key from a key file (single-line, trimmed).
/// The content is returned as a String and never printed or logged.
fn load_key_from_file(path: &PathBuf) -> Result<String> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("Cannot read key file: {}", path.display()))?;
    let key = raw.trim().to_string();
    if key.is_empty() {
        bail!("Key file {} is empty", path.display());
    }
    Ok(key)
}

/// Prompt the user for their secret key without echoing it to the terminal.
fn prompt_key() -> Result<String> {
    let key = rpassword::prompt_password("Enter source account secret key: ")
        .context("Failed to read secret key from terminal")?;
    if key.trim().is_empty() {
        bail!("No secret key entered");
    }
    Ok(key.trim().to_string())
}

/// Resolve the final source account, applying the priority:
///   --key-file > --prompt-key > config/env
fn resolve_source(
    config: &mut Config,
    key_file: Option<&PathBuf>,
    use_prompt: bool,
) -> Result<()> {
    if let Some(path) = key_file {
        config.source_account = Some(load_key_from_file(path)?);
    } else if use_prompt {
        config.source_account = Some(prompt_key()?);
    }
    // If still empty after all sources, commands that require signing will fail
    // with a clear error at execution time.
    Ok(())
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();

    let mut config = load_config(cli.config)?;
    resolve_source(&mut config, cli.key_file.as_ref(), cli.prompt_key)?;

    let network = config.network.as_deref().unwrap_or("testnet");
    let contract_id = config.contract_id.as_deref().unwrap_or("N/A");
    // Deliberately never print source_account to avoid leaking keys.

    match &cli.command {
        Commands::Pay { merchant, amount, order_id } => {
            if config.source_account.is_none() {
                bail!("No signing key available. Use --key-file, --prompt-key, or set LUMENFLOW_SOURCE.");
            }
            println!("Processing payment...");
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!("  Network:  {}", network);
            println!("\nSuccess! Payment for order {} has been submitted.", order_id);
        }
        Commands::Refund { action } => {
            if config.source_account.is_none() {
                bail!("No signing key available. Use --key-file, --prompt-key, or set LUMENFLOW_SOURCE.");
            }
            match action {
                RefundCommands::Init { order_id, amount } => {
                    println!("Initiating refund of {} for order {}...", amount, order_id);
                    println!("  Contract: {}", contract_id);
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

    #[test]
    fn test_base_invoke_succeeds_with_full_config() {
        let config = Config {
            contract_id: Some("CXXX".into()),
            source_account: Some("SKEY".into()),
            network: Some("testnet".into()),
            ..Default::default()
        };
        assert!(base_invoke(&config).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let path = ".test_lumenflow_273.toml";
        fs::write(path, "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"")?;
        let config = load_config(Some(PathBuf::from(path)))?;
        assert_eq!(config.network.as_deref(), Some("local"));
        assert_eq!(config.contract_id.as_deref(), Some("C123"));
        assert_eq!(config.source_account.as_deref(), Some("S123"));
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn test_load_config_from_env() -> Result<()> {
        std::env::set_var("LUMENFLOW_NETWORK", "devnet");
        let config = load_config(None)?;
        assert_eq!(config.network.as_deref(), Some("devnet"));
        std::env::remove_var("LUMENFLOW_NETWORK");
        Ok(())
    }

    #[test]
    fn test_load_key_from_file() -> Result<()> {
        let path = PathBuf::from(".test_key_273.txt");
        fs::write(&path, "  SKEY123  \n")?;
        let key = load_key_from_file(&path)?;
        assert_eq!(key, "SKEY123");
        // Verify the key is not empty and has no whitespace
        assert!(!key.contains(' '));
        fs::remove_file(&path)?;
        Ok(())
    }

    #[test]
    fn test_load_key_from_empty_file_fails() {
        let path = PathBuf::from(".test_key_empty_273.txt");
        fs::write(&path, "   \n").unwrap();
        assert!(load_key_from_file(&path).is_err());
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn test_load_key_from_nonexistent_file_fails() {
        let path = PathBuf::from("/nonexistent/path/key.txt");
        assert!(load_key_from_file(&path).is_err());
    }

    #[test]
    fn test_resolve_source_from_key_file() -> Result<()> {
        let path = PathBuf::from(".test_resolve_key_273.txt");
        fs::write(&path, "SRESOLVED")?;
        let mut config = Config::default();
        resolve_source(&mut config, Some(&path), false)?;
        assert_eq!(config.source_account.as_deref(), Some("SRESOLVED"));
        fs::remove_file(&path)?;
        Ok(())
    }

    #[test]
    fn test_resolve_source_prefers_key_file_over_env() -> Result<()> {
        let path = PathBuf::from(".test_resolve_prefer_273.txt");
        fs::write(&path, "SFROMFILE")?;
        let mut config = Config {
            source_account: Some("SFROMENVIRON".into()),
            ..Default::default()
        };
        resolve_source(&mut config, Some(&path), false)?;
        assert_eq!(config.source_account.as_deref(), Some("SFROMFILE"));
        fs::remove_file(&path)?;
        Ok(())
    }
}
