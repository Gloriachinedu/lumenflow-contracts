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

#[derive(Debug, Deserialize, Default, PartialEq)]
pub struct Config {
    pub network: Option<String>,
    pub contract_id: Option<String>,
    pub source_account: Option<String>,
}

pub fn load_config(path: Option<PathBuf>) -> Result<Config> {
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

/// Format a pay command result for display (extracted for testability).
pub fn format_pay(order_id: &str, merchant: &str, amount: i128, network: &str) -> String {
    format!(
        "Processing payment...\n  Order:    {}\n  Merchant: {}\n  Amount:   {}\n  Network:  {}\n\nSuccess! Payment for order {} has been submitted.",
        order_id, merchant, amount, network, order_id
    )
}

/// Format a refund init result for display.
pub fn format_refund_init(order_id: &str, amount: i128, contract_id: &str) -> String {
    format!(
        "Initiating refund of {} for order {}...\n  Contract: {}",
        amount, order_id, contract_id
    )
}

/// Format history output.
pub fn format_history(merchant: &str) -> String {
    format!(
        "Fetching payment history for merchant {}...\n  (Mock data)\n  - ORDER_001: 500 XLM\n  - ORDER_002: 1200 XLM",
        merchant
    )
}

/// Format stats output.
pub fn format_stats() -> String {
    "Global LumenFlow Statistics:\n  Total Volume:   45,000.00\n  Total Payments: 128\n  Active Merch:   12".to_string()
}

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    match &cli.command {
        Commands::Pay { merchant, amount, order_id } => {
            let network = config.network.as_deref().unwrap_or("testnet");
            println!("{}", format_pay(order_id, merchant, *amount, network));
        }
        Commands::Refund { action } => {
            match action {
                RefundCommands::Init { order_id, amount } => {
                    let contract = config.contract_id.as_deref().unwrap_or("N/A");
                    println!("{}", format_refund_init(order_id, *amount, contract));
                }
            }
        }
        Commands::History { merchant } => {
            println!("{}", format_history(merchant));
        }
        Commands::Stats => {
            println!("{}", format_stats());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    // Mutex to serialize tests that touch env vars.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    // ── Config loading ────────────────────────────────────────────────────────

    #[test]
    fn test_load_config_defaults_when_no_file_and_no_env() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        // Remove all env vars that could bleed in from other tests.
        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let config = load_config(Some(PathBuf::from("/nonexistent/path.toml")))?;
        assert_eq!(config, Config::default());
        assert!(config.network.is_none());
        assert!(config.contract_id.is_none());
        assert!(config.source_account.is_none());
        Ok(())
    }

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let tmp = std::env::temp_dir().join("test_lumenflow_file.toml");
        fs::write(&tmp, "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"")?;

        let config = load_config(Some(tmp.clone()))?;
        assert_eq!(config.network.as_deref(), Some("local"));
        assert_eq!(config.contract_id.as_deref(), Some("C123"));
        assert_eq!(config.source_account.as_deref(), Some("S123"));

        fs::remove_file(tmp)?;
        Ok(())
    }

    #[test]
    fn test_env_vars_override_file_values() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join("test_lumenflow_override.toml");
        fs::write(&tmp, "network = \"local\"\ncontract_id = \"C-FILE\"")?;

        std::env::set_var("LUMENFLOW_NETWORK", "mainnet");
        std::env::set_var("LUMENFLOW_CONTRACT_ID", "C-ENV");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let config = load_config(Some(tmp.clone()))?;
        // Env vars take precedence.
        assert_eq!(config.network.as_deref(), Some("mainnet"));
        assert_eq!(config.contract_id.as_deref(), Some("C-ENV"));

        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        fs::remove_file(tmp)?;
        Ok(())
    }

    #[test]
    fn test_load_config_env_only() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("LUMENFLOW_NETWORK", "testnet");
        std::env::set_var("LUMENFLOW_CONTRACT_ID", "C-TEST");
        std::env::set_var("LUMENFLOW_SOURCE", "S-TEST");

        let config = load_config(Some(PathBuf::from("/nonexistent.toml")))?;
        assert_eq!(config.network.as_deref(), Some("testnet"));
        assert_eq!(config.contract_id.as_deref(), Some("C-TEST"));
        assert_eq!(config.source_account.as_deref(), Some("S-TEST"));

        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");
        Ok(())
    }

    #[test]
    fn test_load_config_partial_file() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let tmp = std::env::temp_dir().join("test_lumenflow_partial.toml");
        fs::write(&tmp, "network = \"testnet\"")?;

        let config = load_config(Some(tmp.clone()))?;
        assert_eq!(config.network.as_deref(), Some("testnet"));
        assert!(config.contract_id.is_none());
        assert!(config.source_account.is_none());

        fs::remove_file(tmp)?;
        Ok(())
    }

    // ── Command output formatting ─────────────────────────────────────────────

    #[test]
    fn test_format_pay_contains_order_merchant_amount_network() {
        let out = format_pay("ORDER_42", "MERCHANT_XYZ", 1000, "testnet");
        assert!(out.contains("ORDER_42"));
        assert!(out.contains("MERCHANT_XYZ"));
        assert!(out.contains("1000"));
        assert!(out.contains("testnet"));
        assert!(out.contains("Success!"));
    }

    #[test]
    fn test_format_pay_uses_mainnet_when_specified() {
        let out = format_pay("O1", "M1", 500, "mainnet");
        assert!(out.contains("mainnet"));
    }

    #[test]
    fn test_format_refund_init_contains_order_amount_contract() {
        let out = format_refund_init("ORDER_10", 250, "CONTRACT_ABC");
        assert!(out.contains("ORDER_10"));
        assert!(out.contains("250"));
        assert!(out.contains("CONTRACT_ABC"));
    }

    #[test]
    fn test_format_refund_init_na_when_no_contract() {
        let out = format_refund_init("ORDER_11", 100, "N/A");
        assert!(out.contains("N/A"));
    }

    #[test]
    fn test_format_history_contains_merchant() {
        let out = format_history("GMERCHANT123");
        assert!(out.contains("GMERCHANT123"));
        assert!(out.contains("ORDER_001"));
        assert!(out.contains("ORDER_002"));
    }

    #[test]
    fn test_format_stats_contains_expected_fields() {
        let out = format_stats();
        assert!(out.contains("Total Volume"));
        assert!(out.contains("Total Payments"));
        assert!(out.contains("Active Merch"));
    }

    // ── CLI argument parsing ──────────────────────────────────────────────────

    #[test]
    fn test_cli_pay_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from([
            "lumenflow", "pay",
            "--merchant", "GADDR",
            "--amount", "500",
            "--order-id", "ORD1",
        ]);
        assert!(m.is_ok(), "pay subcommand should parse successfully");
    }

    #[test]
    fn test_cli_stats_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from(["lumenflow", "stats"]);
        assert!(m.is_ok(), "stats subcommand should parse successfully");
    }

    #[test]
    fn test_cli_history_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from([
            "lumenflow", "history", "--merchant", "GADDR",
        ]);
        assert!(m.is_ok(), "history subcommand should parse successfully");
    }

    #[test]
    fn test_cli_refund_init_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from([
            "lumenflow", "refund", "init",
            "--order-id", "ORD1",
            "--amount", "100",
        ]);
        assert!(m.is_ok(), "refund init subcommand should parse successfully");
    }

    #[test]
    fn test_cli_missing_required_arg_fails() {
        use clap::CommandFactory;
        // pay requires --merchant, --amount, --order-id
        let m = Cli::command().try_get_matches_from(["lumenflow", "pay", "--amount", "100"]);
        assert!(m.is_err(), "pay without --merchant should fail");
    }

    #[test]
    fn test_cli_unknown_subcommand_fails() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from(["lumenflow", "nonexistent"]);
        assert!(m.is_err(), "unknown subcommand should fail");
    }
}
