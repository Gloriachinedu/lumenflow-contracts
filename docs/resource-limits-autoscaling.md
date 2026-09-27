# Resource Limits and Autoscaling for API Workloads

This document defines the resource limits, requests, and autoscaling policies for
LumenFlow API workloads running on the CI/CD infrastructure and any container-based
deployment environments.

---

## Overview

LumenFlow's API workloads include:

- The smoke test runner (GitHub Actions / self-hosted runners)
- The monitoring exporter (`monitoring/lumenflow_exporter.py`)
- The webhook relay server (`webhook/webhook-server.js`)
- The frontend dev server (`scripts/dev.sh`)

Resource limits prevent runaway jobs from starving other workloads and ensure
predictable cost and performance in shared infrastructure.

---

## GitHub Actions: Job-level Resource Constraints

### Concurrency limits

To avoid overwhelming the Stellar RPC endpoints and to prevent duplicate deployments,
all workflows that deploy or run smoke tests enforce a concurrency group:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This ensures at most one active run per branch for each workflow. A new push
cancels any in-progress run on the same branch.

### Timeout limits

All jobs should declare an explicit `timeout-minutes` to prevent hung jobs from
consuming runner minutes indefinitely:

| Workload | Recommended timeout |
|---|---|
| CI (lint + test + WASM build) | 30 minutes |
| Testnet deploy + smoke test | 20 minutes |
| Terraform plan | 15 minutes |
| Canary deploy | 20 minutes |
| Load test | 60 minutes |
| Rollback verification | 10 minutes |

Example:

```yaml
jobs:
  deploy:
    name: Deploy + Smoke Test
    runs-on: ubuntu-latest
    timeout-minutes: 20
```

---

## Self-hosted Runner: EC2 Instance Resource Limits

The optional self-hosted CI runner is defined in `infra/terraform/main.tf`.
The following constraints apply:

### Instance sizing

| Environment | Instance type | vCPU | Memory |
|---|---|---|---|
| `dev` / `testnet` | `t3.medium` | 2 | 4 GiB |
| `mainnet` / staging | `t3.large` | 2 | 8 GiB |

The instance type is controlled by the `ci_runner_instance_type` Terraform variable
in `infra/terraform/variables.tf`.

### Disk

The root EBS volume is set to **50 GiB gp3** (see `main.tf`). This is sufficient
for Rust build caches, WASM outputs, and smoke test artefacts.

### Autoscaling policy

For high-throughput scenarios (e.g., PR surge or nightly matrix builds), an
Auto Scaling Group (ASG) can be used instead of a single instance. The Terraform
module supports this via the `enable_self_hosted_runner` variable.

Recommended scaling policy:

| Metric | Scale-out threshold | Scale-in threshold | Cooldown |
|---|---|---|---|
| CPU utilisation | > 70% for 5 min | < 30% for 10 min | 300 s |
| Pending job queue depth | > 3 jobs | 0 jobs | 120 s |

Minimum instances: **1** (keep one warm to avoid cold-start latency on PRs).
Maximum instances: **4** (cap cost during unexpected spikes).

---

## Terraform: Autoscaling Group Configuration

Add the following to `infra/terraform/main.tf` to enable autoscaling for the CI runner:

