# LumenFlow Infrastructure – Terraform

Terraform configuration for all LumenFlow cloud resources: artifact storage, CI runner, and monitoring.

---

## Directory layout

```
infra/terraform/
├── main.tf                    # Root module – wires together all child modules
├── variables.tf               # Input variable definitions
├── outputs.tf                 # Root outputs
├── terraform.tfvars.example   # Copy → terraform.tfvars, fill in values
├── .gitignore                 # Excludes state, plan files, and tfvars
└── modules/
    ├── s3/                    # Artifact S3 bucket
    ├── ci-runner/             # Self-hosted GitHub Actions runner (EC2)
    └── monitoring/            # CloudWatch dashboard + SNS alerts
```

---

## What gets provisioned

| Resource | Module | Purpose |
|---|---|---|
| S3 bucket (`lumenflow-<env>-artifacts`) | `s3` | Stores CI/CD build artifacts; nightly builds expire after 7 days |
| EC2 instance | `ci-runner` | Ubuntu 22.04 self-hosted runner pre-installed with Rust and the Actions runner agent |
| CloudWatch Log Group | `monitoring` | Application log retention (30 days) |
| CloudWatch Dashboard | `monitoring` | CPU, S3 object count, recent log widget |
| SNS Topic + subscriptions | `monitoring` | Email (and optional Slack) alerts |

---

## Prerequisites

| Tool | Version |
|---|---|
| [Terraform](https://developer.hashicorp.com/terraform/install) | ≥ 1.6 |
| AWS CLI | ≥ 2 |
| AWS credentials | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or an IAM role |

---

## Bootstrap (first-time only)

The S3 remote backend and DynamoDB lock table must exist before running `terraform init`.
Create them once:

```bash
# Create state bucket
aws s3api create-bucket \
  --bucket lumenflow-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket lumenflow-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket lumenflow-terraform-state \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create DynamoDB lock table
aws dynamodb create-table \
  --table-name lumenflow-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

## Usage

### 1. Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

### 2. Initialise

```bash
terraform init
```

### 3. Plan

```bash
terraform plan
```

### 4. Apply

```bash
terraform apply
```

### 5. Destroy

```bash
terraform destroy
```

`terraform destroy` tears down **all** resources provisioned by this configuration, including the artifact bucket (which has `force_destroy = true` in non-prod environments). **In `prod`, the bucket has `force_destroy = false`** — empty it first.

---

## CI integration

`.github/workflows/terraform.yml` runs `terraform fmt`, `terraform validate`, and `terraform plan` on every PR that touches `infra/terraform/`. The plan output is posted as a PR comment.

### Required repository secrets

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key with permissions to plan/apply |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `TF_CI_RUNNER_SUBNET_ID` | Subnet for the EC2 runner instance |
| `TF_VPC_ID` | VPC for the runner security group |
| `TF_ALERT_EMAIL` | Email for CloudWatch alarm notifications |
| `TF_SLACK_WEBHOOK_URL` | (Optional) Slack webhook for alerts |

---

## State management

Remote state is stored in S3 (`lumenflow-terraform-state`) with DynamoDB locking (`lumenflow-terraform-locks`). State is encrypted at rest. Never commit `.tfstate` files.

---

## Security notes

- The CI runner EC2 instance has **no inbound rules** – it communicates outbound only.
- Access for SSH/debugging is via **AWS Systems Manager Session Manager** (SSM) — no public SSH port needed.
- S3 bucket public access is fully blocked.
- All resources are tagged with `Project`, `Environment`, and `ManagedBy=terraform`.
