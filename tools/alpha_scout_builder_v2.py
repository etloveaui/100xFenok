import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'alpha-scout' / 'v2'
TEMPLATE = ROOT / 'report-template.html'
META_DIR = ROOT / 'metadata'
REPORTS_DIR = ROOT / 'reports'
INDEX_FILE = ROOT / 'reports-index.json'


def read_json(path: Path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def write_json(path: Path, data):
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def sanitize(s):
    return '' if s is None else str(s)


def build_featured_from_v1(v1: dict):
    featured = []
    # value: 첫 valuePicks 1건
    vp = v1.get('valuePicks') or []
    if vp:
        v = vp[0]
        metric = None
        if (v.get('metrics') or []):
            m0 = v['metrics'][0]
            metric = { 'label': m0.get('label',''), 'value': m0.get('value','') }
        featured.append({
            'type': 'value', 'typeTitle': '금주의 가치주',
            'ticker': v.get('ticker',''), 'name': v.get('name',''),
            'desc': v.get('theme',''), 'metric': metric
        })
    # momentum: 첫 momentumPicks 1건
    mp = v1.get('momentumPicks') or []
    if mp:
        m = mp[0]
        featured.append({
            'type': 'momentum', 'typeTitle': '금주의 모멘텀',
            'ticker': m.get('ticker',''), 'name': m.get('name',''),
            'desc': '모멘텀 트래커',
            'metric': { 'label': '주간 수익률', 'value': (m.get('performance') or (m.get('metrics') or [{}])[0].get('value','')) }
        })
    # institution: consensus에서 상향/신규 우선 선택
    cs = v1.get('consensus') or []
    inst = None
    for c in cs:
        if str(c.get('change','')).strip() in ('상향','신규'):
            inst = c
            break
    if inst:
        featured.append({
            'type': 'institution', 'typeTitle': '금주의 기관 추천',
            'ticker': inst.get('ticker',''), 'name': '',
            'desc': sanitize(inst.get('comment','')),
            'metric': { 'label': '목표가', 'value': sanitize(inst.get('targetPrice','')) }
        })
    return featured


def build_archive_picks_from_v1(v1: dict):
    value = ''
    momentum = ''
    institution = ''
    if (v1.get('valuePicks') or []):
        value = v1['valuePicks'][0].get('ticker','')
    if (v1.get('momentumPicks') or []):
        momentum = v1['momentumPicks'][0].get('ticker','')
    for c in (v1.get('consensus') or []):
        if str(c.get('change','')).strip() in ('상향','신규'):
            institution = c.get('ticker','')
            break
    return { 'value': value, 'momentum': momentum, 'institution': institution }


def fill_template(v1: dict, template_html: str) -> str:
    ms = v1.get('marketSummary') or {}
    html = template_html
    repl = {
        'REPORT_DATE': v1.get('reportDate',''),
        'HEADLINE': ms.get('headline',''),
        'SUMMARY': ms.get('summary',''),
        'SP500_PRICE': (ms.get('sp500') or {}).get('price',''),
        'SP500_CHANGE': (ms.get('sp500') or {}).get('changePercent',''),
        'SP500_COLOR': (ms.get('sp500') or {}).get('colorClass',''),
        'NASDAQ_PRICE': (ms.get('nasdaq') or {}).get('price',''),
        'NASDAQ_CHANGE': (ms.get('nasdaq') or {}).get('changePercent',''),
        'NASDAQ_COLOR': (ms.get('nasdaq') or {}).get('colorClass',''),
        'TENYEAR_YIELD': (ms.get('tenYear') or {}).get('yield',''),
        'TENYEAR_CHANGE': (ms.get('tenYear') or {}).get('changeBp',''),
        'TENYEAR_COLOR': (ms.get('tenYear') or {}).get('colorClass',''),
        'VIX_PRICE': (ms.get('vix') or {}).get('price',''),
        'VIX_CHANGE': (ms.get('vix') or {}).get('changePercent',''),
        'VIX_COLOR': (ms.get('vix') or {}).get('colorClass',''),
    }
    for k, v in repl.items():
        html = html.replace(f'@@{k}@@', sanitize(v))

    # featured cards
    featured = build_featured_from_v1(v1)
    card_htmls = []
    for f in featured:
        metric_html = ''
        if f.get('metric'):
            metric_html = f"<div class='mt-3 text-right text-sm'>{sanitize(f['metric']['label'])}: <b class='text-indigo-600'>{sanitize(f['metric']['value'])}</b></div>"
        card_htmls.append(
            """
            <div class="bg-white border p-5 card">
              <h3 class="font-bold text-slate-800 mb-2">{title}</h3>
              <p class="text-3xl font-extrabold">{ticker}</p>
              <p class="text-slate-500 text-sm mb-2">{name}</p>
              <p class="text-slate-700 text-sm">{desc}</p>
              {metric}
            </div>
            """.replace('{title}', sanitize(f.get('typeTitle') or f.get('type','')))
                 .replace('{ticker}', sanitize(f.get('ticker','')))
                 .replace('{name}', sanitize(f.get('name','')))
                 .replace('{desc}', sanitize(f.get('desc','')))
                 .replace('{metric}', metric_html)
        )
    html = html.replace('@@FEATURED_CARDS@@', '\n'.join(card_htmls))

    # consensus rows (top 10)
    rows = []
    for i, c in enumerate((v1.get('consensus') or [])[:10], start=1):
        badge = f"<span class='px-2 py-0.5 rounded-full {sanitize(c.get('bgClass',''))} {sanitize(c.get('textClass',''))}'>{sanitize(c.get('change',''))}</span>"
        rows.append(
            """
            <tr>
              <td class="p-3 text-slate-500 font-semibold">{rank}</td>
              <td class="p-3 font-bold">{ticker}</td>
              <td class="p-3">{bank}</td>
              <td class="p-3">{date}</td>
              <td class="p-3">{badge}</td>
              <td class="p-3 text-right font-semibold">{tp}</td>
              <td class="p-3">{comment}</td>
            </tr>
            """.replace('{rank}', str(i))
                 .replace('{ticker}', sanitize(c.get('ticker','')))
                 .replace('{bank}', sanitize(c.get('bank','')))
                 .replace('{date}', sanitize(c.get('date','')))
                 .replace('{badge}', badge)
                 .replace('{tp}', sanitize(c.get('targetPrice','')))
                 .replace('{comment}', sanitize(c.get('comment','')))
        )
    html = html.replace('@@CONSENSUS_ROWS@@', '\n'.join(rows) if rows else '<tr><td class="p-3 text-slate-500" colspan="7">데이터 없음</td></tr>')

    # event cards (up to 6)
    ev_cards = []
    for ev in (v1.get('keyEvents') or [])[:6]:
        ev_cards.append(
            """
            <div class="bg-white border-l-4 p-5 card" style="border-color:var(--accent, #7c3aed);">
              <div class="flex justify-between mb-2">
                <span class="text-xs font-bold {cat_text} px-2 py-0.5 rounded {cat_bg}">{cat}</span>
                <span class="text-xs text-slate-500">{date}</span>
              </div>
              <h3 class="font-bold mb-2">{title}</h3>
              <p class="text-sm text-slate-600"><b>영향:</b> {impact}</p>
            </div>
            """.replace('{cat}', sanitize(ev.get('category','')))
                 .replace('{date}', sanitize(ev.get('date','')))
                 .replace('{title}', sanitize(ev.get('title','')))
                 .replace('{impact}', sanitize(ev.get('impact','')))
                 .replace('{cat_bg}', sanitize(ev.get('categoryBgClass','')))
                 .replace('{cat_text}', sanitize(ev.get('categoryTextClass','')))
        )
    html = html.replace('@@EVENT_CARDS@@', '\n'.join(ev_cards))

    return html


def ensure_index_has(name: str):
    try:
        idx = read_json(INDEX_FILE)
        if name in idx:
            return
        idx.insert(0, name)
    except FileNotFoundError:
        idx = [name]
    write_json(INDEX_FILE, idx)


def build_from_v1_json(input_path: Path):
    v1 = read_json(input_path)
    date = v1.get('reportDate') or ''
    if not date:
        raise ValueError('reportDate 가 필요합니다')

    # load template
    template_html = TEMPLATE.read_text(encoding='utf-8')
    out_html = fill_template(v1, template_html)

    # output paths
    filename_base = f"{date}_alpha-scout.html"
    report_path = REPORTS_DIR / filename_base
    write_text(report_path, out_html)

    # metadata
    meta_name = f"{date}_data.json"
    meta_path = META_DIR / meta_name
    ms = v1.get('marketSummary') or {}
    meta = {
        'displayDate': date,
        'title': ms.get('headline',''),
        'summaryShort': ms.get('summary',''),
        'filePath': f"alpha-scout/v2/reports/{filename_base}",
        'featured': build_featured_from_v1(v1),
        'archivePicks': build_archive_picks_from_v1(v1)
    }
    write_json(meta_path, meta)

    # update index
    ensure_index_has(meta_name)

    return {'report': str(report_path), 'meta': str(meta_path)}


def main():
    ap = argparse.ArgumentParser(description='Alpha Scout V2 Builder')
    ap.add_argument('--input', required=True, help='v1 JSON 경로 (e.g., reports/data/2025-08-24_data.json)')
    args = ap.parse_args()
    result = build_from_v1_json(Path(args.input))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

