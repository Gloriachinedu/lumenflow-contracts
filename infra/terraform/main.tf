terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # Remote state: S3 + DynamoDB locking
  # Before first use, create the bucket and table manually (or via bootstrap.sh),
  # then fill in the values below.
  backend "s3" {
    bucket         = "lumenflow-tfstate"
    key            = "lumenflow/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "lumenflow-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "lumenflow"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ─── Artifact Storage ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "artifacts" {
  bucket = "lumenflow-artifacts-${var.environment}"
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-nightly-builds"
    status = "Enabled"

    filter {
      prefix = "nightly/"
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "expire-pr-previews"
    status = "Enabled"

    filter {
      prefix = "pr-preview/"
    }

    expiration {
      days = 14
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Terraform State Locking ─────────────────────────────────────────────────

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "lumenflow-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# ─── CI Runner (self-hosted, optional) ───────────────────────────────────────

resource "aws_iam_role" "ci_runner" {
  name = "lumenflow-ci-runner-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ci_runner_s3" {
  name = "ci-runner-s3-access"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ci_runner" {
  name = "lumenflow-ci-runner-${var.environment}"
  role = aws_iam_role.ci_runner.name
}

resource "aws_security_group" "ci_runner" {
  name        = "lumenflow-ci-runner-${var.environment}"
  description = "Security group for LumenFlow CI runner"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }
}

resource "aws_instance" "ci_runner" {
  count = var.enable_self_hosted_runner ? 1 : 0

  ami                    = var.ci_runner_ami
  instance_type          = var.ci_runner_instance_type
  iam_instance_profile   = aws_iam_instance_profile.ci_runner.name
  vpc_security_group_ids = [aws_security_group.ci_runner.id]
  subnet_id              = var.subnet_id

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 50
    delete_on_termination = true
    encrypted             = true
  }

  user_data = base64encode(templatefile("${path.module}/templates/runner-init.sh.tpl", {
    github_token = var.github_runner_token
    github_repo  = var.github_repo
    runner_name  = "lumenflow-runner-${var.environment}"
  }))

  tags = {
    Name = "lumenflow-ci-runner-${var.environment}"
  }
}

# ─── Monitoring Stack ─────────────────────────────────────────────────────────

# CloudWatch log group for LumenFlow application logs
resource "aws_cloudwatch_log_group" "lumenflow" {
  name              = "/lumenflow/${var.environment}"
  retention_in_days = 30
}

# SNS topic for CI and monitoring alerts
resource "aws_sns_topic" "alerts" {
  name = "lumenflow-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "slack_alerts" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudWatch alarm: high error rate (placeholder — replace with real metric)
resource "aws_cloudwatch_metric_alarm" "high_error_rate" {
  alarm_name          = "lumenflow-high-error-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "LumenFlow/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "LumenFlow error rate exceeded threshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  treat_missing_data = "notBreaching"
}
