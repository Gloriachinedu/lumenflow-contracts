/// Refund invariants for LumenFlow.
///
/// This module defines pure functions that express the invariants that must
/// hold across all partial-refund sequences. These functions are used both
/// as documentation and as the oracle in property-based tests (`prop_tests.rs`).

/// Invariant 1: The cumulative amount of all *executed* refunds must never
/// exceed the original payment amount.
///
/// # Arguments
/// * `original_amount` – the amount charged in the original payment (positive).
/// * `executed_refunds` – slice of individual executed refund amounts.
///
/// # Returns
/// `true` if the invariant holds.
pub fn cumulative_refunds_within_original(original_amount: i128, executed_refunds: &[i128]) -> bool {
    let total: i128 = executed_refunds.iter().sum();
    total >= 0 && total <= original_amount
}

/// Invariant 2: Every individual refund amount must be strictly positive.
///
/// # Arguments
/// * `executed_refunds` – slice of individual executed refund amounts.
///
/// # Returns
/// `true` if every refund is positive.
pub fn all_refunds_positive(executed_refunds: &[i128]) -> bool {
    executed_refunds.iter().all(|&r| r > 0)
}

/// Invariant 3: After a sequence of partial refunds, the remaining refundable
/// amount must be non-negative.
///
/// # Arguments
/// * `original_amount` – the original payment amount.
/// * `executed_refunds` – slice of individual executed refund amounts.
///
/// # Returns
/// The remaining refundable amount, or `None` if the invariant is violated.
pub fn remaining_refundable(original_amount: i128, executed_refunds: &[i128]) -> Option<i128> {
    let total: i128 = executed_refunds.iter().sum();
    let remaining = original_amount.checked_sub(total)?;
    if remaining >= 0 {
        Some(remaining)
    } else {
        None
    }
}

/// Invariant 4: The sum of all partial refund amounts across all possible
/// orderings equals the same total (commutativity).
///
/// # Arguments
/// * `executed_refunds` – slice of individual executed refund amounts.
///
/// # Returns
/// The total refunded amount regardless of order.
pub fn refund_total_is_order_independent(executed_refunds: &[i128]) -> i128 {
    executed_refunds.iter().sum()
}
