use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use serde::Deserialize;
use std::path::PathBuf;

// ── CLI structure ─────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "lumenflow")]
#[command(about = "LumenFlow CLI tool for common operations", long_about = None)]
#[command(
    after_help = "INTERACTIVE MODE:\n  Run `lumenflow pay` with no flags to enter interactive mode.\n  You will be prompted for each field with real-time validation.\n  Press Ctrl-C at any prompt to cancel."
)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

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
        /// Merchant Stellar address (G…)
        #[arg(short, long)]
        merchant: Option<String>,

        /// Amount to pay (in stroops, integer)
        #[arg(short, long)]
        amount: Option<i128>,

        /// Unique order ID
        #[arg(short, long)]
        order_id: Option<String>,

        /// Optional memo / payment reference
        #[arg(long)]
        memo: Option<String>,

        /// Token contract address (defaults to native XLM)
        #[arg(short, long)]
        token: Option<String>,
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

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
struct Config {
    network: Option<String>,
    contract_id: Option<String>,
    source_account: Option<String>,
}

fn load_config(path: Option<PathBuf>) -> Result<Config> {
    let mut config = Config::default();

    let config_path = path.unwrap_or_else(|| PathBuf::from(".lumenflow.toml"));
    if config_path.exists() {
        let content = std::fs::read_to_string(config_path)?;
        config = toml::from_str(&content)?;
    }

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

// ── Validation helpers ────────────────────────────────────────────────────────

/// Validate a Stellar address: must start with 'G' and be 56 characters long.
fn validate_stellar_address(input: &String) -> Result<(), String> {
    let s = input.trim();
    if s.len() == 56 && s.starts_with('G') && s.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err("Must be a valid Stellar address (56 characters, starting with G)".to_string())
    }
}

/// Validate that the input parses as a positive i128.
fn validate_positive_amount(input: &String) -> Result<(), String> {
    match input.trim().parse::<i128>() {
        Ok(n) if n > 0 => Ok(()),
        Ok(_) => Err("Amount must be greater than zero".to_string()),
        Err(_) => Err("Amount must be a positive integer (in stroops)".to_string()),
    }
}

/// Validate that order_id is non-empty and contains no whitespace.
fn validate_order_id(input: &String) -> Result<(), String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("Order ID cannot be empty".to_string());
    }
    if s.contains(char::is_whitespace) {
        return Err("Order ID cannot contain spaces".to_string());
    }
    Ok(())
}

// ── Payment struct for the interactive flow ───────────────────────────────────

struct PaymentArgs {
    merchant: String,
    amount: i128,
    order_id: String,
    memo: String,
    token: String,
}

// ── Interactive mode ──────────────────────────────────────────────────────────

/// Prompt the user for all payment fields interactively, with real-time
/// per-field validation.  Returns `None` if the user cancels at the
/// confirmation prompt.
fn run_interactive_pay(config: &Config) -> Result<Option<PaymentArgs>> {
    let theme = ColorfulTheme::default();
    let network = config.network.as_deref().unwrap_or("testnet");

    println!(
        "\n🌟  LumenFlow Interactive Payment — network: {network}\n\
         (Press Ctrl-C at any time to cancel)\n"
    );

    // 1. Merchant address
    let merchant: String = Input::with_theme(&theme)
        .with_prompt("Merchant address (G…)")
        .validate_with(validate_stellar_address)
        .interact_text()?;

    // 2. Token selection
    let tokens = vec!["XLM (native)", "USDC", "Custom…"];
    let token_choice = Select::with_theme(&theme)
        .with_prompt("Token")
        .items(&tokens)
        .default(0)
        .interact()?;

    let token = match token_choice {
        0 => "native".to_string(),
        1 => "USDC".to_string(),
        _ => Input::with_theme(&theme)
            .with_prompt("Custom token contract address (G…)")
            .validate_with(validate_stellar_address)
            .interact_text()?,
    };

    // 3. Amount (in stroops)
    let amount_str: String = Input::with_theme(&theme)
        .with_prompt("Amount (in stroops, e.g. 10000000 = 1 XLM)")
        .validate_with(validate_positive_amount)
        .interact_text()?;
    let amount: i128 = amount_str.trim().parse()?;

    // 4. Order ID
    let order_id: String = Input::with_theme(&theme)
        .with_prompt("Order ID (unique, no spaces)")
        .validate_with(validate_order_id)
        .interact_text()?;

    // 5. Memo (optional)
    let memo: String = Input::with_theme(&theme)
        .with_prompt("Memo / reference (optional, press Enter to skip)")
        .allow_empty(true)
        .interact_text()?;

    // 6. Summary and confirmation
    println!();
    println!("┌──────────────────────────────────────────────────────────┐");
    println!("│                   Payment Summary                        │");
    println!("├──────────────────────────────────────────────────────────┤");
    println!("│  Order:    {:<46}│", order_id);
    println!("│  Merchant: {:<46}│", merchant);
    println!(
        "│  Amount:   {:<46}│",
        format!("{} stroops ({} XLM)", amount, amount as f64 / 10_000_000.0)
    );
    println!("│  Token:    {:<46}│", token);
    println!(
        "│  Memo:     {:<46}│",
        if memo.is_empty() { "(none)" } else { &memo }
    );
    println!("│  Network:  {:<46}│", network);
    println!("└──────────────────────────────────────────────────────────┘");
    println!();

    let confirmed = Confirm::with_theme(&theme)
        .with_prompt("Submit this payment?")
        .default(false)
        .interact()?;

    if !confirmed {
        println!("\nPayment cancelled.");
        return Ok(None);
    }

    Ok(Some(PaymentArgs {
        merchant,
        amount,
        order_id,
        memo,
        token,
    }))
}

