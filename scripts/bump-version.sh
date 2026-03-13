#!/bin/bash
# bump-version.sh
# .deploy-check.html 버전 자동 업데이트
# 사용법: ./scripts/bump-version.sh [build_name]

DEPLOY_CHECK_FILE="$(dirname "$0")/../.deploy-check.html"
BUILD_NAME="${1:-build}"

# Generate version: vYYYY.MMDD.N (N은 1부터 시작, 같은 날 여러 빌드시 증가)
DATE_PART=$(date '+%Y.%m%d')
VERSION="v${DATE_PART}.1"

echo "========================================"
echo "📦 버전 업데이트"
echo "========================================"
echo "새 버전: $VERSION"
echo "빌드명: $BUILD_NAME"
echo "========================================"

# Update version in .deploy-check.html
if [ -f "$DEPLOY_CHECK_FILE" ]; then
  # Update version string
  sed -i "s/v[0-9]\{4\}\.[0-9]\{4\}\.[0-9]\+/$VERSION/g" "$DEPLOY_CHECK_FILE"

  # Update build name
  sed -i "s/Build: .*</Build: $BUILD_NAME</g" "$DEPLOY_CHECK_FILE"

  echo "✅ .deploy-check.html 업데이트 완료"
  echo ""
  echo "다음 명령으로 배포 확인:"
  echo "  ./scripts/deploy-check.sh $VERSION"
else
  echo "❌ 파일 없음: $DEPLOY_CHECK_FILE"
  exit 1
fi
