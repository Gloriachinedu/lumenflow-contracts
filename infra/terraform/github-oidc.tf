data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name                 = "lumenflow-github-actions-${var.environment}"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = [
              "repo:${var.github_repo}:ref:refs/heads/main",
              "repo:${var.github_repo}:ref:refs/heads/develop"
            ]
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "lumenflow-github-actions-scoped-access"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadInfrastructureForTerraformPlan"
        Effect = "Allow"
        Action = [
          "cloudwatch:Describe*",
          "cloudwatch:Get*",
          "dynamodb:Describe*",
          "ec2:Describe*",
          "iam:Get*",
          "iam:List*",
          "sns:Get*",
          "sns:List*",
          "sts:GetCallerIdentity"
        ]
        Resource = "*"
      },
      {
        Sid    = "ReadTerraformAndArtifactBuckets"
        Effect = "Allow"
        Action = [
          "s3:Get*",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::lumenflow-tfstate",
          "arn:aws:s3:::lumenflow-terraform-state",
          aws_s3_bucket.artifacts.arn,
          "arn:aws:s3:::lumenflow-artifacts-prod"
        ]
      },
      {
        Sid    = "ManageTerraformState"
        Effect = "Allow"
        Action = [
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::lumenflow-tfstate/*",
          "arn:aws:s3:::lumenflow-terraform-state/*"
        ]
      },
      {
        Sid    = "ManageTerraformStateLocks"
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/lumenflow-tfstate-lock",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/lumenflow-terraform-locks"
        ]
      },
      {
        Sid      = "UploadNightlyCliArtifacts"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["arn:aws:s3:::lumenflow-artifacts-prod/nightly/*"]
      }
    ]
  })
}