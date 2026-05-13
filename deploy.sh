#!/usr/bin/env bash
# deploy.sh — sync frontend source to build dir then deploy both layers
set -euo pipefail

FRONTEND_SRC="frontend/public/bookkeeping"
FRONTEND_BUILD="frontend/build/bookkeeping"

echo "▶ Syncing frontend source → build..."
rsync -av --delete \
  --exclude='*.DS_Store' \
  "$FRONTEND_SRC/" "$FRONTEND_BUILD/"

echo "▶ Deploying frontend (Firebase Hosting)..."
firebase deploy --only hosting

echo "▶ Deploying backend (Cloud Run)..."
# Copy accountant.md knowledge base into backend build context
cp accountant.md backend/accountant.md

gcloud run deploy bookkeeping-api \
  --source backend/ \
  --project bookkeeping-211e6 \
  --region us-central1

echo "✓ Deploy complete."
