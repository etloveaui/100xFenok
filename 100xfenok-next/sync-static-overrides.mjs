import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function replaceExact(content, from, to, filePath) {
  if (content.includes(to)) {
    return content;
  }
  if (!content.includes(from)) {
    console.warn(
      `[sync-static-overrides] pattern not found in ${filePath} — skipped (submodule likely moved past this rewrite)`
    );
    return content;
  }
  return content.replace(from, to);
}

function applyReplacements(relativePath, replacements) {
  const filePath = path.join(rootDir, relativePath);
  let content = fs.readFileSync(filePath, "utf8");

  for (const [from, to] of replacements) {
    content = replaceExact(content, from, to, relativePath);
  }

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`[sync-static-overrides] applied ${relativePath}`);
}

applyReplacements("public/tools/stock_analyzer/stock_analyzer.html", [
  [
    "<title>Stock Analytics Dashboard - Sprint 4</title>",
    "<title>Stock Analyzer</title>",
  ],
  [
    '<h1 class="text-2xl font-bold text-gray-800">Stock Analytics Dashboard</h1>',
    '<h1 class="text-2xl font-bold text-gray-800">Stock Analyzer</h1>',
  ],
  [
    '<p class="text-sm text-gray-500">Sprint 4 - Integrated Analytics System</p>',
    '<p class="text-sm text-gray-500">종목 탐색과 비교를 위한 분석 대시보드</p>',
  ],
]);

applyReplacements("public/ib/ib-total-guide-calculator.html", [
  [
    "<title>무한매수법 완전정복 인포그래픽 (API 연동 최종본)</title>",
    "<title>무한매수법 완전정복</title>",
  ],
  [
    '<meta property="og:title" content="무한매수법 완전정복 인포그래픽 (API 연동 최종본)">',
    '<meta property="og:title" content="무한매수법 완전정복">',
  ],
  [
    `            async function fetchStockPrice(symbol) {
                const proxyUrl = 'https://api.allorigins.win/get?url=';
                const targetUrl = \`https://query1.finance.yahoo.com/v8/finance/chart/\${symbol}\`;
                try {
                    const response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
                    if (!response.ok) throw new Error(\`Network response was not ok for \${symbol}\`);
                    const data = await response.json();
                    const content = JSON.parse(data.contents);
                    const price = content?.chart?.result?.[0]?.meta?.regularMarketPrice;
                    return price ? price.toFixed(2) : 'N/A';
                } catch (error) {
                    console.error('Price fetch error for ' + symbol + ':', error);
                    return '실패';
                }
            }`,
    `            async function fetchStockPrice(symbol) {
                try {
                    const response = await fetch(\`/api/ticker/\${symbol}/\`, { cache: 'no-store' });
                    if (!response.ok) throw new Error(\`Network response was not ok for \${symbol}\`);
                    const data = await response.json();
                    const price = Number(data?.price);
                    return price ? price.toFixed(2) : 'N/A';
                } catch (error) {
                    console.error('Price fetch error for ' + symbol + ':', error);
                    return '실패';
                }
            }`,
  ],
]);

applyReplacements("public/ib/ib-helper/index.html", [
  [
    '<p class="mt-2 text-xs text-gray-500">Google 로그인 시작 버튼은 임시 중지 상태입니다.</p>',
    '<p class="mt-2 text-xs text-gray-500">Google 버튼 대신 이메일 로그인으로 시작해 주세요.</p>',
  ],
]);

applyReplacements("public/ib-helper/index.html", [
  [
    '<p class="mt-2 text-xs text-gray-500">Google 로그인 시작 버튼은 임시 중지 상태입니다.</p>',
    '<p class="mt-2 text-xs text-gray-500">Google 버튼 대신 이메일 로그인으로 시작해 주세요.</p>',
  ],
]);