```hcl
resource "aws_launch_template" "ci_runner" {
  name_prefix   = "lumenflow-ci-runner-${var.environment}-"
  image_id      = var.ci_runner_ami
  instance_type = var.ci_runner_instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.ci_runner.name
  }

  vpc_security_group_ids = [aws_security_group.ci_runner.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 50
      delete_on_termination = true
      encrypted             = true
    }
  }

  user_data = base64encode(templatefile(
    "${path.module}/templates/runner-init.sh.tpl",
    {
      github_token = var.github_runner_token
      github_repo  = var.github_repo
      runner_name  = "lumenflow-runner-${var.environment}"
    }
  ))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "lumenflow-ci-runner-${var.environment}"
      Environment = var.environment
    }
  }
}

resource "aws_autoscaling_group" "ci_runner" {
  count = var.enable_self_hosted_runner ? 1 : 0

  name                = "lumenflow-ci-runner-${var.environment}"
  min_size            = 1
  max_size            = 4
  desired_capacity    = 1
  vpc_zone_identifier = [var.subnet_id]

  launch_template {
    id      = aws_launch_template.ci_runner.id
    version = "$Latest"
  }

  health_check_type         = "EC2"
  health_check_grace_period = 120

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_policy" "ci_runner_scale_out" {
  count = var.enable_self_hosted_runner ? 1 : 0

  name                   = "lumenflow-ci-scale-out-${var.environment}"
  autoscaling_group_name = aws_autoscaling_group.ci_runner[0].name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 1
  cooldown               = 300
}

resource "aws_autoscaling_policy" "ci_runner_scale_in" {
  count = var.enable_self_hosted_runner ? 1 : 0

  name                   = "lumenflow-ci-scale-in-${var.environment}"
  autoscaling_group_name = aws_autoscaling_group.ci_runner[0].name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = -1
  cooldown               = 300
}

resource "aws_cloudwatch_metric_alarm" "ci_runner_cpu_high" {
  count = var.enable_self_hosted_runner ? 1 : 0

  alarm_name          = "lumenflow-ci-cpu-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "Scale out CI runners when CPU > 70% for 10 min"
  alarm_actions       = [aws_autoscaling_policy.ci_runner_scale_out[0].arn]

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.ci_runner[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "ci_runner_cpu_low" {
  count = var.enable_self_hosted_runner ? 1 : 0

  alarm_name          = "lumenflow-ci-cpu-low-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 4
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 30
  alarm_description   = "Scale in CI runners when CPU < 30% for 20 min"
  alarm_actions       = [aws_autoscaling_policy.ci_runner_scale_in[0].arn]

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.ci_runner[0].name
  }
}
```

---

## Workflow: Enforcing Resource Limits in CI

The `.github/workflows/ci.yml` and related workflows should include:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    concurrency:
      group: ci-${{ github.ref }}
      cancel-in-progress: true
```

And for the deploy workflow (`.github/workflows/deploy-testnet.yml`):

```yaml
concurrency:
  group: deploy-testnet-${{ github.ref }}
  cancel-in-progress: false   # never cancel an in-progress deploy
```

> **Note:** `cancel-in-progress: false` is intentional for deploy jobs. Cancelling
> a deploy mid-flight can leave the contract in an indeterminate state.

---

## Monitoring Resource Usage

CloudWatch metrics to monitor for the CI runner ASG:

| Metric | Namespace | Alarm threshold |
|---|---|---|
| `CPUUtilization` | `AWS/EC2` | > 70% → scale out |
| `DiskWriteBytes` | `AWS/EC2` | > 100 MB/s sustained |
| `NetworkOut` | `AWS/EC2` | Alert if > 1 GB in 5 min |

The existing `aws_cloudwatch_metric_alarm.high_error_rate` resource in `main.tf`
covers application-level errors. The above resources cover the runner infrastructure itself.

---

## Boundary Cases and Failure Handling

| Scenario | Behaviour |
|---|---|
| Job exceeds `timeout-minutes` | GitHub Actions kills the job; Slack notification fires via existing `deploy-testnet.yml` failure path |
| ASG fails to launch a new instance | CloudWatch alarm remains active; on-call receives SNS alert |
| All runners busy (queue depth > 3) | Scale-out policy adds a runner within one cooldown period (5 min) |
| Scale-out fails (AWS quota hit) | SNS alert fires; existing single runner continues processing jobs |
| Max instances (4) reached | New jobs queue; no additional scale-out; alarm fires at > 10 min queue depth |

---

## References

- `infra/terraform/main.tf` — CI runner and CloudWatch alarm resources
- `infra/terraform/variables.tf` — `ci_runner_instance_type`, `enable_self_hosted_runner`
- `.github/workflows/deploy-testnet.yml` — Deploy + smoke test workflow
- `docs/monitoring.md` — Application-level monitoring
- `docs/budget-thresholds.md` — Cost alert thresholds
