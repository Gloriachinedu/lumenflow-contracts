output "artifacts_bucket_name" {
  description = "Name of the S3 bucket used for build artifacts"
  value       = aws_s3_bucket.artifacts.id
}

output "artifacts_bucket_arn" {
  description = "ARN of the S3 artifacts bucket"
  value       = aws_s3_bucket.artifacts.arn
}

output "tfstate_lock_table_name" {
  description = "DynamoDB table name used for Terraform state locking"
  value       = aws_dynamodb_table.tfstate_lock.name
}

output "ci_runner_instance_id" {
  description = "EC2 instance ID of the self-hosted CI runner (empty if disabled)"
  value       = var.enable_self_hosted_runner ? aws_instance.ci_runner[0].id : ""
}

output "ci_runner_role_arn" {
  description = "IAM role ARN for the CI runner"
  value       = aws_iam_role.ci_runner.arn
}

output "alerts_topic_arn" {
  description = "SNS topic ARN for monitoring alerts"
  value       = aws_sns_topic.alerts.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name for LumenFlow application logs"
  value       = aws_cloudwatch_log_group.lumenflow.name
}
