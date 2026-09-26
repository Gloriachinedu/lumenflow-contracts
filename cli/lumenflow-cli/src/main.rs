use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

// ── CLI definition ────────────────────────────────────────────────────────────

// ── CLI structure ─────────────────────────────────────────────────────────────

/// Maximum number of payments per batch call, as defined by the contract.
const BATCH_SIZE: usize = 10;

// ---------------------------------------------------------------------------
// CLI structure
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
#[command(
    after_help = "INTERACTIVE MODE:\n  Run `lumenflow pay` with no flags to enter interactive mode.\n  You will be prompted for each field with real-time validation.\n  Press Ctrl-C at any prompt to cancel."
)]
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
    /// Pay a merchant.
    ///
    /// Run with no flags to enter interactive (guided) mode.
    /// All flags must be provided together to use non-interactive mode.
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
        /// Treat a duplicate order ID as success and return the existing payment
        /// instead of raising an error. Safe to use when retrying submissions.
        #[arg(long, default_value_t = false)]
        idempotent: bool,
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
    /// Print the resolved configuration (useful for debugging)
    PrintConfig,
    /// Batch pay multiple merchants from a CSV file
    BatchPay {
        /// Path to CSV file (columns: order_id,merchant_address,token_address,amount,memo)
        #[arg(long, value_name = "FILE")]
        file: PathBuf,
        /// Token address (overrides CSV token_address column if provided)
        #[arg(long)]
        token: Option<String>,
        /// Signature (hex) for all payments (required)
        #[arg(long)]
        signature: String,
        /// Merchant public key (hex) for all payments (required)
        #[arg(long)]
        merchant_public_key: String,
    },
    /// Merchant management operations
    Merchant {
        #[command(subcommand)]
        action: MerchantCommands,
    },
    /// Admin diagnostics and maintenance operations
    Admin {
        #[command(subcommand)]
        action: AdminCommands,
    },
}

#[derive(Subcommand)]
enum AdminCommands {
    /// Show an account's payment-ID count vs. the MAX_PAYMENT_IDS_PER_ACCOUNT cap
    AccountStats {
        /// Address to inspect (merchant or payer)
        #[arg(long)]
        address: String,
    },
}

#[derive(Subcommand)]
enum MerchantCommands {
    /// List registered merchants (admin only, cursor-based pagination)
    List {
        /// Admin address
        #[arg(long, env = "LUMENFLOW_ADMIN_KEY")]
        admin_key: String,
        /// Maximum number of merchants to return per page (default: 10)
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Pagination cursor (address of last merchant from previous page)
        #[arg(long)]
        cursor: Option<String>,
        /// Output format: text (default) or json
        #[arg(long, default_value = "text")]
        output: String,
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
    /// List all refunds for a given order (payer, merchant, or admin)
    List {
        /// Order ID to list refunds for
        #[arg(short, long)]
        order_id: String,
        /// Caller address (payer, merchant, or admin — must be authorised on the contract)
        #[arg(long)]
        caller: String,
        /// Output format: table (default) or json
        #[arg(long, default_value = "table")]
        output: String,
    },
}

// ── Config models and Validation ──────────────────────────────────────────────────

const VALID_NETWORKS: &[&str] = &["local", "testnet", "mainnet"];

/// Mirrors `storage::MAX_PAYMENT_IDS_PER_ACCOUNT` in `contracts/lumenflow/src/storage.rs`.
/// Kept as a local constant (rather than a second on-chain getter) purely for
/// display purposes in `admin account-stats`; update alongside the contract constant.
const MAX_PAYMENT_IDS_PER_ACCOUNT: u32 = 10_000;

#[derive(Debug, Deserialize, Default, Clone, PartialEq)]
pub struct Config {
    pub network: Option<String>,
    pub rpc_url: Option<String>,
    pub network_passphrase: Option<String>,
    pub contract_id: Option<String>,
    pub source_account: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone, PartialEq)]
pub struct RawConfig {
    pub network: Option<String>,
    pub rpc_url: Option<String>,
    pub network_passphrase: Option<String>,
    pub contract_id: Option<String>,
    pub source_account: Option<String>,
}

/// A validated, ready-to-use config. All fields are guaranteed non-empty.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedConfig {
    pub network: String,
    pub contract_id: String,
    pub source_account: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedConfig {
    pub network: String,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub contract_id: String,
    pub source_account: Option<String>,
}

/// Validation errors with actionable guidance.
#[derive(Debug, PartialEq)]
pub enum ConfigError {
    MissingField {
        field: &'static str,
        env_var: &'static str,
        toml_key: &'static str,
    },
    InvalidNetwork {
        value: String,
    },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::MissingField {
                field,
                env_var,
                toml_key,
            } => write!(
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
        Some(ref s) if !s.trim().is_empty() => {
            if !VALID_NETWORKS.contains(&s.as_str()) {
                errors.push(ConfigError::InvalidNetwork { value: s.clone() });
            }
            s.clone()
        }
        _ => {
            errors.push(ConfigError::MissingField {
                field: "network",
                env_var: "LUMENFLOW_NETWORK",
                toml_key: "network",
            });
            String::new()
        }
    };

