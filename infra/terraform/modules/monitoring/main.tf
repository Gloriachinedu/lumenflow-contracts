###############################################################################
# Module: monitoring – CloudWatch dashboard + SNS alerts
###############################################################################

# SNS topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-${var.environment}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Optional Slack Lambda forwarder
resource "aws_sns_topic_subscription" "slack" {
  count     = var.slack_webhook_url != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = var.slack_webhook_url
}

# CloudWatch Log Group for application logs
resource "aws_cloudwatch_log_group" "app" {
  name              = "/lumenflow/${var.environment}/app"
  retention_in_days = 30
}

# Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project}-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "CI Runner CPU Utilisation"
          period = 300
          stat   = "Average"
          metrics = [
            ["AWS/EC2", "CPUUtilization", { label = "Runner CPU %" }]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "S3 Artifact Bucket – Number of Objects"
          period = 86400
          stat   = "Average"
          metrics = [
            ["AWS/S3", "NumberOfObjects", "StorageType", "AllStorageTypes",
              { label = "Artifact count" }]
          ]
        }
      },
      {
        type = "log"
        properties = {
          title   = "Recent Application Logs"
          query   = "SOURCE '/lumenflow/${var.environment}/app' | fields @timestamp, @message | sort @timestamp desc | limit 50"
          region  = "us-east-1"
          view    = "table"
        }
      }
    ]
  })
}

# High CPU alarm for CI runner
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${var.project}-${var.environment}-runner-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "CI runner CPU > 85% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
