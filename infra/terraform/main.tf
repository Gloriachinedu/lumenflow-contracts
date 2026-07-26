###############################################################################
# LumenFlow – Root Terraform configuration
# Provisions: artifact S3 bucket, CI runner, monitoring stack, remote backend
###############################################################################

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # Remote state – S3 + DynamoDB locking
  # Bootstrap: create the state bucket/table once manually (or via bootstrap.sh),
  # then initialise with: terraform init -backend-config=backend.hcl
  backend "s3" {
    bucket         = "lumenflow-terraform-state"
    key            = "lumenflow/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "lumenflow-terraform-locks"
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

###############################################################################
# Modules
###############################################################################

module "artifacts" {
  source      = "./modules/s3"
  bucket_name = "${var.project}-${var.environment}-artifacts"
  environment = var.environment
}

module "ci_runner" {
  source        = "./modules/ci-runner"
  environment   = var.environment
  instance_type = var.ci_runner_instance_type
  subnet_id     = var.ci_runner_subnet_id
  vpc_id        = var.vpc_id
  key_name      = var.ec2_key_name
}

module "monitoring" {
  source       = "./modules/monitoring"
  environment  = var.environment
  project      = var.project
  alert_email  = var.alert_email
  slack_webhook_url = var.slack_webhook_url
}
