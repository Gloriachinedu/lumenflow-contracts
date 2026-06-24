use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;

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
        /// Merchant address
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
        /// Order ID to refund
        #[arg(short, long)]
        order_id: String,
        /// Unique refund ID
        #[arg(short, long)]
        refund_id: String,
        /// Amount to refund
        #[arg(short, long)]
        amount: i128,
        /// Reason for refund
        #[arg(long, default_value = "Customer request")]
        reason: String,
        /// Caller address (payer or merchant)
        #[arg(long)]
        caller: String,
    },
    /// Approve a refund
    Approve {
        /// Refund ID to approve
        #[arg(short, long)]
        refund_id: String,
        /// Caller address (merchant or admin)
        #[arg(long)]
        caller: String,
    },
    /// Reject a refund
    Reject {
        /// Refund ID to reject
        #[arg(short, long)]
        refund_id: String,
        /// Caller address (merchant or admin)
        #[arg(long)]
        caller: String,
    },
    /// Execute an approved refund
    Execute {
        /// Refund ID to execute
        #[arg(short, long)]
        refund_id: String,
    },
    /// Get refund status
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
            .with_context(|| format!("Failed to read config file: {}", config_path.display()))?;
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
    if let Ok(v) = std::env::var("LUMENFLOW_RPC_URL") {
        config.rpc_url = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK_PASSPHRASE") {
        config.network_passphrase = Some(v);
    }

    Ok(config)
}

/// Build a base `stellar contract invoke` command with required flags.
fn base_invoke(config: &Config) -> Result<Command> {
    let contract_id = config
        .contract_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .context("Missing contract ID. Set LUMENFLOW_CONTRACT_ID or contract_id in .lumenflow.toml")?;

    let source = config
        .source_account
        .as_deref()
        .filter(|s| !s.is_empty())
        .context("Missing source account. Set LUMENFLOW_SOURCE or source_account in .lumenflow.toml")?;

    let mut cmd = Command::new("stellar");
    cmd.args(["contract", "invoke", "--id", contract_id, "--source-account", source]);

    if let Some(rpc) = config.rpc_url.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--rpc-url", rpc]);
    }

    if let Some(passphrase) = config.network_passphrase.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--network-passphrase", passphrase]);
    } else if let Some(network) = config.network.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--network", network]);
    } else {
        cmd.args(["--network", "testnet"]);
    }

    Ok(cmd)
}

/// Run a command and print its output, returning an error on non-zero exit.
fn run(mut cmd: Command) -> Result<()> {
    let status = cmd.status().context("Failed to execute stellar CLI. Is it installed?")?;
    if !status.success() {
        bail!("stellar CLI exited with status {}", status);
    }
    Ok(())
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    match &cli.command {
        Commands::Pay { merchant, amount, order_id, token, memo, signature, merchant_public_key } => {
            let mut cmd = base_invoke(&config)?;
            cmd.args([
                "--",
                "process_payment_with_signature",
                "--payer", config.source_account.as_deref().unwrap(),
                "--order_id", order_id,
                "--merchant_address", merchant,
                "--token_address", token,
                "--amount", &amount.to_string(),
                "--memo", memo.as_deref().unwrap_or(""),
                "--signature", signature,
                "--merchant_public_key", merchant_public_key,
            ]);
            println!("Submitting payment for order {} ...", order_id);
            run(cmd)?;
            println!("Payment submitted successfully.");
        }

        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, refund_id, amount, reason, caller } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args([
                    "--", "initiate_refund",
                    "--caller", caller,
                    "--refund_id", refund_id,
                    "--order_id", order_id,
                    "--amount", &amount.to_string(),
                    "--reason", reason,
                ]);
                println!("Initiating refund {} for order {} ...", refund_id, order_id);
                run(cmd)?;
                println!("Refund initiated.");
            }
            RefundCommands::Approve { refund_id, caller } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args(["--", "approve_refund", "--caller", caller, "--refund_id", refund_id]);
                println!("Approving refund {} ...", refund_id);
                run(cmd)?;
                println!("Refund approved.");
            }
            RefundCommands::Reject { refund_id, caller } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args(["--", "reject_refund", "--caller", caller, "--refund_id", refund_id]);
                println!("Rejecting refund {} ...", refund_id);
                run(cmd)?;
                println!("Refund rejected.");
            }
            RefundCommands::Execute { refund_id } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args(["--", "execute_refund", "--refund_id", refund_id]);
                println!("Executing refund {} ...", refund_id);
                run(cmd)?;
                println!("Refund executed.");
            }
            RefundCommands::Status { refund_id } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args(["--", "get_refund", "--refund_id", refund_id]);
                run(cmd)?;
            }
        },

        Commands::History { merchant, cursor, limit } => {
            let mut cmd = base_invoke(&config)?;
            cmd.args([
                "--", "get_merchant_payment_history",
                "--merchant", merchant,
                "--cursor", cursor.as_deref().unwrap_or("null"),
                "--limit", &limit.to_string(),
                "--filter", "null",
                "--sort_field", "Date",
                "--sort_order", "Descending",
            ]);
            run(cmd)?;
        }

        Commands::Stats { admin } => {
            let mut cmd = base_invoke(&config)?;
            cmd.args([
                "--", "get_global_payment_stats",
                "--admin", admin,
                "--date_start", "null",
                "--date_end", "null",
            ]);
            run(cmd)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp_config = ".test_lumenflow_265.toml";
        fs::write(
            temp_config,
            "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"",
        )?;
        let config = load_config(Some(PathBuf::from(temp_config)))?;
        assert_eq!(config.network.as_deref(), Some("local"));
        assert_eq!(config.contract_id.as_deref(), Some("C123"));
        assert_eq!(config.source_account.as_deref(), Some("S123"));
        fs::remove_file(temp_config)?;
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
    fn test_base_invoke_fails_without_contract_id() {
        let config = Config {
            contract_id: None,
            source_account: Some("SKEY".into()),
            ..Default::default()
        };
        assert!(base_invoke(&config).is_err());
    }

    #[test]
    fn test_base_invoke_fails_without_source_account() {
        let config = Config {
            contract_id: Some("CXXX".into()),
            source_account: None,
            ..Default::default()
        };
        assert!(base_invoke(&config).is_err());
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
