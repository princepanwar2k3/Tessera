#!/usr/bin/env bash
# Full HTTP lifecycle demo against a running daemon (pnpm --filter @bsp/daemon dev).
# Requires: curl, jq, docker (the daemon needs a real Docker to start busybox).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "1. Requesting a job (10s blocks, 4s lead — fast demo config)..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/jobs" \
  -H 'content-type: application/json' \
  -d '{
    "renterUaid": "uaid:demo:renter",
    "image": "busybox:latest",
    "cmd": ["sleep", "3600"],
    "blockSeconds": 10,
    "leadSeconds": 4,
    "pricePerBlock": "1500",
    "asset": "MOCK"
  }')
echo "$CREATE_RESPONSE" | jq .
JOB_ID=$(echo "$CREATE_RESPONSE" | jq -r '.blockMeta.jobId')
echo "Job ID: $JOB_ID"

echo -e "\n2. Paying block 1 (mock facilitator accepts any payload)..."
curl -s -X POST "$BASE_URL/jobs/$JOB_ID/blocks/1/payment" \
  -H 'content-type: application/json' -d '{"mock":true}' | jq .

echo -e "\n3. Job status (container should now be running; clock started at container-ready)..."
curl -s "$BASE_URL/jobs/$JOB_ID" | jq .

echo -e "\n4a. DEMO: pay the renewal in time -> job continues past the boundary."
echo "    Waiting for the renewal window to open (6s)..."
sleep 6
curl -s "$BASE_URL/jobs/$JOB_ID/blocks/2" | jq .
curl -s -X POST "$BASE_URL/jobs/$JOB_ID/blocks/2/payment" \
  -H 'content-type: application/json' -d '{"mock":true}' | jq .
sleep 5
echo "Status after the boundary (should still be running, blockIndex 2):"
curl -s "$BASE_URL/jobs/$JOB_ID" | jq .

echo -e "\n4b. DEMO: the kill. Don't pay block 3 — wait past its boundary (10s)."
sleep 11
echo "Status after the unpaid boundary (should be expired):"
curl -s "$BASE_URL/jobs/$JOB_ID" | jq .
echo "Container list (the container should be gone):"
docker ps --filter "label=tessera.jobId=$JOB_ID"