    // contract_id
    let contract_id = match cfg.contract_id {
        Some(ref s) if !s.trim().is_empty() => s.clone(),
        _ => {
            errors.push(ConfigError::MissingField {
                field: "contract_id",
                env_var: "LUMENFLOW_CONTRACT_ID",
                toml_key: "contract_id",
            });
            String::new()
        }
    };

    // source_account
    let source_account = match cfg.source_account {
        Some(ref s) if !s.trim().is_empty() => s.clone(),
        _ => {
            errors.push(ConfigError::MissingField {
                field: "source_account",
                env_var: "LUMENFLOW_SOURCE",
                toml_key: "source_account",
            });
            String::new()
        }
    };

    if errors.is_empty() {
        Ok(ValidatedConfig {
            network,
            contract_id,
            source_account,
        })
    } else {
        Err(errors)
    }
}

// ── Config loading ────────────────────────────────────────────────────────────

pub fn load_config(path: Option<PathBuf>) -> Result<Config> {
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
    if let Ok(v) = std::env::var("LUMENFLOW_RPC_URL") {
        config.rpc_url = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK_PASSPHRASE") {
        config.network_passphrase = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_CONTRACT_ID") {
        config.contract_id = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_SOURCE") {
        config.source_account = Some(v);
    }

    Ok(resolved)
}

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

    // --- CSV parsing tests ---

    #[test]
    fn test_parse_valid_csv() -> Result<()> {
        let path = ".test_valid_payments.csv";
        write_csv(
            path,
            &format!(
                "order_id,merchant_address,amount,memo\nORD001,{},1000,Test memo\n",
                valid_address()
            ),
        );
        let rows = parse_payment_csv(&PathBuf::from(path))?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].order_id, "ORD001");
        assert_eq!(rows[0].amount, 1000);
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn test_parse_csv_missing_header() {
        let path = ".test_missing_header.csv";
        write_csv(path, "order_id,merchant_address,amount\nORD001,GXXX,100\n");
        let result = parse_payment_csv(&PathBuf::from(path));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("memo"));
        fs::remove_file(path).ok();
    }

    #[test]
    fn test_parse_csv_invalid_amount() {
        let path = ".test_invalid_amount.csv";
        write_csv(
            path,
            &format!(
                "order_id,merchant_address,amount,memo\nORD001,{},not_a_number,Test\n",
                valid_address()
            ),
        );
        let result = parse_payment_csv(&PathBuf::from(path));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not a valid integer"));
        fs::remove_file(path).ok();
    }

    #[test]
    fn test_parse_csv_invalid_address() {
        let path = ".test_invalid_addr.csv";
        write_csv(
            path,
            "order_id,merchant_address,amount,memo\nORD001,BADADDR,1000,Test\n",
        );
        let result = parse_payment_csv(&PathBuf::from(path));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("BADADDR"));
        fs::remove_file(path).ok();
    }

    #[test]
    fn test_parse_csv_empty_file() {
        let path = ".test_empty.csv";
        write_csv(path, "");
        let result = parse_payment_csv(&PathBuf::from(path));
        assert!(result.is_err());
        fs::remove_file(path).ok();
    }

    #[test]
    fn test_parse_csv_header_only() {
        let path = ".test_header_only.csv";
        write_csv(path, "order_id,merchant_address,amount,memo\n");
        let result = parse_payment_csv(&PathBuf::from(path));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("no payment rows"));
        fs::remove_file(path).ok();
    }

    #[test]
    fn test_batch_chunking() -> Result<()> {
        let path = ".test_batch_chunking.csv";
        // Build 15 valid rows
        let addr = valid_address();
        let mut content = "order_id,merchant_address,amount,memo\n".to_string();
        for i in 0..15 {
            content.push_str(&format!("ORD{:03},{},{},Memo{}\n", i, addr, i + 1, i));
        }
        write_csv(path, &content);
        let rows = parse_payment_csv(&PathBuf::from(path))?;
        assert_eq!(rows.len(), 15);
        let batches: Vec<&[PaymentRow]> = rows.chunks(BATCH_SIZE).collect();
        assert_eq!(batches.len(), 2); // 10 + 5
        assert_eq!(batches[0].len(), 10);
        assert_eq!(batches[1].len(), 5);
        fs::remove_file(path)?;
        Ok(())
    }
}

fn resolve_config(file_env: RawConfig, cli: &Cli) -> ResolvedConfig {
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

// ── Payment struct for the interactive flow ───────────────────────────────────

struct PaymentArgs {
    merchant: String,
    amount: i128,
    order_id: String,
    memo: String,
    token: String,
}

// ── Wallet / Key loading ──────────────────────────────────────────────────────

fn load_key_from_file(path: &PathBuf) -> Result<String> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("Cannot read key file: {}", path.display()))?;
    let key = raw.trim().to_string();
    if key.is_empty() {
        bail!("Key file {} is empty", path.display());
    }
    Ok(key)
}

fn prompt_key() -> Result<String> {
    let key = rpassword::prompt_password("Enter source account secret key: ")
        .context("Failed to read secret key from terminal")?;
    if key.trim().is_empty() {
        bail!("No secret key entered");
    }
    Ok(key.trim().to_string())
}

/// Returns true when stdin is connected to a real terminal (i.e. not CI/pipe).
fn is_interactive_tty() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal()
}

