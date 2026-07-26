###############################################################################
# Module: s3 – artifact storage bucket
###############################################################################

resource "aws_s3_bucket" "artifacts" {
  bucket        = var.bucket_name
  force_destroy = var.environment != "prod"
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

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Auto-delete nightly build artifacts after 7 days; keep release artifacts for 90 days
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
    id     = "expire-release-artifacts"
    status = "Enabled"

    filter {
      prefix = "releases/"
    }

    expiration {
      days = 90
    }
  }
}
