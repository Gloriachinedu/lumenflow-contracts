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
| `alerts_topic_arn` | SNS topic ARN |
| `cloudwatch_log_group` | CloudWatch log group name |

---

## CI Integration

A `terraform plan` validation step runs automatically on every pull request that modifies files under `infra/terraform/**`. See `.github/workflows/ci.yml` for the workflow definition.

To give GitHub Actions permission to run `terraform plan`, add the following repository secrets:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user or role access key |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | Target region (e.g. `us-east-1`) |

Use a dedicated IAM user with a policy scoped to the resources in this module. Never use root credentials.

---

## Security Notes

- `terraform.tfvars` is listed in `.gitignore` — never commit it.  
- State is encrypted at rest in S3 (`AES256`) and in transit via HTTPS.  
- The CI runner IAM role follows least privilege — it only has read/write access to the artifact bucket.  
- Public access is blocked on the artifact bucket; use pre-signed URLs or CloudFront for distribution.
