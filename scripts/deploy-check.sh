#!/bin/bash
# deploy-check.sh
# GitHub Pages 배포 확인 스크립트
# 사용법: ./scripts/deploy-check.sh [expected_version]

DEPLOY_URL="https://etloveaui.github.io/100xFenok/.deploy-check.html"
EXPECTED_VERSION="${1:-v2025.1127.1}"
MAX_ATTEMPTS=30
WAIT_SECONDS=10

echo "========================================"
echo "🚀 GitHub Pages 배포 확인 시작"
echo "========================================"
echo "URL: $DEPLOY_URL"
echo "Expected Version: $EXPECTED_VERSION"
echo "Max Attempts: $MAX_ATTEMPTS (${WAIT_SECONDS}s 간격)"
echo "========================================"

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
  echo ""
  echo "[$i/$MAX_ATTEMPTS] 확인 중... $(date '+%H:%M:%S')"

  # Fetch the page and extract version
  RESPONSE=$(curl -s --max-time 10 "$DEPLOY_URL" 2>/dev/null)

  if [ -z "$RESPONSE" ]; then
    echo "  ❌ 응답 없음 - 재시도..."
    sleep $WAIT_SECONDS
    continue
  fi

  # Extract version from HTML (v20XX.XXXX.X pattern)
  DEPLOYED_VERSION=$(echo "$RESPONSE" | grep -oP "v\d{4}\.\d{4}\.\d+" | head -1)

  if [ -z "$DEPLOYED_VERSION" ]; then
    echo "  ⚠️ 버전 파싱 실패 - 재시도..."
    sleep $WAIT_SECONDS
    continue
  fi

  echo "  📦 배포된 버전: $DEPLOYED_VERSION"

  if [ "$DEPLOYED_VERSION" = "$EXPECTED_VERSION" ]; then
    echo ""
    echo "========================================"
    echo "✅ 배포 완료 확인!"
    echo "========================================"
    echo "배포 버전: $DEPLOYED_VERSION"
    echo "확인 시간: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    exit 0
  else
    echo "  ⏳ 아직 이전 버전 ($DEPLOYED_VERSION != $EXPECTED_VERSION)"
    sleep $WAIT_SECONDS
  fi
done

echo ""
echo "========================================"
echo "❌ 배포 확인 실패 (타임아웃)"
echo "========================================"
echo "마지막 배포 버전: $DEPLOYED_VERSION"
echo "예상 버전: $EXPECTED_VERSION"
echo "========================================"
exit 1
