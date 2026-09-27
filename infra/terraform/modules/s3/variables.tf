variable "bucket_name" {
  description = "Name of the S3 bucket"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "backup_lifecycle" {
  description = "Lifecycle policy for objects under the backup prefix"
  type = object({
    prefix         = string
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