applyReplacements("public/100x/100x-main.html", [
  [
    `                return dateString; 
            }

            // --- 데이터 로딩 및 초기 렌더링 ---`,
    `                return dateString; 
            }

            async function loadMetadata(filename) {
                const response = await fetch(\`\${METADATA_PATH}\${filename}\`);
                if (!response.ok) {
                    throw new Error(\`메타데이터 로드 실패: \${filename} (\${response.status})\`);
                }
                return response.json();
            }

            // --- 데이터 로딩 및 초기 렌더링 ---`,
  ],
  [
    `                    const requests = filenames.map(filename => fetch(\`\${METADATA_PATH}\${filename}\`).then(res => res.json()));
                    const reports = await Promise.all(requests);`,
    `                    const settled = await Promise.allSettled(filenames.map(loadMetadata));
                    const reports = settled
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value);`,
  ],
  [
    `                    
                    featuredGrid.innerHTML = featuredHTML;`,
    `                    
                    if (!featuredHTML) {
                        featuredGrid.innerHTML = '<p class="text-slate-500 col-span-full text-center">추천 리포트를 준비 중입니다.</p>';
                        return;
                    }
                    featuredGrid.innerHTML = featuredHTML;`,
  ],
  [
    `                    const requests = pageFilenames.map(filename => fetch(\`\${METADATA_PATH}\${filename}\`).then(res => res.json()));
                    const reports = await Promise.all(requests);`,
    `                    const settled = await Promise.allSettled(pageFilenames.map(loadMetadata));
                    const reports = settled
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value);`,
  ],
  [
    `                    });
                    archiveGrid.innerHTML = archiveHTML;`,
    `                    });
                    if (!archiveHTML) {
                        archiveGrid.innerHTML = \`<p class="w-full text-center text-slate-500">표시할 리포트가 없습니다.</p>\`;
                        renderPaginationControls();
                        return;
                    }
                    archiveGrid.innerHTML = archiveHTML;`,
  ],
  [
    `                        const path = a.dataset.path;
                        const urlParams = new URLSearchParams(path.split('?')[1]);
                        const finalPath = urlParams.get('path');`,
    `                        const path = a.dataset.path;
                        let finalPath = null;
                        if (path) {
                            try {
                                const parsed = new URL(path, window.location.origin);
                                finalPath = parsed.searchParams.get('path') || path;
                            } catch (error) {
                                finalPath = path;
                            }
                        }`,
  ],
]);

applyReplacements("public/alpha-scout/alpha-scout-main.html", [
  [
    `            let totalPages = 0;
            let currentPage = 1;

            // --- 초기화 함수 ---`,
    `            let totalPages = 0;
            let currentPage = 1;

            async function loadReportData(filename) {
                const response = await fetch(\`\${METADATA_PATH}\${filename}\`);
                if (!response.ok) throw new Error(\`리포트 데이터 로딩 실패: \${filename} (\${response.status})\`);
                return response.json();
            }

            // --- 초기화 함수 ---`,
  ],
  [
    `                    const res = await fetch(\`\${METADATA_PATH}\${filename}\`);
                    const report = await res.json();`,
    `                    const report = await loadReportData(filename);`,
  ],
  [
    `                    featuredReportLink.href = \`index.html?path=\${report.filePath}\`;`,
    `                    featuredReportLink.href = \`/alpha-scout?path=\${encodeURIComponent(report.filePath)}\`;`,
  ],
  [
    `                    const requests = pageFilenames.map(filename => fetch(\`\${METADATA_PATH}\${filename}\`).then(res => res.json()));
                    const reports = await Promise.all(requests);`,
    `                    const settled = await Promise.allSettled(pageFilenames.map(loadReportData));
                    const reports = settled
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value);`,
  ],
  [
    `                            <a href="index.html?path=\${report.filePath}" data-path="\${report.filePath}" class="block bg-white rounded-xl p-6 card-shadow card-hover">`,
    `                            <a href="/alpha-scout?path=\${encodeURIComponent(report.filePath)}" data-path="\${report.filePath}" class="block bg-white rounded-xl p-6 card-shadow card-hover">`,
  ],
  [
    `                    });
                    archiveGrid.innerHTML = archiveHTML;`,
    `                    });
                    if (!archiveHTML) {
                        archiveGrid.innerHTML = \`<p class="w-full text-center text-slate-500">표시할 리포트가 없습니다.</p>\`;
                        renderPaginationControls();
                        return;
                    }
                    archiveGrid.innerHTML = archiveHTML;`,
  ],
]);

