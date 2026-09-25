extern crate alloc;

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, String};

// ── Router error codes ────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RouterError {
    /// Merchant is not registered in the lumenflow contract.
    MerchantNotFound = 1,
    /// Merchant is registered but currently inactive (deactivated).
    MerchantNotActive = 2,
    /// The payment amount is zero or negative.
    InvalidAmount = 3,
    /// The specified token is not accepted by the target merchant's contract.
    TokenNotAllowed = 4,
    /// The lumenflow contract address has not been configured.
    ContractNotConfigured = 5,
}

// ── Route result ─────────────────────────────────────────────────────────────

/// Result returned by a successful route call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RouteResult {
    /// The merchant address the payment was routed to.
    pub merchant: Address,
    /// The token used for the payment.
    pub token: Address,
    /// The amount routed.
    pub amount: i128,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    LumenflowContract,
}

// ── Router contract ───────────────────────────────────────────────────────────

#[contract]
pub struct RouterContract;

#[contractimpl]
impl RouterContract {
    /// Configure the lumenflow contract address that this router delegates to.
    ///
    /// # Arguments
    /// * `lumenflow_contract` - Address of the deployed lumenflow payment contract.
    pub fn set_lumenflow_contract(env: Env, lumenflow_contract: Address) {
        env.storage()
            .instance()
            .set(&DataKey::LumenflowContract, &lumenflow_contract);
    }

    /// Retrieve the configured lumenflow contract address.
    pub fn get_lumenflow_contract(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::LumenflowContract)
    }

    /// Route a payment to an active merchant via the lumenflow contract.
    ///
    /// Validates that the merchant is registered and active before routing.
    ///
    /// # Arguments
    /// * `merchant` - Target merchant address.
    /// * `token`    - Token address for the payment.
    /// * `amount`   - Payment amount (must be positive).
    ///
    /// # Returns
    /// A [`RouteResult`] describing the routed payment on success.
    ///
    /// # Errors
    /// * [`RouterError::ContractNotConfigured`] — lumenflow contract address not set.
    /// * [`RouterError::MerchantNotFound`] — merchant is not registered.
    /// * [`RouterError::MerchantNotActive`] — merchant is registered but inactive.
    /// * [`RouterError::InvalidAmount`] — amount is not positive.
    pub fn route_payment(
        env: Env,
        merchant: Address,
        token: Address,
        amount: i128,
    ) -> Result<RouteResult, RouterError> {
        if amount <= 0 {
            return Err(RouterError::InvalidAmount);
        }

        let lumenflow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::LumenflowContract)
            .ok_or(RouterError::ContractNotConfigured)?;

        // Call lumenflow contract to check merchant status
        let client = lumenflow::PaymentProcessingContractClient::new(&env, &lumenflow_addr);

        // is_registered returns bool; if false merchant is not registered
        let registered = client.is_registered(&merchant);
        if !registered {
            return Err(RouterError::MerchantNotFound);
        }

        // get_merchant returns the merchant profile; check active flag
        let merchant_info = client.get_merchant(&merchant);
        if !merchant_info.active {
            return Err(RouterError::MerchantNotActive);
        }

        Ok(RouteResult {
            merchant,
            token,
            amount,
        })
    }
}
