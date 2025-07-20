
import json
import os

# --- 경로 설정 ---
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_FILE = os.path.join(BASE_DIR, 'alpha-scout', 'data', 'reports-index.json')
TEMPLATE_FILE = os.path.join(BASE_DIR, 'alpha-scout', 'alpha-scout-main_template.html')
OUTPUT_FILE = os.path.join(BASE_DIR, 'alpha-scout', 'alpha-scout-main.html')

# --- HTML 템플릿 정의 ---
FEATURED_CARD_TEMPLATE = '''
<div class="alpha-card card-shadow card-hover">
    <h3 class="alpha-card-title {color_class}"><i class="{icon_class} fa-fw mr-2"></i>{title}</h3>
    <div class="text-center my-4">
        <p class="alpha-card-ticker">{ticker}</p>
        <p class="alpha-card-name">{name}</p>
    </div>
    <p class="alpha-card-desc">{description}</p>
    <div class="mt-4 pt-4 border-t border-slate-100 alpha-card-metric">
        {metric_label}: <strong class="{color_class}">{metric_value}</strong>
    </div>
</div>'''

ARCHIVE_CARD_TEMPLATE = '''
<a href="index.html?path={file_path}" data-path="{file_path}" class="block bg-white rounded-xl p-6 card-shadow card-hover">
    <p class="text-sm text-slate-500 mb-2">{date}</p>
    <h3 class="font-bold text-lg text-slate-800 mb-4">{title}</h3>
    <div class="pt-4 border-t border-slate-100 space-y-3 text-sm">
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-gem fa-fw mr-2 text-indigo-400"></i>가치주 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">{value_ticker}</span>
        </p>
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-rocket fa-fw mr-2 text-green-400"></i>모멘텀 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">{momentum_ticker}</span>
        </p>
        <p class="flex justify-between items-center text-slate-600">
            <span class="font-semibold flex items-center"><i class="fas fa-university fa-fw mr-2 text-amber-400"></i>기관 Pick</span>
            <span class="font-mono bg-slate-100 px-2 py-0.5 rounded">{institution_ticker}</span>
        </p>
    </div>
</a>'''

# --- 메인 빌드 함수 ---
def main():
    # 1. 데이터 및 템플릿 파일 읽기
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
            template_content = f.read()
    except FileNotFoundError as e:
        print(f"오류: 파일을 찾을 수 없습니다 - {e}")
        return

    featured_html = ""
    archive_html = ""

    # 2. HTML 조각 생성
    # Featured 카드 생성
    featured_report = next((report for report in data['reports'] if report.get('isFeatured')), None)
    if featured_report:
        picks = featured_report.get('featuredPicks', {})
        value_pick = picks.get('value')
        momentum_pick = picks.get('momentum')
        inst_pick = picks.get('institution')

        if value_pick:
            featured_html += FEATURED_CARD_TEMPLATE.format(
                color_class='text-indigo-600', icon_class='fas fa-gem', title='금주의 가치주',
                **value_pick, metric_label=value_pick['metric']['label'], metric_value=value_pick['metric']['value']
            )
        if momentum_pick:
            featured_html += FEATURED_CARD_TEMPLATE.format(
                color_class='text-green-600', icon_class='fas fa-rocket', title='금주의 모멘텀 주도주',
                **momentum_pick, metric_label=momentum_pick['metric']['label'], metric_value=momentum_pick['metric']['value']
            )
        if inst_pick:
            featured_html += FEATURED_CARD_TEMPLATE.format(
                color_class='text-amber-600', icon_class='fas fa-university', title='금주의 기관 추천주',
                **inst_pick, metric_label=inst_pick['metric']['label'], metric_value=inst_pick['metric']['value']
            )

    # Archive 카드 생성
    for report in data['reports']:
        archive_html += ARCHIVE_CARD_TEMPLATE.format(
            file_path=report['filePath'],
            date=report['displayDate'],
            title=report['archiveTitle'],
            value_ticker=report['archivePicks']['value'],
            momentum_ticker=report['archivePicks']['momentum'],
            institution_ticker=report['archivePicks']['institution']
        )

    # 3. 템플릿에 데이터 삽입
    final_content = template_content.replace('<!-- {{FEATURED_CARDS_PLACEHOLDER}} -->', featured_html)
    final_content = final_content.replace('<!-- {{ARCHIVE_CARDS_PLACEHOLDER}} -->', archive_html)

    # 4. 최종 파일 쓰기
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(final_content)

    print(f"성공: {os.path.basename(OUTPUT_FILE)} 파일이 성공적으로 생성되었습니다.")

if __name__ == "__main__":
    main()