applyReplacements("public/vr/vr-complete-system.html", [
  [
    '<meta name="description" content="라오어의 TQQQ 기반 밸류 리밸런싱 5.0 투자 전략의 모든 것을 담은 최종 마스터 가이드. 공식, 시뮬레이터, 백테스트 데이터, 실전 Q&amp;A까지 제공합니다.">',
    '<meta name="description" content="TQQQ 기반 밸류 리밸런싱 5.0 전략의 공식, 시뮬레이터, 백테스트, 실전 Q&amp;A를 담은 가이드입니다.">',
  ],
  [
    '<title>밸류 리밸런싱(VR) 5.0 최종 마스터 가이드 (통합 완성본 v3.0)</title>',
    '<title>밸류 리밸런싱(VR) 5.0 완전 가이드</title>',
  ],
  [
    '<meta property="og:title" content="밸류 리밸런싱(VR) 5.0 최종 마스터 가이드 (통합 완성본 v3.0)">',
    '<meta property="og:title" content="밸류 리밸런싱(VR) 5.0 완전 가이드">',
  ],
]);

applyReplacements("public/vr/vr-total-guide-calculator.html", [
  [
    '<title>밸류 리밸런싱 토탈 가이드 &amp; 계산기</title>',
    '<title>밸류 리밸런싱 계산기</title>',
  ],
  [
    '<meta name="description" content="VR 전략 계산기와 통합 가이드를 제공하는 페이지.">',
    '<meta name="description" content="VR 전략 계산과 주문표 작성을 위한 계산기입니다.">',
  ],
  [
    '<meta property="og:title" content="밸류 리밸런싱 토탈 가이드 &amp; 계산기">',
    '<meta property="og:title" content="밸류 리밸런싱 계산기">',
  ],
]);

applyReplacements("public/tools/asset/multichart.html", [
  [
    '<title>100x multichart pro</title>',
    '<title>100x 멀티차트</title>',
  ],
  [
    '<meta property="og:title" content="100x 멀티차트 (최종 안정판)">',
    '<meta property="og:title" content="100x 멀티차트">',
  ],
  [
    '<h1 className="text-3xl font-bold mb-4 text-gray-800"><i className="fas fa-chart-line text-blue-600 mr-3"></i>100x&nbsp;Multichart&nbsp;Pro</h1>',
    '<h1 className="text-3xl font-bold mb-4 text-gray-800"><i className="fas fa-chart-line text-blue-600 mr-3"></i>100x&nbsp;멀티차트</h1>',
  ],
  [
    '                <div id="insights-panel" className="mt-4 p-3 text-center bg-gray-50 rounded-md text-sm text-gray-500">Insights coming soon...</div>',
    '                <div id="insights-panel" className="mt-4 p-3 text-center bg-gray-50 rounded-md text-sm text-gray-500">분석 결과 요약이 여기에 표시됩니다.</div>',
  ],
  [
    '                      )) : <tr><td colSpan="4" className="text-center py-10 text-gray-500">분석을 실행해주세요.</td></tr>}',
    '                      )) : <tr><td colSpan="4" className="text-center py-10 text-gray-500">분석 실행 후 결과가 표시됩니다.</td></tr>}',
  ],
]);

