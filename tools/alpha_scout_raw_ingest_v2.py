import argparse
import json
import re
import os
from pathlib import Path
from datetime import datetime
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1] / 'alpha-scout' / 'v2'
TEMPLATE = ROOT / 'report-template.html'
META_DIR = ROOT / 'metadata'
REPORTS_DIR = ROOT / 'reports'
INDEX_FILE = ROOT / 'reports-index.json'


class SimpleHTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.in_h1 = False
        self.in_h2 = False
        self.in_p = False
        self.title = ''
        self.h1_list = []
        self.h2_list = []
        self.paragraphs = []
        self.curr = []

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        elif tag == 'h1':
            self.in_h1 = True
            self.curr = []
        elif tag == 'h2':
            self.in_h2 = True
            self.curr = []
        elif tag == 'p':
            self.in_p = True
            self.curr = []

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        elif tag == 'h1':
            self.in_h1 = False
            txt = ''.join(self.curr).strip()
            if txt:
                self.h1_list.append(txt)
            self.curr = []
        elif tag == 'h2':
            self.in_h2 = False
            txt = ''.join(self.curr).strip()
            if txt:
                self.h2_list.append(txt)
            self.curr = []
        elif tag == 'p':
            self.in_p = False
            txt = ''.join(self.curr).strip()
            if txt:
                self.paragraphs.append(txt)
            self.curr = []

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_h1 or self.in_h2 or self.in_p:
            self.curr.append(data)


def read_text(path: Path) -> str:
    # Try utf-8, fallback to cp949 commonly used on Windows
    for enc in ('utf-8', 'utf-8-sig', 'cp949', 'euc-kr'):
        try:
            return path.read_text(encoding=enc)
        except Exception:
            continue
    # binary read last resort
    return path.read_bytes().decode('utf-8', errors='ignore')


def write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def write_json(path: Path, data):
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def extract_tickers(text: str):
    # stricter: 2-5 uppercase letters, optional .SUFFIX(1-2); filter common terms
    candidates = re.findall(r"\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b", text)
    blacklist = {
        'AI','ETF','USA','NYSE','EPS','CEO','CFO','ROE','FCF','EBITDA','PE','EV','CPU','GPU','HPC','AIGC','LLM',
        'API','SDK','OS','AWS','GCP','AZURE','VIX','SP','USD','BPS','CAGR','YTD','QOQ','YOY','HTML','HTTP','HTTPS','PDF'
    }
    result = []
    for c in candidates:
        if c in blacklist:
            continue
        if not any(ch.isalpha() for ch in c):
            continue
        if c not in result:
            result.append(c)
    return result[:20]


def load_template() -> str:
    return TEMPLATE.read_text(encoding='utf-8')


def fill_template(template_html: str, meta: dict) -> str:
    repl = {
        'REPORT_DATE': meta.get('displayDate',''),
        'HEADLINE': meta.get('title',''),
        'SUMMARY': meta.get('summaryShort',''),
        'SP500_PRICE': '',
        'SP500_CHANGE': '',
        'SP500_COLOR': '',
        'NASDAQ_PRICE': '',
        'NASDAQ_CHANGE': '',
        'NASDAQ_COLOR': '',
        'TENYEAR_YIELD': '',
        'TENYEAR_CHANGE': '',
        'TENYEAR_COLOR': '',
        'VIX_PRICE': '',
        'VIX_CHANGE': '',
        'VIX_COLOR': '',
    }
    html = template_html
    for k, v in repl.items():
        html = html.replace(f'@@{k}@@', v)

    # Featured cards
    cards = []
    for f in (meta.get('featured') or [])[:3]:
        metric_html = ''
        m = f.get('metric')
        if m:
            metric_html = f"<div class='mt-3 text-right text-sm'>{m.get('label','')}: <b class='text-indigo-600'>{m.get('value','')}</b></div>"
        cards.append(
            f"""
            <div class=\"bg-white border p-5 card\">
              <h3 class=\"font-bold text-slate-800 mb-2\">{f.get('typeTitle', f.get('type',''))}</h3>
              <p class=\"text-3xl font-extrabold\">{f.get('ticker','')}</p>
              <p class=\"text-slate-500 text-sm mb-2\">{f.get('name','')}</p>
              <p class=\"text-slate-700 text-sm\">{f.get('desc','')}</p>
              {metric_html}
            </div>
            """
        )
    html = html.replace('@@FEATURED_CARDS@@', '\n'.join(cards) if cards else '')

    html = html.replace('@@CONSENSUS_ROWS@@', '<tr><td class="p-3 text-slate-500" colspan="7">RAW 기반 초안 — 컨센서스 데이터 없음</td></tr>')
    html = html.replace('@@EVENT_CARDS@@', '')
    return html


def build_meta_from_raw(html_path: Path) -> dict:
    text = read_text(html_path)
    parser = SimpleHTMLText()
    parser.feed(text)

    # date: use file mtime
    ts = datetime.fromtimestamp(html_path.stat().st_mtime)
    date_str = ts.strftime('%Y-%m-%d')

    title = (parser.h1_list[0] if parser.h1_list else parser.title).strip()
    if not title:
        # fallback: filename without extension
        title = html_path.stem
    summary = (parser.paragraphs[0] if parser.paragraphs else '').strip()

    tickers = extract_tickers(text)
    # build featured from first three tickers
    featured = []
    labels = [
        ('value','금주의 가치주'),
        ('momentum','금주의 모멘텀'),
        ('institution','금주의 기관 추천'),
    ]
    for (t, tt), tk in zip(labels, tickers[:3]):
        featured.append({
            'type': t,
            'typeTitle': tt,
            'ticker': tk,
            'name': '',
            'desc': 'RAW 자동 추출',
            'metric': None
        })

    archive = {
        'value': tickers[0] if len(tickers) > 0 else '',
        'momentum': tickers[1] if len(tickers) > 1 else '',
        'institution': tickers[2] if len(tickers) > 2 else ''
    }

    file_slug = html_path.stem
    out_filename = f"{date_str}_{file_slug}_alpha-scout.html"

    meta = {
        'displayDate': date_str,
        'title': title,
        'summaryShort': summary,
        'filePath': f"alpha-scout/v2/reports/{out_filename}",
        'featured': featured,
        'archivePicks': archive,
        'sourceRaw': str(html_path)
    }
    return meta, out_filename


def ensure_index_has(name: str):
    try:
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            idx = json.load(f)
    except FileNotFoundError:
        idx = []
    if name not in idx:
        idx.insert(0, name)
        with open(INDEX_FILE, 'w', encoding='utf-8') as f:
            json.dump(idx, f, ensure_ascii=False, indent=2)


def build_from_raw(html_path: Path):
    meta, out_filename = build_meta_from_raw(html_path)
    tpl = load_template()
    html = fill_template(tpl, meta)
    # write report
    out_path = REPORTS_DIR / out_filename
    write_text(out_path, html)
    # write meta
    meta_name = Path(meta['filePath']).name.replace('_alpha-scout.html', '_data.json')
    write_json(META_DIR / meta_name, meta)
    # update index
    ensure_index_has(meta_name)
    return {
        'report': str(out_path),
        'meta': str((META_DIR / meta_name).resolve()),
        'index': str(INDEX_FILE.resolve())
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, help='RAW HTML 경로')
    args = ap.parse_args()
    res = build_from_raw(Path(args.raw))
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
