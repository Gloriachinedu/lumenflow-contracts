use anyhow::{anyhow, bail, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Maximum number of payments per batch call, as defined by the contract.
const BATCH_SIZE: usize = 10;

// ---------------------------------------------------------------------------
// CLI structure
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Select a named profile from .lumenflow.toml (overrides LUMENFLOW_PROFILE env var)
    #[arg(long, value_name = "PROFILE", env = "LUMENFLOW_PROFILE")]
    profile: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Pay a merchant (single payment or CSV batch)
    Pay {
        /// Merchant address (single payment)
        #[arg(short, long, required_unless_present = "batch_file")]
        merchant: Option<String>,
        /// Amount to pay (single payment)
        #[arg(short, long, required_unless_present = "batch_file")]
        amount: Option<i128>,
        /// Order ID (single payment)
        #[arg(short, long, required_unless_present = "batch_file")]
        order_id: Option<String>,
        /// Read payments from a CSV file and submit as batches of up to 10
        #[arg(
            long,
            value_name = "FILE",
            conflicts_with_all = ["merchant", "amount", "order_id"]
        )]
        batch_file: Option<PathBuf>,
        /// Print what would be submitted without executing
        #[arg(long)]
        dry_run: bool,
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Default, Clone)]
struct ProfileConfig {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Config {
    default_profile: Option<String>,
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
    #[serde(default)]
    profiles: HashMap<String, ProfileConfig>,
}

#[derive(Debug, Default)]
struct ResolvedConfig {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
    rpc_url: Option<String>,
    active_profile: Option<String>,
}

fn load_config(path: Option<PathBuf>, profile_override: Option<String>) -> Result<ResolvedConfig> {
    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));

    let raw: Config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        toml::from_str(&content)?
    } else {
        Config::default()
    };

    let active_profile = profile_override.or_else(|| raw.default_profile.clone());

    let mut resolved = ResolvedConfig {
        network: raw.network.clone(),
        contract_id: raw.contract_id.clone(),
        source_account: raw.source_account.clone(),
        rpc_url: raw.rpc_url.clone(),
        active_profile: active_profile.clone(),
    };

    if let Some(ref name) = active_profile {
        match raw.profiles.get(name) {
            Some(p) => {
                if p.network.is_some() {
                    resolved.network = p.network.clone();
                }
                if p.contract_id.is_some() {
                    resolved.contract_id = p.contract_id.clone();
                }
                if p.source_account.is_some() {
                    resolved.source_account = p.source_account.clone();
                }
                if p.rpc_url.is_some() {
                    resolved.rpc_url = p.rpc_url.clone();
                }
            }
            None => {
                return Err(anyhow!(
                    "Profile '{}' not found in {}. Available profiles: [{}]",
                    name,
                    config_path.display(),
                    raw.profiles
                        .keys()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
    }

    if let Ok(v) = std::env::var("LUMENFLOW_NETWORK") {
        resolved.network = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_CONTRACT_ID") {
        resolved.contract_id = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_SOURCE") {
        resolved.source_account = Some(v);
    }
    if let Ok(v) = std::env::var("LUMENFLOW_RPC_URL") {
        resolved.rpc_url = Some(v);
    }

    Ok(resolved)
}

// ---------------------------------------------------------------------------
// CSV batch payment
// ---------------------------------------------------------------------------

/// A single payment row parsed from the CSV file.
#[derive(Debug, Clone)]
struct PaymentRow {
    order_id: String,
    merchant_address: String,
    amount: i128,
    memo: String,
}

/// Parse and validate a CSV file for batch payment import.
///
/// Required headers: `order_id`, `merchant_address`, `amount`, `memo`
/// Returns an error on the first validation failure so the user can fix all
/// problems before any payments are submitted.
fn parse_payment_csv(path: &PathBuf) -> Result<Vec<PaymentRow>> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("Cannot read '{}': {}", path.display(), e))?;

    let mut lines = content.lines().enumerate();

    // --- header validation ---
    let (_, header_line) = lines
        .next()
        .ok_or_else(|| anyhow!("CSV file is empty: {}", path.display()))?;

    let headers: Vec<&str> = header_line.split(',').map(str::trim).collect();
    let required = ["order_id", "merchant_address", "amount", "memo"];
    for req in &required {
        if !headers.contains(req) {
            bail!(
                "CSV is missing required column '{}'. Found columns: [{}]",
                req,
                headers.join(", ")
            );
        }
    }

    let col = |name: &str| headers.iter().position(|h| h == &name).unwrap();
    let idx_order = col("order_id");
    let idx_merchant = col("merchant_address");
    let idx_amount = col("amount");
    let idx_memo = col("memo");

    // --- row validation ---
    let mut rows = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (line_num, line) in lines {
        let line = line.trim();
        if line.is_empty() {
            continue; // skip blank lines
        }

        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        let row_num = line_num + 1; // 1-based for user messages

        // Check column count
        if fields.len() != headers.len() {
            errors.push(format!(
                "Row {}: expected {} columns, found {}",
                row_num,
                headers.len(),
                fields.len()
            ));
            continue;
        }

        let order_id = fields[idx_order].to_string();
        let merchant_address = fields[idx_merchant].to_string();
        let memo = fields[idx_memo].to_string();

        // Validate order_id is non-empty
        if order_id.is_empty() {
            errors.push(format!("Row {}: order_id must not be empty", row_num));
        }

        // Validate Stellar address (G... public key, 56 chars)
        if !merchant_address.starts_with('G') || merchant_address.len() != 56 {
            errors.push(format!(
                "Row {}: merchant_address '{}' does not look like a valid Stellar address (must start with G and be 56 characters)",
                row_num, merchant_address
            ));
        }

        // Validate amount is a positive integer
        let amount = match fields[idx_amount].parse::<i128>() {
            Ok(v) if v > 0 => v,
            Ok(_) => {
                errors.push(format!(
                    "Row {}: amount must be a positive integer, got '{}'",
                    row_num,
                    fields[idx_amount]
                ));
                continue;
            }
            Err(_) => {
                errors.push(format!(
                    "Row {}: amount '{}' is not a valid integer",
                    row_num,
                    fields[idx_amount]
                ));
                continue;
            }
        };

        rows.push(PaymentRow {
            order_id,
            merchant_address,
            amount,
            memo,
        });
    }

    if !errors.is_empty() {
        bail!(
            "CSV validation failed with {} error(s):\n{}",
            errors.len(),
            errors.join("\n")
        );
    }

    if rows.is_empty() {
        bail!("CSV file contains no payment rows (only a header was found)");
    }

    Ok(rows)
}

/// Submit (or dry-run) batches of payments.
///
/// Rows are grouped into chunks of at most BATCH_SIZE and each chunk is
/// submitted as a single `batch_payment` contract call.
fn submit_batches(rows: Vec<PaymentRow>, dry_run: bool, config: &ResolvedConfig) -> Result<()> {
    let total = rows.len();
    let batches: Vec<&[PaymentRow]> = rows.chunks(BATCH_SIZE).collect();

    println!(
        "{} {} payment(s) in {} batch(es) of up to {}:",
        if dry_run { "[DRY RUN]" } else { "Submitting" },
        total,
        batches.len(),
        BATCH_SIZE,
    );
    println!(
        "  Network:  {}",
        config.network.as_deref().unwrap_or("testnet")
    );
    println!(
        "  Contract: {}",
        config.contract_id.as_deref().unwrap_or("N/A")
    );
    println!();

    for (batch_idx, batch) in batches.iter().enumerate() {
        println!(
            "Batch {}/{} ({} payment(s)):",
            batch_idx + 1,
            batches.len(),
            batch.len()
        );
        for row in *batch {
            println!(
                "  [{}]  merchant={}  amount={}  memo={}",
                row.order_id, row.merchant_address, row.amount, row.memo
            );
        }

        if !dry_run {
            // In a real implementation this would invoke the contract's
            // batch_payment entry point via the Stellar RPC:
            //
            //   stellar contract invoke \
            //     --id <CONTRACT_ID> \
            //     -- batch_payment \
            //     --payments '[...]'
            //
            println!("  → batch_payment submitted (mock)");
        } else {
            println!("  → (dry-run: not submitted)");
        }
        println!();
    }

    if dry_run {
        println!("[DRY RUN] No payments were submitted.");
    } else {
        println!("Done. {} payment(s) submitted in {} batch(es).", total, batches.len());
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn valid_address() -> &'static str {
        "GCKFBEIYV2U22ZTDLCXF42LSUFMSEFRVZJRKJ5WBMK3IW4IFTHEVNK"
    }

    fn write_csv(path: &str, content: &str) {
        let mut f = fs::File::create(path).unwrap();
        write!(f, "{}", content).unwrap();
    }

    // --- config tests ---

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp = ".test_cfg_basic.toml";
        fs::write(temp, "network=\"local\"\ncontract_id=\"C123\"\nsource_account=\"S123\"")?;
        let cfg = load_config(Some(PathBuf::from(temp)), None)?;
        assert_eq!(cfg.network.as_deref(), Some("local"));
        fs::remove_file(temp)?;
        Ok(())
    }

    #[test]
    fn test_load_config_env() -> Result<()> {
        std::env::set_var("LUMENFLOW_NETWORK", "devnet_test");
        let cfg = load_config(None, None)?;
        assert_eq!(cfg.network.as_deref(), Some("devnet_test"));
        std::env::remove_var("LUMENFLOW_NETWORK");
        Ok(())
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config, cli.profile)?;

    if let Some(ref p) = config.active_profile {
        println!("[profile: {}]", p);
    }

    match &cli.command {
        Commands::Pay {
            merchant,
            amount,
            order_id,
            batch_file,
            dry_run,
        } => {
            if let Some(csv_path) = batch_file {
                // --- Batch CSV mode ---
                let rows = parse_payment_csv(csv_path)?;
                submit_batches(rows, *dry_run, &config)?;
            } else {
                // --- Single payment mode ---
                let merchant = merchant.as_deref().unwrap();
                let amount = amount.unwrap();
                let order_id = order_id.as_deref().unwrap();

                if *dry_run {
                    println!("[DRY RUN] Would submit:");
                }
                println!("Processing payment...");
                println!("  Order:    {}", order_id);
                println!("  Merchant: {}", merchant);
                println!("  Amount:   {}", amount);
                println!(
                    "  Network:  {}",
                    config.network.as_deref().unwrap_or("testnet")
                );
                if !dry_run {
                    println!("\nSuccess! Payment for order {} has been submitted.", order_id);
                }
            }
        }
        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, amount } => {
                println!("Initiating refund of {} for order {}...", amount, order_id);
                println!(
                    "  Contract: {}",
                    config.contract_id.as_deref().unwrap_or("N/A")
                );
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
    }

    Ok(())
}
