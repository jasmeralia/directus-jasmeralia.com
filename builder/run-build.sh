#!/usr/bin/env bash
set -euo pipefail

ASTRO_DIR="${ASTRO_DIR:-/work/site}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-}"
INVALIDATE_ON_PUBLISH="${INVALIDATE_ON_PUBLISH:-true}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"

if [[ -z "$AWS_S3_BUCKET" ]]; then
  echo "ERROR: AWS_S3_BUCKET is not set"
  exit 2
fi
if [[ -z "$AWS_REGION" ]]; then
  echo "ERROR: AWS_REGION is not set"
  exit 2
fi
if [[ ! -d "$ASTRO_DIR" ]]; then
  echo "ERROR: ASTRO_DIR does not exist: $ASTRO_DIR"
  exit 2
fi
if [[ ! -f "$ASTRO_DIR/package.json" ]]; then
  echo "ERROR: package.json not found in ASTRO_DIR ($ASTRO_DIR). Mount your Astro project at ./site"
  exit 2
fi

echo "==> Building Astro site in $ASTRO_DIR"
cd "$ASTRO_DIR"

# Use npm ci when lockfile exists; fallback to npm install.
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

# Fail the build if npm audit reports any vulnerabilities.
npm audit

# Provide DIRECTUS_URL to the build if your Astro code reads it.
# Example in Astro: import.meta.env.DIRECTUS_URL (via env prefix rules) or process.env.DIRECTUS_URL.
# You may want to map this to PUBLIC_ variables depending on your Astro config.
npm run build

# Astro default output is dist/
if [[ ! -d dist ]]; then
  echo "ERROR: dist/ not found after build. Check your Astro build output."
  exit 3
fi

echo "==> Publishing dist/ to s3://$AWS_S3_BUCKET/"

# IMPORTANT: do not delete media/ when syncing site root.
aws s3 sync ./dist/ "s3://${AWS_S3_BUCKET}/" --delete --exclude "media/*" --region "$AWS_REGION"

if [[ "$INVALIDATE_ON_PUBLISH" == "true" ]]; then
  if [[ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "==> INVALIDATE_ON_PUBLISH=true but CLOUDFRONT_DISTRIBUTION_ID is empty; skipping invalidation."
  else
    echo "==> Creating CloudFront invalidation for /*"
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
  fi
fi

echo "==> Done"