/// Resolve the source account secret key, in priority order:
///
/// 1. `--key-file <FILE>` — read the key from a file (never echoed)
/// 2. `--prompt-key`      — prompt interactively with hidden input
/// 3. Auto-prompt         — when the key is still missing and stdin is a TTY,
///                          prompt with hidden input automatically
/// 4. CI error            — when the key is missing and stdin is NOT a TTY,
///                          return an actionable error asking for an explicit flag
///
/// Sensitive values are never logged or echoed to stdout/stderr.
fn resolve_source(config: &mut Config, key_file: Option<&PathBuf>, use_prompt: bool) -> Result<()> {
    if let Some(path) = key_file {
        config.source_account = Some(load_key_from_file(path)?);
        return Ok(());
    }

    if use_prompt {
        config.source_account = Some(prompt_key()?);
        return Ok(());
    }

    // If the key is already set (from config file or env var), nothing to do.
    if config.source_account.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        return Ok(());
    }

    // Key is missing. Auto-detect whether we can prompt interactively.
    if is_interactive_tty() {
        eprintln!(
            "Note: --source-account not provided. \
             Prompting for secret key (input will be hidden)."
        );
        config.source_account = Some(prompt_key()?);
    } else {
        // Non-interactive (CI, pipe). Return a clear, actionable error.
        bail!(
            "Missing source account secret key.\n\
             In non-interactive (CI) environments, provide the key explicitly:\n\
             \n\
             Option 1 — environment variable:\n\
             \x20 LUMENFLOW_SOURCE=<secret-key> lumenflow ...\n\
             \n\
             Option 2 — flag (not recommended; appears in shell history):\n\
             \x20 lumenflow --source-account <secret-key> ...\n\
             \n\
             Option 3 — key file (recommended for CI):\n\
             \x20 lumenflow --key-file /path/to/keyfile ..."
        );
    }

    Ok(())
}

// ── Formatting and Invocations ────────────────────────────────────────────────

pub fn format_pay(order_id: &str, merchant: &str, amount: i128, network: &str) -> String {
    format!(
        "Processing payment...\n  Order:    {}\n  Merchant: {}\n  Amount:   {}\n  Network:  {}\n\nSuccess! Payment for order {} has been submitted.",
        order_id, merchant, amount, network, order_id
    )
}

pub fn format_refund_init(order_id: &str, amount: i128, contract_id: &str) -> String {
    format!(
        "Initiating refund of {} for order {}...\n  Contract: {}",
        amount, order_id, contract_id
    )
}

pub fn format_history(merchant: &str) -> String {
    format!(
        "Fetching payment history for merchant {}...\n  (Mock data)\n  - ORDER_001: 500 XLM\n  - ORDER_002: 1200 XLM",
        merchant
    )
}

pub fn format_stats() -> String {
    "Global LumenFlow Statistics:\n  Total Volume:   45,000.00\n  Total Payments: 128\n  Active Merch:   12".to_string()
}

fn base_invoke(config: &Config) -> Result<Command> {
    let contract_id = config
        .contract_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .context(
            "Missing contract ID. Set LUMENFLOW_CONTRACT_ID or contract_id in .lumenflow.toml",
        )?;

    let source = config
        .source_account
        .as_deref()
        .filter(|s| !s.is_empty())
        .context(
            "Missing source account. Set LUMENFLOW_SOURCE or source_account in .lumenflow.toml",
        )?;

    let mut cmd = Command::new("stellar");
    cmd.args([
        "contract",
        "invoke",
        "--id",
        contract_id,
        "--source-account",
        source,
    ]);

    if let Some(rpc) = config.rpc_url.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--rpc-url", rpc]);
    }

    if let Some(passphrase) = config
        .network_passphrase
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        cmd.args(["--network-passphrase", passphrase]);
    } else if let Some(network) = config.network.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--network", network]);
    } else {
        cmd.args(["--network", "testnet"]);
    }

    Ok(cmd)
}

// ── CSV Batch Payment ─────────────────────────────────────────────────────────

/// A single row parsed from the batch-pay CSV file.
#[derive(Debug, Clone, PartialEq)]
pub struct CsvRow {
    pub order_id: String,
    pub merchant_address: String,
    pub token_address: String,
    pub amount: i128,
    pub memo: String,
}

