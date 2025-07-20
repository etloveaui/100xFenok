
#!/bin/bash

# 파일 경로 설정
DATA_FILE="alpha-scout/data/reports-index.json"
TEMPLATE_FILE="alpha-scout/alpha-scout-main_template.html"
OUTPUT_FILE="alpha-scout/alpha-scout-main.html"

# 데이터와 템플릿 파일이 존재하는지 확인
if [ ! -f "$DATA_FILE" ] || [ ! -f "$TEMPLATE_FILE" ]; then
  echo "오류: 데이터 파일 또는 템플릿 파일이 존재하지 않습니다." >&2
  exit 1
fi

# JSON 데이터 읽기 (jq 사용)
REPORTS_JSON=$(cat "$DATA_FILE")

# Featured 카드 HTML 생성
FEATURED_HTML=""
FEATURED_REPORT=$(echo "$REPORTS_JSON" | jq -c '.reports[] | select(.isFeatured == true)')

if [ -n "$FEATURED_REPORT" ]; then
  VALUE_PICK=$(echo "$FEATURED_REPORT" | jq '.featuredPicks.value')
  MOMENTUM_PICK=$(echo "$FEATURED_REPORT" | jq '.featuredPicks.momentum')
  INST_PICK=$(echo "$FEATURED_REPORT" | jq '.featuredPicks.institution')

  # 가치주 카드
  FEATURED_HTML+=$(cat <<-EOM
<div class="alpha-card card-shadow card-hover">
    <h3 class="alpha-card-title text-indigo-600"><i class="fas fa-gem fa-fw mr-2"></i>금주의 가치주</h3>
    <div class="text-center my-4">
        <p class="alpha-card-ticker">$(echo "$VALUE_PICK" | jq -r '.ticker')</p>
        <p class="alpha-card-name">$(echo "$VALUE_PICK" | jq -r '.name')</p>
    </div>
    <p class="alpha-card-desc">$(echo "$VALUE_PICK" | jq -r '.description')</p>
    <div class="mt-4 pt-4 border-t border-slate-100 alpha-card-metric">
        $(echo "$VALUE_PICK" | jq -r '.metric.label'): <strong class="text-indigo-600">$(echo "$VALUE_PICK" | jq -r '.metric.value')</strong>
    </div>
</div>
EOM
  )

  # 모멘텀주 카드
  FEATURED_HTML+=$(cat <<-EOM
<div class="alpha-card card-shadow card-hover">
    <h3 class="alpha-card-title text-green-600"><i class="fas fa-rocket fa-fw mr-2"></i>금주의 모멘텀 주도주</h3>
    <div class="text-center my-4">
        <p class="alpha-card-ticker">$(echo "$MOMENTUM_PICK" | jq -r '.ticker')</p>
        <p class="alpha-card-name">$(echo "$MOMENTUM_PICK" | jq -r '.name')</p>
    </div>
    <p class="alpha-card-desc">$(echo "$MOMENTUM_PICK" | jq -r '.description')</p>
    <div class="mt-4 pt-4 border-t border-slate-100 alpha-card-metric">
        $(echo "$MOMENTUM_PICK" | jq -r '.metric.label'): <strong class="text-green-600">$(echo "$MOMENTUM_PICK" | jq -r '.metric.value')</strong>
    </div>
</div>
EOM
  )

  # 기관 추천주 카드
  FEATURED_HTML+=$(cat <<-EOM
<div class="alpha-card card-shadow card-hover">
    <h3 class="alpha-card-title text-amber-600"><i class="fas fa-university fa-fw mr-2"></i>금주의 기관 추천주</h3>
    <div class="text-center my-4">
        <p class="alpha-card-ticker">$(echo "$INST_PICK" | jq -r '.ticker')</p>
        <p class="alpha-card-name">$(echo "$INST_PICK" | jq -r '.name')</p>
    </div>
    <p class="alpha-card-desc">$(echo "$INST_PICK" | jq -r '.description')</p>
    <div class="mt-4 pt-4 border-t border-slate-100 alpha-card-metric">
        $(echo "$INST_PICK" | jq -r '.metric.label'): <strong class="text-amber-600">$(echo "$INST_PICK" | jq -r '.metric.value')</strong>
    </div>
</div>
EOM
  )
fi

# Archive 카드 HTML 생성
ARCHIVE_HTML=""
ARCHIVE_REPORTS=$(echo "$REPORTS_JSON" | jq -c '.reports[]')

for report in $ARCHIVE_REPORTS; do
  FILE_PATH=$(echo "$report" | jq -r '.filePath')
  DATE=$(echo "$report" | jq -r '.displayDate')
  TITLE=$(echo "$report" | jq -r '.archiveTitle')
  VALUE_TICKER=$(echo "$report" | jq -r '.archivePicks.value')
  MOMENTUM_TICKER=$(echo "$report" | jq -r '.archivePicks.momentum')
  INST_TICKER=$(echo "$report" | jq -r '.archivePicks.institution')

  ARCHIVE_HTML+=$(cat <<-EOM
<a href="index.html?path=$FILE_PATH" data-path="$FILE_PATH" class="block bg-white rounded-xl p-6 card-shadow card-hover">
    <p class="text-sm text-slate-500 mb-2">$DATE</p>
    <h3 class="font-bold text-lg text-slate-800 mb-4">$TITLE</h3>
    <div class="pt-4 border-t border-slate-100 space-y-3 text-sm">
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-gem fa-fw mr-2 text-indigo-400"></i>가치주 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">$VALUE_TICKER</span>
        </p>
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-rocket fa-fw mr-2 text-green-400"></i>모멘텀 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">$MOMENTUM_TICKER</span>
        </p>
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-university fa-fw mr-2 text-amber-400"></i>기관 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">$INST_TICKER</span>
        </p>
    </div>
</a>
EOM
  )
done

# 템플릿에 HTML 삽입하여 최종 파일 생성
TEMP_CONTENT=$(cat "$TEMPLATE_FILE")
TEMP_CONTENT=${TEMP_CONTENT//'<!-- {{FEATURED_CARDS_PLACEHOLDER}} -->'/$FEATURED_HTML}
FINAL_CONTENT=${TEMP_CONTENT//'<!-- {{ARCHIVE_CARDS_PLACEHOLDER}} -->'/$ARCHIVE_HTML}

echo "$FINAL_CONTENT" > "$OUTPUT_FILE"

echo "성공: $OUTPUT_FILE 파일이 성공적으로 생성되었습니다."
