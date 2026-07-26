###############################################################################
# Outputs
###############################################################################

output "artifact_bucket_name" {
  description = "Name of the S3 bucket used for CI/CD artifacts"
  value       = module.artifacts.bucket_name
}

output "artifact_bucket_arn" {
  description = "ARN of the artifact S3 bucket"
  value       = module.artifacts.bucket_arn
}

output "ci_runner_instance_id" {
  description = "EC2 instance ID of the self-hosted CI runner"
  value       = module.ci_runner.instance_id
}

output "ci_runner_public_ip" {
  description = "Public IP of the CI runner (empty if launched in a private subnet)"
  value       = module.ci_runner.public_ip
}

output "cloudwatch_dashboard_url" {
  description = "URL of the CloudWatch monitoring dashboard"
  value       = module.monitoring.dashboard_url
}

output "sns_alert_topic_arn" {
  description = "ARN of the SNS topic used for CloudWatch alerts"
  value       = module.monitoring.sns_topic_arn
}
