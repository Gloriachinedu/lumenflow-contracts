use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;

// ── CLI definition ────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Config file path (default: .lumenflow.toml)
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    // ── CLI-level overrides (highest priority) ────────────────────────────
    /// Named network preset: local | testnet | mainnet
    #[arg(long, value_name = "NETWORK")]
    network: Option<String>,

    /// Soroban RPC URL
    #[arg(long, value_name = "URL")]
    rpc_url: Option<String>,

    /// Network passphrase
    #[arg(long, value_name = "PASSPHRASE")]
    network_passphrase: Option<String>,

    /// Contract ID
    #[arg(long, value_name = "CONTRACT_ID")]
    contract_id: Option<String>,

    /// Source account secret key
    #[arg(long, value_name = "SECRET")]
    source_account: Option<String>,

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
    /// Print the resolved configuration (useful for debugging)
    PrintConfig,
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

// ── Config model ──────────────────────────────────────────────────────────────

/// Raw config as stored in `.lumenflow.toml` or environment variables.
#[derive(Debug, Deserialize, Default, Clone)]
struct RawConfig {
    network: Option<String>,
    rpc_url: Option<String>,
    network_passphrase: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
}

/// Fully-resolved config after merging all sources.
/// Priority (highest → lowest): CLI flags > env vars > TOML file > defaults.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub network: String,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub contract_id: String,
    pub source_account: Option<String>,
}

/// Named network presets.
fn network_preset(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "local" => Some((
            "http://localhost:8000/soroban/rpc",
            "Standalone Network ; February 2017",
        )),
        "testnet" => Some((
            "https://soroban-testnet.stellar.org",
            "Test SDF Network ; September 2015",
        )),
        "mainnet" => Some((
            "https://soroban-mainnet.stellar.org",
            "Public Global Stellar Network ; September 2015",
        )),
        _ => None,
    }
}

// ── Config loading ────────────────────────────────────────────────────────────

/// Load config from TOML file (lowest priority).
fn load_file_config(path: Option<&PathBuf>) -> Result<RawConfig> {
    let config_path = path
        .cloned()
        .unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));

    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        Ok(toml::from_str(&content)?)
    } else {
        Ok(RawConfig::default())
    }
}

/// Layer environment variables over a base config.
fn apply_env_overrides(base: RawConfig) -> RawConfig {
    RawConfig {
        network: std::env::var("LUMENFLOW_NETWORK").ok().or(base.network),
        rpc_url: std::env::var("LUMENFLOW_RPC_URL").ok().or(base.rpc_url),
        network_passphrase: std::env::var("LUMENFLOW_NETWORK_PASSPHRASE")
            .ok()
            .or(base.network_passphrase),
        contract_id: std::env::var("LUMENFLOW_CONTRACT_ID")
            .ok()
            .or(base.contract_id),
        source_account: std::env::var("LUMENFLOW_SOURCE")
            .ok()
            .or(base.source_account),
    }
}

/// Apply CLI flag overrides (highest priority) and resolve final config.
fn resolve_config(
    file_env: RawConfig,
    cli: &Cli,
) -> ResolvedConfig {
    let network = cli
        .network
        .clone()
        .or(file_env.network)
        .unwrap_or_else(|| "testnet".to_string());

    let preset = network_preset(&network);

    let rpc_url = cli
        .rpc_url
        .clone()
        .or(file_env.rpc_url)
        .or_else(|| preset.map(|(url, _)| url.to_string()))
        .unwrap_or_else(|| "https://soroban-testnet.stellar.org".to_string());

    let network_passphrase = cli
        .network_passphrase
        .clone()
        .or(file_env.network_passphrase)
        .or_else(|| preset.map(|(_, phrase)| phrase.to_string()))
        .unwrap_or_else(|| "Test SDF Network ; September 2015".to_string());

    let contract_id = cli
        .contract_id
        .clone()
        .or(file_env.contract_id)
        .unwrap_or_default();

    let source_account = cli.source_account.clone().or(file_env.source_account);

    ResolvedConfig {
        network,
        rpc_url,
        network_passphrase,
        contract_id,
        source_account,
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let cli = Cli::parse();

    let file_config = load_file_config(cli.config.as_ref())?;
    let file_env_config = apply_env_overrides(file_config);
    let config = resolve_config(file_env_config, &cli);

    match &cli.command {
        Commands::Pay { merchant, amount, order_id } => {
            println!("Processing payment...");
            println!("  Order:      {}", order_id);
            println!("  Merchant:   {}", merchant);
            println!("  Amount:     {}", amount);
            println!("  Network:    {}", config.network);
            println!("  RPC URL:    {}", config.rpc_url);
            println!("\nSuccess! Payment for order {} has been submitted.", order_id);
        }
        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, amount } => {
                println!("Initiating refund of {} for order {}...", amount, order_id);
                println!("  Contract:   {}", config.contract_id);
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
        Commands::PrintConfig => {
            println!("Resolved configuration:");
            println!("  network:            {}", config.network);
            println!("  rpc_url:            {}", config.rpc_url);
            println!("  network_passphrase: {}", config.network_passphrase);
            println!("  contract_id:        {}", config.contract_id);
            println!("  source_account:     {}", config.source_account.as_deref().unwrap_or("(not set)"));
        }
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_cli(network: Option<&str>, rpc_url: Option<&str>, passphrase: Option<&str>) -> Cli {
        Cli {
            config: None,
            network: network.map(String::from),
            rpc_url: rpc_url.map(String::from),
            network_passphrase: passphrase.map(String::from),
            contract_id: None,
            source_account: None,
            command: Commands::Stats,
        }
    }

    #[test]
    fn test_file_config_loaded() -> Result<()> {
        let path = PathBuf::from(".test_278.toml");
        fs::write(&path, "network = \"local\"\ncontract_id = \"C123\"")?;
        let cfg = load_file_config(Some(&path))?;
        assert_eq!(cfg.network.unwrap(), "local");
        assert_eq!(cfg.contract_id.unwrap(), "C123");
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn test_env_overrides_file() -> Result<()> {
        let base = RawConfig {
            network: Some("local".to_string()),
            ..Default::default()
        };
        std::env::set_var("LUMENFLOW_NETWORK", "testnet");
        let merged = apply_env_overrides(base);
        assert_eq!(merged.network.unwrap(), "testnet");
        std::env::remove_var("LUMENFLOW_NETWORK");
        Ok(())
    }

    #[test]
    fn test_cli_flags_override_env() {
        let base = RawConfig {
            network: Some("testnet".to_string()),
            ..Default::default()
        };
        let cli = make_cli(Some("mainnet"), None, None);
        let resolved = resolve_config(base, &cli);
        assert_eq!(resolved.network, "mainnet");
        // Preset should kick in for rpc_url
        assert!(resolved.rpc_url.contains("mainnet"));
    }

    #[test]
    fn test_preset_applied_for_local() {
        let cli = make_cli(Some("local"), None, None);
        let resolved = resolve_config(RawConfig::default(), &cli);
        assert_eq!(resolved.rpc_url, "http://localhost:8000/soroban/rpc");
        assert_eq!(resolved.network_passphrase, "Standalone Network ; February 2017");
    }

    #[test]
    fn test_explicit_rpc_url_overrides_preset() {
        let cli = make_cli(Some("testnet"), Some("http://custom:8080/rpc"), None);
        let resolved = resolve_config(RawConfig::default(), &cli);
        assert_eq!(resolved.rpc_url, "http://custom:8080/rpc");
    }
}