applyReplacements("public/tools/macro-monitor/shared/data-fetcher.js", [
  [
    `    const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';

    try {
      // 3개 account_type 모두 fetch (시기별 다른 이름 사용)
      const urls = [
        // 1. Federal Reserve Account (2005 ~ 2021-09-30)
        \`\${baseUrl}?filter=account_type:eq:Federal Reserve Account,record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`,
        // 2. Treasury General Account (TGA) (2021-10-01 ~ 2022-04-15)
        \`\${baseUrl}?filter=account_type:eq:Treasury General Account (TGA),record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`,
        // 3. Treasury General Account (TGA) Opening Balance (2022-04-18 ~ 현재) ★ 추가!
        \`\${baseUrl}?filter=account_type:eq:Treasury General Account (TGA) Opening Balance,record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`
      ];

      const responses = await Promise.all(urls.map(url => this.fetchWithTimeout(url)));

      // 데이터 병합
      const allData = [];
      responses.forEach((json, idx) => {
        if (json?.data) {
          const typeName = ['FRA', 'TGA', 'TGA-Opening'][idx];
          json.data.forEach(d => {
            if (d.open_today_bal && d.open_today_bal !== 'null') {
              allData.push({ date: d.record_date, val: parseFloat(d.open_today_bal) });
            }
          });
          console.log(\`[DataFetcher] \${typeName}: \${json.data.length}개\`);
        }
      });

      if (allData.length === 0) {
        console.warn('[DataFetcher] Treasury API 데이터 없음, FRED 폴백');
        return this.fetchFRED('WTREGEN', days);
      }

      // 날짜 정렬 (오름차순)
      allData.sort((a, b) => a.date.localeCompare(b.date));

      // 중복 제거 (같은 날짜면 나중 데이터 = Opening Balance 우선)
      const uniqueMap = new Map();
      allData.forEach(d => uniqueMap.set(d.date, d.val));

      const result = Array.from(uniqueMap.entries()).map(([date, val]) => ({ date, val }));
      console.log(\`[DataFetcher] Treasury TGA 로드: \${result.length}개 (일간, \${result[0]?.date} ~ \${result[result.length-1]?.date})\`);

      return result;`,
    `    try {
      const json = await this.fetchWithTimeout(
        \`\${window.location.origin}/api/data?dataset=treasury-tga&start=\${encodeURIComponent(start)}\`
      );
      const rows = Array.isArray(json?.data) ? json.data : [];

      if (rows.length === 0) {
        console.warn('[DataFetcher] Treasury API 데이터 없음, FRED 폴백');
        return this.fetchFRED('WTREGEN', days);
      }
      const result = rows
        .filter(d => d?.record_date && d?.open_today_bal && d.open_today_bal !== 'null')
        .map(d => ({ date: d.record_date, val: parseFloat(d.open_today_bal) }))
        .filter(d => Number.isFinite(d.val));
      console.log(\`[DataFetcher] Treasury TGA 로드: \${result.length}개 (일간, \${result[0]?.date} ~ \${result[result.length-1]?.date})\`);

      return result;`,
  ],
]);

applyReplacements("public/tools/macro-monitor/details/liquidity-flow.html", [
  [
    `    const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';

    try {
      // 3개 account_type 모두 fetch (시기별 다른 이름 사용)
      const urls = [
        // 1. Federal Reserve Account (2005 ~ 2021-09-30)
        \`\${baseUrl}?filter=account_type:eq:Federal Reserve Account,record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`,
        // 2. Treasury General Account (TGA) (2021-10-01 ~ 2022-04-15)
        \`\${baseUrl}?filter=account_type:eq:Treasury General Account (TGA),record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`,
        // 3. Treasury General Account (TGA) Opening Balance (2022-04-18 ~ 현재) ★ 추가!
        \`\${baseUrl}?filter=account_type:eq:Treasury General Account (TGA) Opening Balance,record_date:gte:\${start}&sort=record_date&page[size]=10000&fields=record_date,open_today_bal\`
      ];

      const responses = await Promise.all(urls.map(url => fetchData(url)));

      // 데이터 병합
      const allData = [];
      responses.forEach((json, idx) => {
        if (json?.data) {
          const typeName = ['FRA', 'TGA', 'TGA-Opening'][idx];
          json.data.forEach(d => {
            if (d.open_today_bal && d.open_today_bal !== 'null') {
              allData.push({ date: d.record_date, val: parseFloat(d.open_today_bal) });
            }
          });
          console.log(\`[TGA] \${typeName}: \${json.data.length}개\`);
        }
      });

      if (allData.length === 0) {
        console.warn('[TGA] Treasury API 데이터 없음, FRED 폴백');
        return getFredSeries('WTREGEN', days);
      }

      // 날짜 정렬 (오름차순)
      allData.sort((a, b) => a.date.localeCompare(b.date));

      // 중복 제거 (같은 날짜면 나중 데이터 = Opening Balance 우선)
      const uniqueMap = new Map();
      allData.forEach(d => uniqueMap.set(d.date, d.val));

      const result = Array.from(uniqueMap.entries()).map(([date, val]) => ({ date, val }));
      console.log(\`[TGA] Treasury API 로드 완료: \${result.length}개 (일간, \${result[0]?.date} ~ \${result[result.length-1]?.date})\`);

      return result;`,
    `    try {
      const json = await fetchData(\`/api/data?dataset=treasury-tga&start=\${encodeURIComponent(start)}\`);
      const rows = Array.isArray(json?.data) ? json.data : [];

      if (rows.length === 0) {
        console.warn('[TGA] Treasury API 데이터 없음, FRED 폴백');
        return getFredSeries('WTREGEN', days);
      }
      const result = rows
        .filter(d => d?.record_date && d?.open_today_bal && d.open_today_bal !== 'null')
        .map(d => ({ date: d.record_date, val: parseFloat(d.open_today_bal) }))
        .filter(d => Number.isFinite(d.val));
      console.log(\`[TGA] Treasury API 로드 완료: \${result.length}개 (일간, \${result[0]?.date} ~ \${result[result.length-1]?.date})\`);

      return result;`,
  ],
]);