// ── Payment execution (shared by interactive and flag-based paths) ────────────

fn execute_payment(args: &PaymentArgs, config: &Config) {
    println!("\nProcessing payment…");
    println!("  Order:    {}", args.order_id);
    println!("  Merchant: {}", args.merchant);
    println!(
        "  Amount:   {} stroops ({:.7} XLM)",
        args.amount,
        args.amount as f64 / 10_000_000.0
    );
    println!("  Token:    {}", args.token);
    if !args.memo.is_empty() {
        println!("  Memo:     {}", args.memo);
    }
    println!(
        "  Network:  {}",
        config.network.as_deref().unwrap_or("testnet")
    );

    // In a real implementation the contract call goes here.
    println!(
        "\n✅  Payment for order {} has been submitted.",
        args.order_id
    );
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let config = load_config(cli.config)?;

    match &cli.command {
        Commands::Pay {
            merchant,
            amount,
            order_id,
            memo,
            token,
        } => {
            // Decide between interactive and flag-based mode.
            // Enter interactive mode when no flags were provided at all.
            let all_flags_present = merchant.is_some() && amount.is_some() && order_id.is_some();
            let any_flag_present =
                merchant.is_some() || amount.is_some() || order_id.is_some();

            if !any_flag_present {
                // ── Interactive mode ─────────────────────────────────────────
                match run_interactive_pay(&config)? {
                    Some(args) => execute_payment(&args, &config),
                    None => {}
                }
            } else if all_flags_present {
                // ── Non-interactive (flag-based) mode — unchanged behaviour ──
                let args = PaymentArgs {
                    merchant: merchant.clone().unwrap(),
                    amount: amount.unwrap(),
                    order_id: order_id.clone().unwrap(),
                    memo: memo.clone().unwrap_or_default(),
                    token: token.clone().unwrap_or_else(|| "native".to_string()),
                };
                execute_payment(&args, &config);
            } else {
                // Partial flags: guide the user rather than silently failing.
                return Err(anyhow!(
                    "Provide either ALL of --merchant, --amount, --order-id \
                     (plus optional --memo and --token) for flag mode, \
                     or run `lumenflow pay` with NO flags to use interactive mode."
                ));
            }
        }

        Commands::Refund { action } => match action {
            RefundCommands::Init { order_id, amount } => {
                println!("Initiating refund of {} for order {}…", amount, order_id);
                println!(
                    "  Contract: {}",
                    config.contract_id.as_deref().unwrap_or("N/A")
                );
            }
        },

        Commands::History { merchant } => {
            println!("Fetching payment history for merchant {}…", merchant);
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_config_from_file() -> Result<()> {
        let temp_config = ".test_lumenflow_599.toml";
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

    // ── Validation unit tests ─────────────────────────────────────────────────

    #[test]
    fn test_validate_stellar_address_valid() {
        // 56-char address starting with G, all alphanumeric
        let addr = "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU".to_string();
        assert!(validate_stellar_address(&addr).is_ok());
    }

    #[test]
    fn test_validate_stellar_address_too_short() {
        let addr = "GSHORT".to_string();
        assert!(validate_stellar_address(&addr).is_err());
    }

    #[test]
    fn test_validate_stellar_address_wrong_prefix() {
        // 56 chars but starts with 'S' (secret key prefix)
        let addr = "SBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU".to_string();
        assert!(validate_stellar_address(&addr).is_err());
    }

    #[test]
    fn test_validate_positive_amount_valid() {
        assert!(validate_positive_amount(&"10000000".to_string()).is_ok());
    }

    #[test]
    fn test_validate_positive_amount_zero() {
        assert!(validate_positive_amount(&"0".to_string()).is_err());
    }

    #[test]
    fn test_validate_positive_amount_negative() {
        assert!(validate_positive_amount(&"-100".to_string()).is_err());
    }

    #[test]
    fn test_validate_positive_amount_non_numeric() {
        assert!(validate_positive_amount(&"abc".to_string()).is_err());
    }

    #[test]
    fn test_validate_order_id_valid() {
        assert!(validate_order_id(&"ORDER_001".to_string()).is_ok());
    }

    #[test]
    fn test_validate_order_id_empty() {
        assert!(validate_order_id(&"".to_string()).is_err());
    }

    #[test]
    fn test_validate_order_id_with_spaces() {
        assert!(validate_order_id(&"ORDER 001".to_string()).is_err());
    }
}
