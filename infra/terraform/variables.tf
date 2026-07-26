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
