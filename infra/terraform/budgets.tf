# budgets.tf — AWS Budget alerts for cost anomaly detection.
#
# Creates one monthly budget per environment with threshold alerts at 80 %
# (forecasted) and 100 % (actual) of the configured spend limit. Alert
# notifications are sent to the ops e-mail address and, optionally, to a
# Slack channel via SNS → Chatbot integration.
#
# See docs/budget-thresholds.md for background on the budget policy.

# ─── Budget ──────────────────────────────────────────────────────────────────

resource "aws_budgets_budget" "monthly" {
  name         = "lumenflow-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # ── Alert at 80 % of the forecasted spend ──────────────────────────────────
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"

    subscriber_email_addresses = compact([var.ops_alert_email])
    subscriber_sns_topic_arns  = compact([var.alert_sns_topic_arn])
  }

  # ── Alert at 100 % of the actual spend ─────────────────────────────────────
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"

    subscriber_email_addresses = compact([var.ops_alert_email])
    subscriber_sns_topic_arns  = compact([var.alert_sns_topic_arn])
  }
}