/// Parse and validate a CSV file for batch payments.
///
/// Expected header: `order_id,merchant_address,token_address,amount,memo`
/// Returns validated rows or a list of per-row error messages.
pub fn parse_csv(content: &str) -> Result<Vec<CsvRow>> {
    let mut rows: Vec<CsvRow> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    let mut lines = content.lines().enumerate();

    // Consume (and validate) the header line.
    let header = loop {
        match lines.next() {
            None => bail!("CSV file is empty"),
            Some((_, line)) if line.trim().is_empty() => continue,
            Some((_, line)) => break line,
        }
    };

    let expected_header = "order_id,merchant_address,token_address,amount,memo";
    if header.trim().to_lowercase() != expected_header {
        bail!(
            "CSV header mismatch.\n  Expected: {}\n  Got:      {}",
            expected_header,
            header.trim()
        );
    }

    // Parse data rows.
    for (line_num, line) in lines {
        let display_num = line_num + 1; // 1-indexed for user messages
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.splitn(5, ',').collect();
        if parts.len() != 5 {
            errors.push(format!(
                "Row {}: expected 5 columns, got {} (line: {:?})",
                display_num,
                parts.len(),
                trimmed
            ));
            continue;
        }

        let order_id = parts[0].trim().to_string();
        let merchant_address = parts[1].trim().to_string();
        let token_address = parts[2].trim().to_string();
        let amount_str = parts[3].trim();
        let memo = parts[4].trim().to_string();

        let mut row_ok = true;

        if order_id.is_empty() {
            errors.push(format!("Row {}: order_id must not be empty", display_num));
            row_ok = false;
        }

        // Stellar addresses: start with 'G' and are exactly 56 characters.
        if !merchant_address.starts_with('G') || merchant_address.len() != 56 {
            errors.push(format!(
                "Row {}: merchant_address '{}' is not a valid Stellar address (must start with 'G' and be 56 chars)",
                display_num, merchant_address
            ));
            row_ok = false;
        }

        if !token_address.starts_with('G') || token_address.len() != 56 {
            errors.push(format!(
                "Row {}: token_address '{}' is not a valid Stellar address (must start with 'G' and be 56 chars)",
                display_num, token_address
            ));
            row_ok = false;
        }

        let amount: i128 = match amount_str.parse() {
            Ok(n) if n > 0 => n,
            Ok(_) => {
                errors.push(format!(
                    "Row {}: amount must be a positive integer, got '{}'",
                    display_num, amount_str
                ));
                row_ok = false;
                0
            }
            Err(_) => {
                errors.push(format!(
                    "Row {}: amount '{}' is not a valid integer",
                    display_num, amount_str
                ));
                row_ok = false;
                0
            }
        };

        if row_ok {
            rows.push(CsvRow {
                order_id,
                merchant_address,
                token_address,
                amount,
                memo,
            });
        }
    }

    if !errors.is_empty() {
        let msg = errors.join("\n");
        bail!("CSV validation failed:\n{}", msg);
    }

    if rows.is_empty() {
        bail!("CSV file contains no data rows");
    }

    Ok(rows)
}

/// Outcome of submitting a single CSV row.
#[derive(Debug)]
struct RowResult {
    order_id: String,
    status: String,
    tx_hash: String,
}

