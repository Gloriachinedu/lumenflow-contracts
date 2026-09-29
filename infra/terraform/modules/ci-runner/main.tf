###############################################################################
# Module: ci-runner – self-hosted GitHub Actions runner on EC2
###############################################################################

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_security_group" "runner" {
  name        = "lumenflow-ci-runner-${var.environment}"
  description = "Allow outbound HTTPS for the CI runner; no inbound"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS outbound"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP outbound (package mirrors)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "runner" {
  name = "lumenflow-ci-runner-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.runner.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

###############################################################################
# Least-privilege workflow policies (opt-in via variables)
###############################################################################

# --- Deploy workflow: write WASM artifacts to the deploy/ prefix only ---------
resource "aws_iam_policy" "deploy" {
  count       = var.artifacts_bucket_arn != "" ? 1 : 0
  name        = "lumenflow-ci-runner-deploy-${var.environment}"
  description = "Allows the CI runner to read/write only the deploy/ prefix of the artifacts bucket."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ArtifactWrite"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${var.artifacts_bucket_arn}/deploy/*"
      },
      {
        Sid      = "ArtifactList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.artifacts_bucket_arn
        Condition = {
          StringLike = { "s3:prefix" = ["deploy/*"] }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "deploy" {
  count      = var.artifacts_bucket_arn != "" ? 1 : 0
  role       = aws_iam_role.runner.name
  policy_arn = aws_iam_policy.deploy[0].arn
}

# --- Backup workflow: read/write the backup bucket only -----------------------
resource "aws_iam_policy" "backup" {
  count       = var.backup_bucket_arn != "" ? 1 : 0
  name        = "lumenflow-ci-runner-backup-${var.environment}"
  description = "Allows the CI runner to read/write the backup S3 bucket only."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BackupReadWrite"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${var.backup_bucket_arn}/*"
      },
      {
        Sid      = "BackupList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.backup_bucket_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  count      = var.backup_bucket_arn != "" ? 1 : 0
  role       = aws_iam_role.runner.name
  policy_arn = aws_iam_policy.backup[0].arn
}

# --- Terraform workflow: tfstate bucket + DynamoDB lock table only ------------
resource "aws_iam_policy" "terraform" {
  count       = var.tfstate_bucket_arn != "" ? 1 : 0
  name        = "lumenflow-ci-runner-terraform-${var.environment}"
  description = "Allows the CI runner to read/write Terraform remote state and acquire the DynamoDB state lock."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TfstateReadWrite"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.tfstate_bucket_arn, "${var.tfstate_bucket_arn}/*"]
      },
      {
        Sid    = "TfstateLock"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable"
        ]
        Resource = "arn:aws:dynamodb:*:*:table/lumenflow-tfstate-lock"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "terraform" {
  count      = var.tfstate_bucket_arn != "" ? 1 : 0
  role       = aws_iam_role.runner.name
  policy_arn = aws_iam_policy.terraform[0].arn
}

resource "aws_iam_instance_profile" "runner" {
  name = "lumenflow-ci-runner-${var.environment}"
  role = aws_iam_role.runner.name
}

resource "aws_instance" "runner" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.runner.id]
  iam_instance_profile   = aws_iam_instance_profile.runner.name
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size           = 40
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -euo pipefail
    apt-get update -y
    apt-get install -y curl jq unzip git build-essential

    # Install Rust
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source /root/.cargo/env
    rustup target add wasm32-unknown-unknown

    # GitHub Actions runner (latest release)
    RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest \
      | jq -r '.tag_name' | tr -d 'v')
    mkdir -p /opt/actions-runner && cd /opt/actions-runner
    curl -fsSL \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
      | tar -xz

    echo "Runner provisioned. Register with: ./config.sh --url <REPO_URL> --token <TOKEN>"
  EOF
  )

  tags = {
    Name = "lumenflow-ci-runner-${var.environment}"
  }
}
