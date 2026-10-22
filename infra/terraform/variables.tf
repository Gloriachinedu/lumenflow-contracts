variable "aws_region" {
  description = "AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod"
  }
}

variable "backup_lifecycle" {
  description = "Lifecycle policy for objects under the backup prefix"
  type = object({
    prefix          = string
    transition_days = number
    expiration_days = number
  })
  default = {
    prefix          = "backups/"
    transition_days = 30
    expiration_days = 365
  }

  validation {
    condition = (
      var.backup_lifecycle.transition_days > 0 &&
      var.backup_lifecycle.expiration_days > var.backup_lifecycle.transition_days
    )
    error_message = "Backup expiration must be greater than the positive Glacier transition age."
  }
}

variable "vpc_id" {
  description = "VPC ID where the CI runner security group will be created"
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Subnet ID for the CI runner EC2 instance"
  type        = string
  default     = ""
}

variable "enable_self_hosted_runner" {
  description = "Whether to provision a self-hosted GitHub Actions runner EC2 instance"
  type        = bool
  default     = false
}

variable "ci_runner_ami" {
  description = "AMI ID for the CI runner instance (Ubuntu 22.04 recommended)"
  type        = string
  default     = "ami-0c7217cdde317cfec" # Ubuntu 22.04 LTS us-east-1 — update per region
}

variable "ci_runner_instance_type" {
  description = "EC2 instance type for the CI runner"
  type        = string
  default     = "t3.medium"
}

variable "github_runner_token" {
  description = "GitHub Actions runner registration token (sensitive)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format"
  type        = string
  default     = "Gloriachinedu/lumenflow-contracts"
}

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications (leave empty to skip)"
  type        = string
  default     = ""
}

# ─── Budget alerts ────────────────────────────────────────────────────────────

variable "monthly_budget_usd" {
  description = "Monthly AWS cost budget in USD. Alerts fire at 80 % (forecasted) and 100 % (actual)."
  type        = number
  default     = 100

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be a positive number."
  }
}

variable "ops_alert_email" {
  description = "E-mail address that receives budget threshold alerts. Leave empty to skip e-mail notifications."
  type        = string
  default     = ""
}

variable "alert_sns_topic_arn" {
  description = "SNS topic ARN for budget alerts (e.g. connected to Slack via AWS Chatbot). Leave empty to skip SNS notifications."
  type        = string
  default     = ""
}
