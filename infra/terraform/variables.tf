###############################################################################
# Input variables
###############################################################################

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name prefix used in resource names"
  type        = string
  default     = "lumenflow"
}

variable "environment" {
  description = "Deployment environment (dev | staging | prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "ci_runner_instance_type" {
  description = "EC2 instance type for the self-hosted CI runner"
  type        = string
  default     = "t3.medium"
}

variable "ci_runner_subnet_id" {
  description = "Subnet ID in which the CI runner instance is launched"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for security group attachment"
  type        = string
}

variable "ec2_key_name" {
  description = "Name of an existing EC2 key pair for SSH access to the runner"
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email address that receives CloudWatch alarm notifications"
  type        = string
}

variable "slack_webhook_url" {
  description = "Slack incoming-webhook URL for CI alert notifications"
  type        = string
  sensitive   = true
  default     = ""
}
