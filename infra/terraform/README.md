# LumenFlow — Terraform Infrastructure

Terraform configuration for all LumenFlow cloud resources:
- **S3 bucket** — artifact storage for WASM builds, nightly CLI binaries, and PR preview archives  
- **DynamoDB table** — Terraform state locking  
- **EC2 instance** (optional) — self-hosted GitHub Actions runner  
- **IAM roles & policies** — least-privilege access for CI runner  
- **CloudWatch** — log group and high-error-rate alarm  
- **SNS topic** — alert delivery (email; extend to Slack / PagerDuty as needed)

---

## State Locking

LumenFlow uses **S3 remote state with DynamoDB locking** to prevent concurrent Terraform runs from corrupting the state file.

### How it works

| Component | Resource | Purpose |
|-----------|----------|---------|
| S3 bucket | `lumenflow-tfstate` | Stores the `terraform.tfstate` file, versioned and encrypted at rest |
| DynamoDB table | `lumenflow-tfstate-lock` | Holds the distributed lock — only one `terraform apply` can proceed at a time |

The backend block in `main.tf` configures both:

```hcl
backend "s3" {
  bucket         = "lumenflow-tfstate"
  key            = "lumenflow/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "lumenflow-tfstate-lock"
  encrypt        = true
}
```

The `aws_dynamodb_table.tfstate_lock` resource in `main.tf` provisions the lock table automatically on the first `terraform apply`. Until then, bootstrap it manually (see the one-time bootstrap section below).

### Concurrent CI protection

Both `terraform-plan.yml` and `terraform-drift.yml` set:

```yaml
concurrency:
  group: terraform-${{ github.ref }}
  cancel-in-progress: false
```

This means GitHub Actions queues workflow runs rather than running them in parallel. Even if two runs start simultaneously, Terraform's DynamoDB lock provides a second layer of protection — the second run will wait up to the lock timeout before failing with a clear error message.

### Troubleshooting a stuck lock

If a CI run was cancelled mid-apply and left a lock in DynamoDB, release it manually:

```bash
# List existing locks
aws dynamodb scan \
  --table-name lumenflow-tfstate-lock \
  --region us-east-1

# Force-unlock (replace LOCK_ID with the value from the scan above)
cd infra/terraform
terraform force-unlock LOCK_ID
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Terraform | ≥ 1.6.0 | https://developer.hashicorp.com/terraform/install |
| AWS CLI | ≥ 2 | https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html |
| AWS credentials | — | `aws configure` or environment variables |

---

## One-time bootstrap (remote state bucket)

Before running `terraform init` for the first time, create the S3 bucket and DynamoDB table for Terraform state:

```bash
# Create the state bucket (versioning enabled)
aws s3api create-bucket \
  --bucket lumenflow-tfstate \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket lumenflow-tfstate \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket lumenflow-tfstate \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create the DynamoDB lock table
aws dynamodb create-table \
  --table-name lumenflow-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

## Usage

### 1. Configure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

### 2. Initialise

```bash
terraform init
```

### 3. Preview changes

```bash
terraform plan
```

### 4. Apply

```bash
terraform apply
```

Terraform prints a summary of changes and prompts for confirmation before making any changes.

### 5. Destroy all resources

```bash
terraform destroy
```

> ⚠️  This permanently deletes all managed resources, including the artifact S3 bucket and its contents. Confirm you have backups before running.

---

## Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `aws_region` | AWS region | `us-east-1` |
| `environment` | `dev` / `staging` / `prod` | `dev` |
| `vpc_id` | VPC for CI runner SG | `""` |
| `subnet_id` | Subnet for CI runner | `""` |
| `enable_self_hosted_runner` | Provision EC2 runner | `false` |
| `ci_runner_instance_type` | Runner EC2 type | `t3.medium` |
| `ci_runner_ami` | Runner AMI | Ubuntu 22.04 us-east-1 |
| `github_runner_token` | Runner registration token | `""` (sensitive) |
| `github_repo` | owner/repo for runner | `Gloriachinedu/lumenflow-contracts` |
| `alert_email` | SNS alert recipient | `""` |

---

## Outputs

| Output | Description |
|--------|-------------|
| `artifacts_bucket_name` | S3 bucket name for artifacts |
| `artifacts_bucket_arn` | S3 bucket ARN |
| `tfstate_lock_table_name` | DynamoDB lock table name |
| `ci_runner_instance_id` | EC2 runner instance ID |
| `ci_runner_role_arn` | IAM role ARN for runner |
| `github_actions_role_arn` | IAM role ARN for GitHub Actions OIDC |
| `alerts_topic_arn` | SNS topic ARN |
| `cloudwatch_log_group` | CloudWatch log group name |

---

## CI Integration

Terraform plans run on trusted pushes to `main` or `develop`. Pull requests run
format and validation checks without AWS credentials or remote state.

The `github-oidc.tf` resources create the GitHub Actions OIDC provider and a
scoped IAM role. After applying Terraform, set the repository's non-secret
`AWS_ROLE_ARN` variable to the value of
`terraform output -raw github_actions_role_arn`. The role trusts only this
repository's `main` and `develop` branches. Remove the old
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` repository secrets
after trusted workflows succeed with OIDC. The role ARN itself is not secret.

---

## Security Notes

- `terraform.tfvars` is listed in `.gitignore` — never commit it.  
- State is encrypted at rest in S3 (`AES256`) and in transit via HTTPS.  
- The CI runner IAM role follows least privilege — it only has read/write access to the artifact bucket.  
- Public access is blocked on the artifact bucket; use pre-signed URLs or CloudFront for distribution.

---

## CI Runner IAM — Least-Privilege Policy Design

The CI runner EC2 instance uses an IAM role with the minimum permissions required for each workflow type. Policies are **opt-in**: each is only created when the corresponding bucket ARN variable is set. This prevents attaching any policy that isn't needed for your deployment.

### Always-attached policy

| Policy | Purpose |
|--------|---------|
| `AmazonSSMManagedInstanceCore` (AWS managed) | Session Manager access for instance troubleshooting; no SSH key required |

### Workflow-scoped policies (opt-in)

| Variable | Policy created | Allowed actions | Scope |
|----------|---------------|-----------------|-------|
| `artifacts_bucket_arn` | `lumenflow-ci-runner-deploy-<env>` | `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` | `deploy/*` prefix only |
| `backup_bucket_arn` | `lumenflow-ci-runner-backup-<env>` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` | Entire backup bucket |
| `tfstate_bucket_arn` | `lumenflow-ci-runner-terraform-<env>` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on tfstate bucket; `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem`, `dynamodb:DescribeTable` on `lumenflow-tfstate-lock` table | Tfstate bucket + lock table only |

### Enabling the policies

Pass the bucket ARNs as module inputs in your root `main.tf`:

```hcl
module "ci_runner" {
  source = "./modules/ci-runner"

  environment   = var.environment
  vpc_id        = var.vpc_id
  subnet_id     = var.subnet_id
  instance_type = "t3.medium"

  # Enable workflow-scoped IAM policies
  artifacts_bucket_arn = module.s3.artifacts_bucket_arn
  backup_bucket_arn    = module.s3.backup_bucket_arn
  tfstate_bucket_arn   = "arn:aws:s3:::lumenflow-tfstate"
}
```

Leave any variable as `""` (the default) to skip that policy entirely.

### What was removed

Previously, the runner had no explicit workflow permissions beyond `AmazonSSMManagedInstanceCore`. Integrators were expected to attach broader policies manually. This update replaces that practice with narrowly scoped policies defined in code, reviewable in PRs, and auditable via CloudTrail.