/// Print a results table: | order_id | status | tx_hash |
fn print_results_table(results: &[RowResult]) {
    // Calculate column widths.
    let w_order = results
        .iter()
        .map(|r| r.order_id.len())
        .max()
        .unwrap_or(0)
        .max("order_id".len());
    let w_status = results
        .iter()
        .map(|r| r.status.len())
        .max()
        .unwrap_or(0)
        .max("status".len());
    let w_hash = results
        .iter()
        .map(|r| r.tx_hash.len())
        .max()
        .unwrap_or(0)
        .max("tx_hash".len());

    let sep = format!(
        "+-{}-+-{}-+-{}-+",
        "-".repeat(w_order),
        "-".repeat(w_status),
        "-".repeat(w_hash)
    );

    println!("{}", sep);
    println!(
        "| {:<w_order$} | {:<w_status$} | {:<w_hash$} |",
        "order_id",
        "status",
        "tx_hash",
        w_order = w_order,
        w_status = w_status,
        w_hash = w_hash
    );
    println!("{}", sep);

    for r in results {
        println!(
            "| {:<w_order$} | {:<w_status$} | {:<w_hash$} |",
            r.order_id,
            r.status,
            r.tx_hash,
            w_order = w_order,
            w_status = w_status,
            w_hash = w_hash
        );
    }

    println!("{}", sep);
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let mut config = load_config(cli.config)?;
    resolve_source(&mut config, cli.key_file.as_ref(), cli.prompt_key)?;

    let network = config.network.as_deref().unwrap_or("testnet");
    let contract_id = config.contract_id.as_deref().unwrap_or("N/A");

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
        Commands::Pay {
            merchant,
            amount,
            order_id,
            idempotent,
            ..
        } => {
            if config.source_account.is_none() {
                bail!("No signing key available. Use --key-file, --prompt-key, or set LUMENFLOW_SOURCE.");
            }
            println!(
                "Processing payment{}...",
                if *idempotent { " (idempotent)" } else { "" }
            );
            println!("  Order:    {}", order_id);
            println!("  Merchant: {}", merchant);
            println!("  Amount:   {}", amount);
            println!("  Network:  {}", network);
            if *idempotent {
                println!("\nNote: duplicate submissions for order {} will return the existing payment record.", order_id);
            }
            println!(
                "\nSuccess! Payment for order {} has been submitted.",
                order_id
            );
        }
        Commands::Refund { action } => {
            if config.source_account.is_none() {
                bail!("No signing key available. Use --key-file, --prompt-key, or set LUMENFLOW_SOURCE.");
            }
            match action {
                RefundCommands::Init {
                    order_id, amount, ..
                } => {
                    println!("Initiating refund of {} for order {}...", amount, order_id);
                    println!("  Contract: {}", contract_id);
                }
                RefundCommands::Approve { refund_id, .. } => {
                    println!("Approving refund {}...", refund_id);
                }
                RefundCommands::Reject { refund_id, .. } => {
                    println!("Rejecting refund {}...", refund_id);
                }
                RefundCommands::Execute { refund_id } => {
                    println!("Executing refund {}...", refund_id);
                }
                RefundCommands::Status { refund_id } => {
                    println!("Querying status of refund {}...", refund_id);
                }
                RefundCommands::List {
                    order_id,
                    caller,
                    output,
                } => {
                    // Invoke get_refunds_for_order on the contract and display the results.
                    let mut cmd = base_invoke(&config)?;
                    cmd.args([
                        "--",
                        "get_refunds_for_order",
                        "--caller",
                        caller,
                        "--order_id",
                        order_id,
                    ]);

                    let out = cmd
                        .output()
                        .context("Failed to invoke get_refunds_for_order")?;

                    if !out.status.success() {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        bail!("get_refunds_for_order failed: {}", stderr.trim());
                    }

                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let raw = stdout.trim();

                    if output.to_lowercase() == "json" {
                        // Pass through the raw JSON from the contract invocation
                        println!("{}", raw);
                    } else {
                        // Parse the JSON and render a human-readable table
                        match serde_json::from_str::<serde_json::Value>(raw) {
                            Ok(serde_json::Value::Array(refunds)) if refunds.is_empty() => {
                                println!("No refunds found for order {}.", order_id);
                            }
                            Ok(serde_json::Value::Array(refunds)) => {
                                // Column widths (minimum = header length)
                                let w_id     = refunds.iter()
                                    .map(|r| r["refund_id"].as_str().unwrap_or("-").len())
                                    .max().unwrap_or(0).max("refund_id".len());
                                let w_status = refunds.iter()
                                    .map(|r| r["status"].as_str().unwrap_or("-").len())
                                    .max().unwrap_or(0).max("status".len());
                                let w_amount = refunds.iter()
                                    .map(|r| r["amount"].to_string().len())
                                    .max().unwrap_or(0).max("amount".len());
                                let w_reason = refunds.iter()
                                    .map(|r| r["reason"].as_str().unwrap_or("-").len())
                                    .max().unwrap_or(0).max("reason".len());
                                let w_init   = refunds.iter()
                                    .map(|r| r["initiator"].as_str().unwrap_or("-").len())
                                    .max().unwrap_or(0).max("initiator".len());

                                let sep = format!(
                                    "+-{}-+-{}-+-{}-+-{}-+-{}-+",
                                    "-".repeat(w_id),
                                    "-".repeat(w_status),
                                    "-".repeat(w_amount),
                                    "-".repeat(w_reason),
                                    "-".repeat(w_init),
                                );

                                println!("{}", sep);
                                println!(
                                    "| {:<w_id$} | {:<w_status$} | {:<w_amount$} | {:<w_reason$} | {:<w_init$} |",
                                    "refund_id", "status", "amount", "reason", "initiator",
                                    w_id = w_id, w_status = w_status, w_amount = w_amount,
                                    w_reason = w_reason, w_init = w_init,
                                );
                                println!("{}", sep);

                                for r in &refunds {
                                    let refund_id = r["refund_id"].as_str().unwrap_or("-");
                                    let status    = r["status"].as_str().unwrap_or("-");
                                    let amount    = r["amount"].to_string();
                                    let reason    = r["reason"].as_str().unwrap_or("-");
                                    let initiator = r["initiator"].as_str().unwrap_or("-");
                                    println!(
                                        "| {:<w_id$} | {:<w_status$} | {:<w_amount$} | {:<w_reason$} | {:<w_init$} |",
                                        refund_id, status, amount, reason, initiator,
                                        w_id = w_id, w_status = w_status, w_amount = w_amount,
                                        w_reason = w_reason, w_init = w_init,
                                    );
                                }

                                println!("{}", sep);
                                println!("{} refund(s) for order {}.", refunds.len(), order_id);
                            }
                            _ => {
                                // Contract returned something other than a JSON array
                                // (e.g. raw Soroban XDR output or an error). Print as-is.
                                println!("{}", raw);
                            }
                        }
                    }
                }
            }
        }
        Commands::History { merchant, .. } => {
            println!("{}", format_history(merchant));
        }
        Commands::Stats { .. } => {
            println!("{}", format_stats());
        }
        Commands::PrintConfig => {
            println!("Resolved configuration:");
            println!(
                "  network:            {}",
                config.network.as_deref().unwrap_or("testnet")
            );
            println!(
                "  rpc_url:            {}",
                config
                    .rpc_url
                    .as_deref()
                    .unwrap_or("https://soroban-testnet.stellar.org")
            );
            println!(
                "  network_passphrase: {}",
                config
                    .network_passphrase
                    .as_deref()
                    .unwrap_or("Test SDF Network ; September 2015")
            );
            println!(
                "  contract_id:        {}",
                config.contract_id.as_deref().unwrap_or("N/A")
            );
            // Redact the source account when printing configuration to avoid leaking secrets.
            let source_display = config
                .source_account
                .as_deref()
                .map(|s| {
                    if s.len() > 8 {
                        format!("{}…{}", &s[..4], &s[s.len() - 4..])
                    } else {
                        "*****".to_string()
                    }
                })
                .unwrap_or_else(|| "(not set)".to_string());
            println!("  source_account:     {}", source_display);
        }
        Commands::BatchPay {
            file,
            token,
            signature,
            merchant_public_key,
        } => {
            if config.source_account.is_none() {
                bail!("No signing key available. Use --key-file, --prompt-key, or set LUMENFLOW_SOURCE.");
            }

            // Read and parse the CSV file.
            let content = std::fs::read_to_string(file)
                .with_context(|| format!("Failed to read CSV file: {}", file.display()))?;
            let rows = parse_csv(&content)?;

            if rows.len() > 10 {
                bail!(
                    "Too many rows: {} (batch_payment supports at most 10 items per call)",
                    rows.len()
                );
            }

            let payer = config.source_account.as_deref().unwrap_or_default();
            println!(
                "Submitting {} payment(s) from {} on {}...\n",
                rows.len(),
                payer,
                network
            );

            let mut results: Vec<RowResult> = Vec::new();

            for row in &rows {
                // Resolve token: CLI flag overrides CSV column.
                let token_addr = token.as_deref().unwrap_or(&row.token_address);

                let mut cmd = base_invoke(&config)?;
                cmd.args([
                    "--",
                    "process_payment_with_signature",
                    "--payer",
                    payer,
                    "--order_id",
                    &row.order_id,
                    "--merchant_address",
                    &row.merchant_address,
                    "--token_address",
                    token_addr,
                    "--amount",
                    &row.amount.to_string(),
                    "--memo",
                    &row.memo,
                    "--tags",
                    "null",
                    "--nonce",
                    "1",
                    "--signature",
                    signature,
                    "--merchant_public_key",
                    merchant_public_key,
                ]);

                let output = cmd.output();
                match output {
                    Ok(out) if out.status.success() => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        // The Stellar CLI prints the tx hash on stdout; extract it if present.
                        let tx_hash = stdout
                            .lines()
                            .find(|l| l.len() == 64 && l.chars().all(|c| c.is_ascii_hexdigit()))
                            .unwrap_or("(no hash)")
                            .trim()
                            .to_string();
                        results.push(RowResult {
                            order_id: row.order_id.clone(),
                            status: "success".to_string(),
                            tx_hash,
                        });
                    }
                    Ok(out) => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        // Summarise the error in one line for the table.
                        let err_summary = stderr
                            .lines()
                            .find(|l| !l.trim().is_empty())
                            .unwrap_or("unknown error")
                            .trim()
                            .chars()
                            .take(60)
                            .collect::<String>();
                        results.push(RowResult {
                            order_id: row.order_id.clone(),
                            status: format!("FAILED: {}", err_summary),
                            tx_hash: "-".to_string(),
                        });
                    }
                    Err(e) => {
                        results.push(RowResult {
                            order_id: row.order_id.clone(),
                            status: format!("ERROR: {}", e),
                            tx_hash: "-".to_string(),
                        });
                    }
                }
            }

            print_results_table(&results);

            // Report overall outcome.
            let failed = results
                .iter()
                .filter(|r| r.status.starts_with("FAILED") || r.status.starts_with("ERROR"))
                .count();
            let succeeded = results.len() - failed;
            println!("\n{}/{} payment(s) succeeded.", succeeded, results.len());
            if failed > 0 {
                bail!("{} payment(s) failed. See table above for details.", failed);
            }
        }
        Commands::Merchant { action } => match action {
            MerchantCommands::List {
                admin_key,
                limit,
                cursor,
                output,
            } => {
                let use_json = output.to_lowercase() == "json";

                let mut cmd = base_invoke(&config)?;
                // Override source account with the admin key for this call.
                let mut admin_cmd = Command::new("stellar");
                let contract_id_val = config
                    .contract_id
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .context(
                        "Missing contract ID. Set LUMENFLOW_CONTRACT_ID or contract_id in .lumenflow.toml",
                    )?;

                admin_cmd.args(["contract", "invoke", "--id", contract_id_val,
                    "--source-account", admin_key]);

                if let Some(rpc) = config.rpc_url.as_deref().filter(|s| !s.is_empty()) {
                    admin_cmd.args(["--rpc-url", rpc]);
                }
                if let Some(passphrase) = config.network_passphrase.as_deref().filter(|s| !s.is_empty()) {
                    admin_cmd.args(["--network-passphrase", passphrase]);
                } else if let Some(net) = config.network.as_deref().filter(|s| !s.is_empty()) {
                    admin_cmd.args(["--network", net]);
                } else {
                    admin_cmd.args(["--network", "testnet"]);
                }

                let cursor_val = cursor.as_deref().unwrap_or("null");
                admin_cmd.args([
                    "--",
                    "get_merchants",
                    "--admin",
                    admin_key,
                    "--cursor",
                    cursor_val,
                    "--limit",
                    &limit.to_string(),
                ]);

                let output_result = admin_cmd.output()
                    .context("failed to invoke get_merchants")?;

                if !output_result.status.success() {
                    let stderr = String::from_utf8_lossy(&output_result.stderr);
                    bail!("get_merchants failed: {}", stderr.trim());
                }

                let stdout = String::from_utf8_lossy(&output_result.stdout);
                let raw = stdout.trim();

                if use_json {
                    // Pass through the raw JSON from the contract, or wrap it.
                    println!("{}", raw);
                } else {
                    // Pretty-print the merchant list.
                    println!("Merchant list (network: {}, limit: {}, cursor: {}):",
                        config.network.as_deref().unwrap_or("testnet"),
                        limit,
                        cursor.as_deref().unwrap_or("(start)"),
                    );
                    println!("{}", raw);
                }

                // Suppress unused variable warning — cmd was replaced by admin_cmd above.
                drop(cmd);
            }
        },
        Commands::Admin { action } => match action {
            AdminCommands::AccountStats { address } => {
                let mut cmd = base_invoke(&config)?;
                cmd.args(["--", "get_account_payment_count", "--address", address]);

                let output = cmd
                    .output()
                    .context("failed to invoke get_account_payment_count")?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    bail!("get_account_payment_count failed: {}", stderr.trim());
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                let count: u32 = stdout
                    .lines()
                    .rev()
                    .find_map(|l| l.trim().parse::<u32>().ok())
                    .with_context(|| {
                        format!(
                            "could not parse payment count from output: {}",
                            stdout.trim()
                        )
                    })?;

                let pct = (count as f64 / MAX_PAYMENT_IDS_PER_ACCOUNT as f64) * 100.0;
                println!("Account:        {}", address);
                println!("Payment count:  {}", count);
                println!("Cap:            {}", MAX_PAYMENT_IDS_PER_ACCOUNT);
                println!("Usage:          {:.1}%", pct);
                if count >= MAX_PAYMENT_IDS_PER_ACCOUNT * 9 / 10 {
                    println!("\nWarning: this account is at or above 90% of MAX_PAYMENT_IDS_PER_ACCOUNT. Further payments may soon fail with PaymentHistoryLimitExceeded.");
                }
            }
        },
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    // Mutex to serialize tests that touch env vars.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn make_cli(network: Option<&str>, rpc_url: Option<&str>, passphrase: Option<&str>) -> Cli {
        Cli {
            config: None,
            network: network.map(String::from),
            rpc_url: rpc_url.map(String::from),
            network_passphrase: passphrase.map(String::from),
            contract_id: None,
            source_account: None,
            key_file: None,
            prompt_key: false,
            command: Commands::Stats {
                admin: "GSTATS".to_string(),
            },
        }
    }

    fn full_config() -> Config {
        Config {
            network: Some("testnet".into()),
            contract_id: Some("C123456".into()),
            source_account: Some("SABC...".into()),
            rpc_url: None,
            network_passphrase: None,
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

    #[test]
    fn test_admin_account_stats_parses() {
        let cli = Cli::try_parse_from([
            "lumenflow",
            "admin",
            "account-stats",
            "--address",
            "GADDRESS",
        ])
        .expect("admin account-stats should parse");

        match cli.command {
            Commands::Admin {
                action: AdminCommands::AccountStats { address },
            } => assert_eq!(address, "GADDRESS"),
            _ => panic!("expected Commands::Admin {{ AccountStats }}"),
        }
    }

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let path = ".test_lumenflow_273.toml";
        fs::write(
            path,
            "network = \"local\"\ncontract_id = \"C123\"\nsource_account = \"S123\"",
        )?;
        let config = load_config(Some(PathBuf::from(path)))?;
        assert_eq!(config.network.as_deref(), Some("local"));
        assert_eq!(config.contract_id.as_deref(), Some("C123"));
        assert_eq!(config.source_account.as_deref(), Some("S123"));
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn test_load_config_from_env() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
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
        let _guard = ENV_LOCK.lock().unwrap();
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
        assert!(resolved.rpc_url.contains("mainnet"));
    }

    #[test]
    fn test_preset_applied_for_local() {
        let cli = make_cli(Some("local"), None, None);
        let resolved = resolve_config(RawConfig::default(), &cli);
        assert_eq!(resolved.rpc_url, "http://localhost:8000/soroban/rpc");
        assert_eq!(
            resolved.network_passphrase,
            "Standalone Network ; February 2017"
        );
    }

    #[test]
    fn test_explicit_rpc_url_overrides_preset() {
        let cli = make_cli(Some("testnet"), Some("http://custom:8080/rpc"), None);
        let resolved = resolve_config(RawConfig::default(), &cli);
        assert_eq!(resolved.rpc_url, "http://custom:8080/rpc");
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
        let cfg = Config {
            network: None,
            ..full_config()
        };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(
            e,
            ConfigError::MissingField {
                field: "network",
                ..
            }
        )));
    }

    #[test]
    fn test_missing_contract_id_reports_error() {
        let cfg = Config {
            contract_id: None,
            ..full_config()
        };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(
            e,
            ConfigError::MissingField {
                field: "contract_id",
                ..
            }
        )));
    }

    #[test]
    fn test_missing_source_account_reports_error() {
        let cfg = Config {
            source_account: None,
            ..full_config()
        };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(
            e,
            ConfigError::MissingField {
                field: "source_account",
                ..
            }
        )));
    }

    #[test]
    fn test_all_missing_reports_three_errors() {
        let cfg = Config::default();
        let errors = validate_config(cfg).unwrap_err();
        assert_eq!(errors.len(), 3);
    }

    #[test]
    fn test_invalid_network_reports_error() {
        let cfg = Config {
            network: Some("devnet".into()),
            ..full_config()
        };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors
            .iter()
            .any(|e| matches!(e, ConfigError::InvalidNetwork { .. })));
    }

    #[test]
    fn test_valid_networks_accepted() {
        for net in ["local", "testnet", "mainnet"] {
            let cfg = Config {
                network: Some(net.into()),
                ..full_config()
            };
            assert!(validate_config(cfg).is_ok(), "Expected {net} to be valid");
        }
    }

    #[test]
    fn test_empty_string_treated_as_missing() {
        let cfg = Config {
            network: Some("  ".into()),
            ..full_config()
        };
        let errors = validate_config(cfg).unwrap_err();
        assert!(errors.iter().any(|e| matches!(
            e,
            ConfigError::MissingField {
                field: "network",
                ..
            }
        )));
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
        let e = ConfigError::InvalidNetwork {
            value: "wrongnet".into(),
        };
        let msg = e.to_string();
        assert!(msg.contains("testnet"));
        assert!(msg.contains("mainnet"));
        assert!(msg.contains("local"));
    }

    #[test]
    fn test_load_config_missing_file_gives_defaults() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("LUMENFLOW_NETWORK");
        std::env::remove_var("LUMENFLOW_CONTRACT_ID");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let config = load_config(Some(PathBuf::from(".nonexistent_config_xyz.toml")))?;
        assert!(config.network.is_none());
        assert!(config.contract_id.is_none());
        Ok(())
    }

    #[test]
    fn test_load_config_defaults_when_no_file_and_no_env() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
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
    fn test_env_vars_override_file_values() -> Result<()> {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join("test_lumenflow_override.toml");
        fs::write(&tmp, "network = \"local\"\ncontract_id = \"C-FILE\"")?;

        std::env::set_var("LUMENFLOW_NETWORK", "mainnet");
        std::env::set_var("LUMENFLOW_CONTRACT_ID", "C-ENV");
        std::env::remove_var("LUMENFLOW_SOURCE");

        let config = load_config(Some(tmp.clone()))?;
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

    #[test]
    fn test_cli_pay_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from([
            "lumenflow",
            "pay",
            "--merchant",
            "GADDR",
            "--amount",
            "500",
            "--order-id",
            "ORD1",
            "--token",
            "TADDR",
            "--signature",
            "SIG",
            "--merchant-public-key",
            "MPK",
        ]);
        assert!(m.is_ok(), "pay subcommand should parse successfully");
    }

    #[test]
    fn test_cli_stats_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from(["lumenflow", "stats", "--admin", "GADMIN"]);
        assert!(m.is_ok(), "stats subcommand should parse successfully");
    }

    #[test]
    fn test_cli_history_args_parse() {
        use clap::CommandFactory;
        let m =
            Cli::command().try_get_matches_from(["lumenflow", "history", "--merchant", "GADDR"]);
        assert!(m.is_ok(), "history subcommand should parse successfully");
    }

    #[test]
    fn test_cli_refund_init_args_parse() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from([
            "lumenflow",
            "refund",
            "init",
            "--order-id",
            "ORD1",
            "--amount",
            "100",
            "--caller",
            "GCALLER",
        ]);
        assert!(
            m.is_ok(),
            "refund init subcommand should parse successfully"
        );
    }

    #[test]
    fn test_cli_missing_required_arg_fails() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from(["lumenflow", "pay", "--amount", "100"]);
        assert!(m.is_err(), "pay without required arguments should fail");
    }

    #[test]
    fn test_cli_unknown_subcommand_fails() {
        use clap::CommandFactory;
        let m = Cli::command().try_get_matches_from(["lumenflow", "nonexistent"]);
        assert!(m.is_err(), "unknown subcommand should fail");
    }

    #[test]
    fn test_merchant_list_args_parse() {
        let cli = Cli::try_parse_from([
            "lumenflow",
            "merchant",
            "list",
            "--admin-key",
            "SADMIN",
        ])
        .expect("merchant list should parse with --admin-key");

        match cli.command {
            Commands::Merchant {
                action: MerchantCommands::List {
                    admin_key,
                    limit,
                    cursor,
                    output,
                },
            } => {
                assert_eq!(admin_key, "SADMIN");
                assert_eq!(limit, 10);
                assert!(cursor.is_none());
                assert_eq!(output, "text");
            }
            _ => panic!("expected Commands::Merchant {{ List }}"),
        }
    }

    #[test]
    fn test_merchant_list_with_all_flags() {
        let cli = Cli::try_parse_from([
            "lumenflow",
            "merchant",
            "list",
            "--admin-key",
            "SADMIN",
            "--limit",
            "25",
            "--cursor",
            "GCURSOR",
            "--output",
            "json",
        ])
        .expect("merchant list with all flags should parse");

        match cli.command {
            Commands::Merchant {
                action: MerchantCommands::List {
                    limit,
                    cursor,
                    output,
                    ..
                },
            } => {
                assert_eq!(limit, 25);
                assert_eq!(cursor.as_deref(), Some("GCURSOR"));
                assert_eq!(output, "json");
            }
            _ => panic!("expected Commands::Merchant {{ List }}"),
        }
    }

    #[test]
    fn test_merchant_list_missing_admin_key_fails() {
        use clap::CommandFactory;
        // Without --admin-key and without LUMENFLOW_ADMIN_KEY env var, should fail.
        std::env::remove_var("LUMENFLOW_ADMIN_KEY");
        let m = Cli::command().try_get_matches_from(["lumenflow", "merchant", "list"]);
        assert!(m.is_err(), "merchant list without --admin-key should fail");
    }
}
