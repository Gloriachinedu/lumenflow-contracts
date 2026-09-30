variable "environment"   { type = string }
variable "instance_type" { type = string }
variable "subnet_id"     { type = string }
variable "vpc_id"        { type = string }
variable "key_name"      { type = string; default = "" }

# Workflow-scoped IAM policy inputs (optional — leave empty to skip the policy)
variable "artifacts_bucket_arn" {
  description = "ARN of the S3 bucket for CI build artifacts (enables the deploy workflow IAM policy)."
  type        = string
  default     = ""
}

variable "backup_bucket_arn" {
  description = "ARN of the S3 bucket for backups (enables the backup workflow IAM policy)."
  type        = string
  default     = ""
}

variable "tfstate_bucket_arn" {
  description = "ARN of the S3 bucket for Terraform remote state (enables the terraform workflow IAM policy)."
  type        = string
  default     = ""
}
