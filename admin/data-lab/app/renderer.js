/**
 * Renderer - UI rendering functions
 *
 * Handles DOM updates based on state changes.
 *
 * @module renderer
 * @version 1.0.0
 */

const Renderer = (function() {

  const STOCK_FIELD_PAGE_SIZE = 40;
  const STOCK_FIELD_STATUS_ORDER = ['visually_rendered', 'interpreted', 'metadata', 'not_yet_used'];
  const STOCK_FIELD_STATUS_LABELS = {
    visually_rendered: '화면 사용',
    interpreted: '해석 사용',
    metadata: '메타',
    not_yet_used: '미사용'
  };
  const STOCK_FIELD_STATUS_STYLES = {
    visually_rendered: 'bg-green-100 text-green-700 border-green-200',
    interpreted: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    metadata: 'bg-slate-100 text-slate-600 border-slate-200',
    not_yet_used: 'bg-amber-100 text-amber-700 border-amber-200'
  };

  // DOM element references
  let elements = null;
  let stockFieldManifest = null;
  let stockFieldView = {
    status: 'visually_rendered',
    datasetId: 'all',
    page: 0,
    debug: false
  };

  /**
   * Initialize renderer with DOM references
   * @param {Object} refs - { summaryContainer, cardsContainer, detailsPanel, ... }
   */
  function init(refs) {
    elements = refs;
    console.log('[Renderer] Initialized');
  }

  /**
   * Render summary section
   * @param {Object} summary - freshness summary
   * @param {Object} health - overall health
   */
  function renderSummary(summary, health) {
    if (!elements?.summaryContainer) return;
    elements.summaryContainer.innerHTML = StatusCard.renderSummary(summary, health);
  }

  /**
   * Render all status cards
   * @param {Object} folders - { folderName: config, ... }
   * @param {Object} schemas - { folderName: schema, ... }
   * @param {Object} freshness - { folderName: result, ... }
   */
  function renderCards(folders, schemas, freshness) {
    if (!elements?.cardsContainer) return;

    // Combine folders with schemas for rendering
    const foldersWithSchemas = {};
    Object.entries(folders).forEach(([name, config]) => {
      foldersWithSchemas[name] = {
        config: config,
        schema: schemas[name] || null
      };
    });

    // Pass clickHandler option to open details panel
    const options = {
      clickHandler: (folderName) => `DataLabUI.showFolderDetails('${folderName}')`
    };
    elements.cardsContainer.innerHTML = StatusCard.renderAll(foldersWithSchemas, freshness, options);
  }

  /**
   * Render loading state
   */
  function renderLoading() {
    if (elements?.cardsContainer) {
      elements.cardsContainer.innerHTML = StatusCard.renderLoading(7);
    }
    if (elements?.summaryContainer) {
      elements.summaryContainer.innerHTML = `
        <div class="bg-slate-800 rounded-xl p-6 animate-pulse">
          <div class="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
          <div class="grid grid-cols-4 gap-4">
            ${Array(4).fill('<div class="h-16 bg-slate-700 rounded"></div>').join('')}
          </div>
        </div>
      `;
    }
  }

  /**
   * Render error state
   * @param {string} message
   */
  function renderError(message) {
    if (elements?.cardsContainer) {
      elements.cardsContainer.innerHTML = StatusCard.renderError(message);
    }
  }

  /**
   * Render Ops loading state
   */
  function renderOpsLoading() {
    if (!elements?.opsContainer) return;
    elements.opsContainer.innerHTML = `
      ${Array.from({ length: 5 }, () => `
        <div class="bg-white rounded-xl p-5 shadow animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div class="space-y-3">
            <div class="h-3 bg-gray-200 rounded w-full"></div>
            <div class="h-3 bg-gray-200 rounded w-4/5"></div>
            <div class="h-3 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
      `).join('')}
    `;
  }

  /**
   * Render Ops check results
   * @param {Object} results
   */
  function renderOpsResults(results) {
    if (!elements?.opsContainer) return;
    elements.opsContainer.innerHTML = `
      ${renderOpsCard({
        title: 'Manifest Route Smoke',
        icon: 'fa-route',
        description: 'Data Lab manifest path and dead-prefix guard',
        items: results.routes
      })}
      ${renderOpsCard({
        title: 'Live Asset Parity',
        icon: 'fa-layer-group',
        description: 'Current runtime assets vs GitHub source HEAD',
        items: results.assets
      })}
      ${renderOpsCard({
        title: 'Source / Live Drift',
        icon: 'fa-code-compare',
        description: 'GitHub source HEAD vs current served admin assets',
        items: results.drift
      })}
      ${renderOpsCard({
        title: 'Actions Health',
        icon: 'fa-circle-nodes',
        description: 'Latest main deploy workflows vs GitHub main HEAD',
        items: results.actions
      })}
      ${renderOpsCard({
        title: 'Freshness Guard',
        icon: 'fa-clock-rotate-left',
        description: 'Internal JSON timestamps used by live data surfaces',
        items: results.freshness || []
      })}
    `;
  }

  /**
   * Render Ops unavailable state
   * @param {string} message
   */
  function renderOpsUnavailable(message) {
    if (!elements?.opsContainer) return;
    elements.opsContainer.innerHTML = `
      <div class="lg:col-span-2 rounded-xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
        <div class="font-semibold mb-1">운영 관제 확인 불가</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderDepthLoading() {
    if (!elements?.depthContainer) return;
    elements.depthContainer.innerHTML = `
      ${Array.from({ length: 3 }, () => `
        <div class="bg-white rounded-xl p-5 shadow animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div class="h-12 bg-gray-100 rounded mb-3"></div>
          <div class="h-3 bg-gray-200 rounded w-4/5"></div>
        </div>
      `).join('')}
    `;
  }

  function renderDepthCoverage(manifest) {
    if (!elements?.depthContainer) return;
    const totals = manifest?.totals || {};
    const activeCategories = (manifest?.categories || []).filter(item => item.status === 'active');
    const generated = manifest?.generatedIndexes || [];
    const componentAsOf = manifest?.component_as_of?.computed_signals || [];
    elements.depthContainer.innerHTML = `
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">Mirror / Usage</h3>
            <p class="text-xs text-gray-500 mt-1 break-words">${escapeHtml(manifest?.generated_at || '-')}</p>
          </div>
          <span class="px-2 py-1 rounded-full border text-xs font-bold ${manifest?.mirror_sync_status === 'ok' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}">
            ${escapeHtml((manifest?.mirror_sync_status || 'unknown').toUpperCase())}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          ${renderDepthMetric('root JSON', totals.rootJsonCount)}
          ${renderDepthMetric('public JSON', totals.publicJsonCount)}
          ${renderDepthMetric('direct fetch', totals.directDataFetchCount)}
          ${renderDepthMetric('dynamic', totals.dynamicPatternCount)}
        </div>
      </article>
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <h3 class="font-semibold text-gray-800 mb-3">Generated Indexes</h3>
        <div class="space-y-2">
          ${generated.map(item => `
            <div class="rounded-lg border ${item.mirrored ? 'bg-green-50 border-green-100' : 'bg-yellow-50 border-yellow-100'} p-3">
              <div class="flex items-center justify-between gap-3">
                <code class="min-w-0 truncate text-xs font-semibold text-gray-700" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</code>
                <span class="shrink-0 text-[10px] font-bold ${item.mirrored ? 'text-green-700' : 'text-yellow-700'}">${item.mirrored ? 'MIRROR' : 'CHECK'}</span>
              </div>
              <div class="mt-1 text-[11px] text-gray-500">${Formatters.formatNumber(item.sourceFiles?.length || 0, 0)} source files</div>
            </div>
          `).join('')}
        </div>
      </article>
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <h3 class="font-semibold text-gray-800 mb-3">Active Categories</h3>
        <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
          ${activeCategories.map(item => `
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold text-sm text-gray-800 truncate" title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
                <span class="text-[10px] font-bold text-gray-500">${Formatters.formatNumber(item.rootJsonCount, 0)} files</span>
              </div>
              <div class="mt-1 text-[11px] text-gray-500 break-words">${escapeHtml(item.usage || '')}</div>
            </div>
          `).join('')}
        </div>
        ${componentAsOf.length ? `
          <div class="mt-3 flex flex-wrap gap-2">
            ${componentAsOf.map(item => `
              <span class="rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-500">${escapeHtml(item.id)} · ${escapeHtml(item.asOf || '-')}</span>
            `).join('')}
          </div>
        ` : ''}
      </article>
    `;
  }

  function renderDepthUnavailable(message) {
    if (!elements?.depthContainer) return;
    elements.depthContainer.innerHTML = `
      <div class="xl:col-span-3 rounded-xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
        <div class="font-semibold mb-1">데이터 깊이 커버리지 확인 불가</div>
        <div class="break-words">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderDepthMetric(label, value) {
    return `
      <div class="rounded-lg bg-gray-50 p-3">
        <div class="text-xs text-gray-500">${escapeHtml(label)}</div>
        <div class="text-lg font-semibold text-gray-900">${Formatters.formatNumber(value || 0, 0)}</div>
      </div>
    `;
  }

  function renderMarketAuditLoading() {
    if (!elements?.marketAuditContainer) return;
    elements.marketAuditContainer.innerHTML = `
      ${Array.from({ length: 4 }, () => `
        <div class="bg-white rounded-xl p-5 shadow animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div class="h-10 bg-gray-100 rounded mb-3"></div>
          <div class="h-3 bg-gray-200 rounded w-4/5"></div>
        </div>
      `).join('')}
    `;
  }

  function renderMarketDataAudit(audit, sourceParity, stockanalysisIndex, etfClassification) {
    if (!elements?.marketAuditContainer) return;
    const stockanalysis = audit?.stockanalysis || {};
    const backfill = audit?.backfill || {};
    const facts = audit?.market_facts || {};
    const parity = audit?.market_source_parity?.summary || audit?.market_source_parity || {};
    const transientFileCount = Number(backfill.transient_file_count || 0);
    const ignoredChunkCount = Array.isArray(backfill.ignored_chunks) ? backfill.ignored_chunks.length : 0;
    const ready = backfill.ready_for_finalize === true
      && Number(backfill.hard_error_count || 0) === 0
      && Array.isArray(backfill.missing_offsets)
      && backfill.missing_offsets.length === 0
      && transientFileCount === 0
      && Number(facts.policy_mismatch_fields || 0) === 0
      && Number(facts.percent_scale_warnings || 0) === 0;
    const generatedAt = audit?.market_source_parity?.generated_at || audit?.generated_at || '-';

    elements.marketAuditContainer.innerHTML = `
      ${renderMarketAuditCard({
        title: 'ETF 백필',
        status: ready ? 'pass' : 'warn',
        code: ready ? 'READY' : 'CHECK',
        rows: [
          ['Universe', stockanalysis.universe_records],
          ['Detail', `${Formatters.formatNumber(stockanalysis.etf_detail_files || 0, 0)} (${escapeHtml(stockanalysis.etf_backfill_progress || '-')})`],
          ['Rows seen', backfill.rows_seen],
          ['404 expected', backfill.error_kinds?.http_404]
        ]
      })}
      ${renderMarketAuditCard({
        title: '백필 무결성',
        status: Number(backfill.hard_error_count || 0) === 0 && ready ? 'pass' : 'warn',
        code: Number(backfill.hard_error_count || 0) === 0 ? 'HARD 0' : 'HARD',
        rows: [
          ['OK', backfill.status_counts?.ok],
          ['Error', backfill.status_counts?.error],
          ['Hard', backfill.hard_error_count],
          ['Missing', Array.isArray(backfill.missing_offsets) ? backfill.missing_offsets.length : '-']
        ]
      })}
      ${renderMarketAuditCard({
        title: 'DataPack 위생',
        status: transientFileCount === 0 ? 'pass' : 'warn',
        code: transientFileCount === 0 ? 'CLEAN' : `${Formatters.formatNumber(transientFileCount, 0)} TEMP`,
        rows: [
          ['Raw chunks', backfill.raw_chunk_files],
          ['Ignored', ignoredChunkCount],
          ['Temp files', transientFileCount],
          ['Finalize', backfill.ready_for_finalize === true ? 'yes' : 'no']
        ]
      })}
      ${renderMarketAuditCard({
        title: 'Market Facts',
        status: Number(facts.count || 0) >= 5000 ? 'pass' : 'warn',
        code: `${Formatters.formatNumber(facts.count || 0, 0)} facts`,
        rows: [
          ['ETF', facts.coverage?.etf],
          ['Stock', facts.coverage?.stock],
          ['보조 데이터', facts.coverage?.stockanalysis],
          ['재무 후보', facts.coverage?.stockanalysis_financials],
          ['Yahoo', facts.coverage?.yf]
        ]
      })}
      ${renderMarketAuditCard({
        title: 'Source Parity',
        status: Number(facts.policy_mismatch_fields || 0) === 0 && Number(facts.percent_scale_warnings || 0) === 0 ? 'pass' : 'warn',
        code: escapeHtml(generatedAt).slice(0, 10),
        rows: [
          ['Inspected', parity.inspected_ticker_files || facts.audited_ticker_files],
          ['Multi-candidate', parity.multi_candidate_fields || facts.multi_candidate_fields],
          ['Divergence', parity.divergence_rows],
          ['Scale warn', facts.percent_scale_warnings]
        ]
      })}
      ${renderEtfClassificationAudit(etfClassification)}
      ${renderStockanalysisFetchAudit(stockanalysisIndex)}
      ${renderSourceParityDetail(sourceParity)}
    `;
  }

  function renderEtfClassificationAudit(report) {
    const universe = findClassificationResult(report, 'etf_universe.json');
    const screener = findClassificationResult(report, 'surfaces/etf_screener.json');
    if (!universe && !screener) return '';
    const generatedAt = report?.generated_at || '-';
    return renderMarketAuditCard({
      title: 'ETF 분류',
      status: 'pass',
      code: escapeHtml(generatedAt).slice(0, 10),
      rows: [
        ['Universe L/I/S', formatClassificationCounts(universe?.classification)],
        ['Screener L/I/S', formatClassificationCounts(screener?.classification)],
        ['Universe rows', universe?.records],
        ['Screener rows', screener?.records]
      ]
    });
  }

  function renderStockanalysisFetchAudit(index) {
    const counts = index?.counts || {};
    const requested = Number(counts.etfs_requested || 0);
    if (!index || requested <= 0) return '';
    const ok = Number(counts.ok || 0);
    const failed = Number(counts.failed || 0);
    const hardFailed = Number(counts.hard_failed || 0);
    const source404 = Array.isArray(index.results)
      ? index.results.filter((row) => String(row?.error || '').includes('404')).length
      : failed;
    return renderMarketAuditCard({
      title: '신규 ETF 상세',
      status: hardFailed === 0 ? 'pass' : 'warn',
      code: `${Formatters.formatNumber(ok, 0)}/${Formatters.formatNumber(requested, 0)} OK`,
      rows: [
        ['Requested', requested],
        ['OK', ok],
        ['Source 404', source404],
        ['Hard fail', hardFailed]
      ]
    });
  }

  function findClassificationResult(report, path) {
    const results = Array.isArray(report?.results) ? report.results : [];
    return results.find((row) => row?.path === path || String(row?.path || '').endsWith(path));
  }

  function formatClassificationCounts(classification) {
    if (!classification) return '-';
    return [
      Formatters.formatNumber(classification.leveraged || 0, 0),
      Formatters.formatNumber(classification.inverse || 0, 0),
      Formatters.formatNumber(classification.single_stock || 0, 0)
    ].join(' / ');
  }

  /**
   * Source Parity v1 detail block: diagnosis-count strip, Top Stale and
   * Top Sign Divergence tables, plus a user-readable explainer line.
   */
  function renderSourceParityDetail(sourceParity) {
    if (!sourceParity) {
      return `
        <div class="xl:col-span-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
          Source Parity 상세 데이터 없음 (computed/market_source_parity.json)
        </div>
      `;
    }

    const summary = sourceParity.summary || {};
    const counts = summary.diagnosis_counts || {};
    const diagItems = [
      ['stale', 'Stale'],
      ['scale_mismatch', 'Scale mismatch'],
      ['sign_divergence', 'Sign divergence'],
      ['value_drift', 'Value drift'],
      ['agreement', 'Agreement']
    ];
    const diagStrip = diagItems
      .map(([key, label]) => renderAuditMetric(label, Formatters.formatNumber(counts[key] || 0, 0)))
      .join('');

    const topStale = Array.isArray(sourceParity.top_stale) ? sourceParity.top_stale.slice(0, 8) : [];
    const topSignDiv = Array.isArray(sourceParity.top_sign_divergences)
      ? sourceParity.top_sign_divergences.slice(0, 6)
      : [];

    const staleTable = topStale.length
      ? renderParityTable(
          ['Ticker', 'Field', 'Selected', 'Stale sources', 'Spread %', 'Freshness'],
          topStale.map((row) => [
            escapeHtml(row.ticker ?? '-'),
            escapeHtml(row.field ?? '-'),
            escapeHtml(row.selected_source ?? '-'),
            escapeHtml((Array.isArray(row.stale_sources) ? row.stale_sources : []).join(', ') || '-'),
            escapeHtml(formatSpreadPct(row.relative_spread_pct)),
            escapeHtml(formatFreshness(row.freshness))
          ])
        )
      : '<div class="text-xs text-gray-400">No stale rows.</div>';

    const signTable = topSignDiv.length
      ? renderParityTable(
          ['Ticker', 'Field', 'Values', 'Spread %'],
          topSignDiv.map((row) => [
            escapeHtml(row.ticker ?? '-'),
            escapeHtml(row.field ?? '-'),
            escapeHtml(formatParityValues(row.values)),
            escapeHtml(formatSpreadPct(row.relative_spread_pct))
          ])
        )
      : '<div class="text-xs text-gray-400">No sign divergences.</div>';

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">Source Parity 진단 상세</h3>
            <p class="text-xs text-gray-500 mt-1">computed/market_source_parity.json</p>
          </div>
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">진단 분포</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">${diagStrip}</div>
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Top Stale (소스 간 시점 차이 상위)
          </div>
          ${staleTable}
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Top Sign Divergence (부호 불일치 상위)
          </div>
          ${signTable}
        </div>
        <p class="text-[11px] leading-relaxed text-gray-500">
          상대 staleness = 소스 간 시점 차이(가장 신선한 후보 대비). 절대적인 데이터 노후 여부는 별도 freshness/audit 책임입니다.
        </p>
      </section>
    `;
  }

  function renderParityTable(headers, rows) {
    return `
      <div class="overflow-x-auto">
        <table class="min-w-full text-xs">
          <thead>
            <tr class="border-b border-gray-200 text-left text-[11px] font-semibold text-gray-400">
              ${headers.map((h) => `<th class="py-1.5 pr-3 whitespace-nowrap">${escapeHtml(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((cells) => `
              <tr class="border-b border-gray-50">
                ${cells.map((cell) => `<td class="py-1.5 pr-3 align-top text-gray-700">${cell}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function formatSpreadPct(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return `${Formatters.formatNumber(Number(value), 1)}%`;
  }

  function formatFreshness(freshness) {
    if (!freshness || typeof freshness !== 'object') return '-';
    const parts = Object.entries(freshness)
      .map(([source, age]) => `${source}=${Formatters.formatNumber(Number(age) || 0, 1)}d`);
    return parts.length ? parts.join(', ') : '-';
  }

  function formatParityValues(values) {
    if (!Array.isArray(values) || !values.length) return '-';
    return values
      .map((entry) => `${entry?.source ?? '?'}=${Formatters.formatNumber(Number(entry?.value) || 0, 2)}`)
      .join(', ');
  }

  function renderMarketAuditUnavailable(message) {
    if (!elements?.marketAuditContainer) return;
    elements.marketAuditContainer.innerHTML = `
      <div class="xl:col-span-4 rounded-xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
        <div class="font-semibold mb-1">시장 데이터 감사 확인 불가</div>
        <div class="break-words">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderMarketAuditCard({ title, status, code, rows }) {
    const styles = status === 'pass'
      ? 'bg-green-100 text-green-700 border-green-200'
      : 'bg-yellow-100 text-yellow-700 border-yellow-200';
    return `
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">${escapeHtml(title)}</h3>
            <p class="text-xs text-gray-500 mt-1">computed/market_data_audit.json</p>
          </div>
          <span class="shrink-0 px-2 py-1 rounded-full border text-xs font-bold ${styles}">${escapeHtml(code || status.toUpperCase())}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${rows.map(([label, value]) => renderAuditMetric(label, value)).join('')}
        </div>
      </article>
    `;
  }

  function renderAuditMetric(label, value) {
    const display = typeof value === 'number'
      ? Formatters.formatNumber(value, 0)
      : String(value ?? '-');
    return `
      <div class="rounded-lg bg-gray-50 px-3 py-2">
        <div class="text-[11px] font-semibold text-gray-400">${escapeHtml(label)}</div>
        <div class="mt-0.5 min-w-0 break-words text-sm font-black text-gray-800">${escapeHtml(display)}</div>
      </div>
    `;
  }

  function renderStockFieldLoading() {
    if (!elements?.stockFieldContainer) return;
    elements.stockFieldContainer.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
        ${Array.from({ length: 4 }, () => `
          <div class="bg-white rounded-xl p-5 shadow animate-pulse">
            <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div class="h-10 bg-gray-100 rounded mb-3"></div>
            <div class="h-3 bg-gray-200 rounded w-4/5"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderStockFieldManifest(manifest) {
    if (!elements?.stockFieldContainer) return;
    if (manifest) {
      stockFieldManifest = manifest;
    }
    if (!stockFieldManifest) {
      renderStockFieldUnavailable('stock field manifest is empty');
      return;
    }

    const totals = stockFieldManifest.totals || {};
    const datasets = stockFieldManifest.datasets || [];
    const rows = getStockFieldRows();
    const pageCount = Math.max(1, Math.ceil(rows.length / STOCK_FIELD_PAGE_SIZE));
    stockFieldView.page = Math.min(Math.max(0, stockFieldView.page), pageCount - 1);
    const offset = stockFieldView.page * STOCK_FIELD_PAGE_SIZE;
    const pageRows = rows.slice(offset, offset + STOCK_FIELD_PAGE_SIZE);

    elements.stockFieldContainer.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
        ${renderStockFieldTotalCard('파일', totals.parsedFileCount, 'parsed')}
        ${renderStockFieldTotalCard('필드', totals.fieldCount, 'schema')}
        ${renderStockFieldTotalCard('화면 사용', totals.statusCounts?.visually_rendered, 'rendered')}
        ${renderStockFieldTotalCard('미사용', totals.statusCounts?.not_yet_used, 'backlog')}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-4">
        ${datasets.map(renderStockDatasetCard).join('')}
      </div>

      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 class="font-semibold text-gray-800">필드 맵</h3>
            <p class="mt-1 text-xs text-gray-500">${escapeHtml(stockFieldManifest.generated_at || '-')}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            ${STOCK_FIELD_STATUS_ORDER.map(renderStockStatusButton).join('')}
            <button
              type="button"
              onclick="DataLabUI.toggleStockFieldDebug()"
              class="rounded-lg border px-3 py-1.5 text-xs font-bold ${stockFieldView.debug ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}"
            >
              Debug
            </button>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          ${renderStockDatasetButton('all', '전체')}
          ${datasets.map(dataset => renderStockDatasetButton(dataset.id, dataset.productLabel || dataset.id)).join('')}
        </div>

        <div class="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <div class="min-w-[720px]">
            <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_90px_120px] gap-0 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <div>데이터셋</div>
              <div>필드</div>
              <div class="text-right">등장</div>
              <div class="text-right">상태</div>
            </div>
            <div class="divide-y divide-gray-100">
              ${pageRows.length ? pageRows.map(renderStockFieldRow).join('') : renderStockFieldEmpty()}
            </div>
          </div>
        </div>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="text-xs text-gray-500">
            ${Formatters.formatNumber(rows.length, 0)} fields · ${Formatters.formatNumber(stockFieldView.page + 1, 0)} / ${Formatters.formatNumber(pageCount, 0)}
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              onclick="DataLabUI.setStockFieldPage(${Math.max(0, stockFieldView.page - 1)})"
              class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 ${stockFieldView.page <= 0 ? 'opacity-40 pointer-events-none' : ''}"
            >
              이전
            </button>
            <button
              type="button"
              onclick="DataLabUI.setStockFieldPage(${Math.min(pageCount - 1, stockFieldView.page + 1)})"
              class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 ${stockFieldView.page >= pageCount - 1 ? 'opacity-40 pointer-events-none' : ''}"
            >
              다음
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderStockFieldUnavailable(message) {
    if (!elements?.stockFieldContainer) return;
    elements.stockFieldContainer.innerHTML = `
      <div class="rounded-xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
        <div class="font-semibold mb-1">종목 필드 사용현황 확인 불가</div>
        <div class="break-words">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderStockFieldTotalCard(label, value, code) {
    return `
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-bold uppercase tracking-wide text-gray-400">${escapeHtml(code)}</div>
            <h3 class="mt-1 text-sm font-semibold text-gray-700">${escapeHtml(label)}</h3>
          </div>
          <div class="text-2xl font-black text-slate-900">${Formatters.formatNumber(value || 0, 0)}</div>
        </div>
      </article>
    `;
  }

  function renderStockDatasetCard(dataset) {
    const counts = dataset.statusCounts || {};
    return `
      <article class="bg-white rounded-xl p-4 shadow border border-gray-100">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="truncate text-sm font-black text-gray-800" title="${escapeHtml(dataset.productLabel || dataset.id)}">${escapeHtml(dataset.productLabel || dataset.id)}</h3>
            <p class="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">${escapeHtml(dataset.id)}</p>
          </div>
          <span class="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-500">
            ${Formatters.formatNumber(dataset.fieldCount || 0, 0)}
          </span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          ${renderMiniCount('화면', counts.visually_rendered)}
          ${renderMiniCount('해석', counts.interpreted)}
          ${renderMiniCount('메타', counts.metadata)}
          ${renderMiniCount('미사용', counts.not_yet_used)}
        </div>
        ${stockFieldView.debug ? `<div class="mt-3 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500 break-words">${escapeHtml(dataset.internalSource || '-')}</div>` : ''}
      </article>
    `;
  }

  function renderMiniCount(label, value) {
    return `
      <div class="rounded-lg bg-gray-50 px-2 py-1.5">
        <span class="text-gray-400">${escapeHtml(label)}</span>
        <span class="float-right font-bold text-gray-700">${Formatters.formatNumber(value || 0, 0)}</span>
      </div>
    `;
  }

  function renderStockStatusButton(status) {
    const active = stockFieldView.status === status;
    const count = stockFieldManifest?.totals?.statusCounts?.[status] || 0;
    return `
      <button
        type="button"
        onclick="DataLabUI.setStockFieldStatus('${escapeJs(status)}')"
        class="rounded-lg border px-3 py-1.5 text-xs font-bold ${active ? stockStatusStyle(status) : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}"
      >
        ${escapeHtml(STOCK_FIELD_STATUS_LABELS[status] || status)}
        <span class="ml-1 opacity-75">${Formatters.formatNumber(count, 0)}</span>
      </button>
    `;
  }

  function renderStockDatasetButton(datasetId, label) {
    const active = stockFieldView.datasetId === datasetId;
    return `
      <button
        type="button"
        onclick="DataLabUI.setStockFieldDataset('${escapeJs(datasetId)}')"
        class="rounded-lg border px-3 py-1.5 text-xs font-bold ${active ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  function renderStockFieldRow(row) {
    const hits = row.consumerHits || [];
    const debugLines = stockFieldView.debug ? `
      <div class="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
        ${row.sampleFiles?.length ? `<div>sample: ${escapeHtml(row.sampleFiles.join(', '))}</div>` : ''}
        ${hits.length ? `<div>hits: ${escapeHtml(hits.map(hit => `${hit.file} [${(hit.tokens || []).join(',')}]`).join(' · '))}</div>` : ''}
      </div>
    ` : '';

    return `
      <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_90px_120px] gap-0 px-3 py-3 text-sm">
        <div class="min-w-0 pr-3">
          <div class="truncate font-semibold text-gray-800" title="${escapeHtml(row.datasetLabel)}">${escapeHtml(row.datasetLabel)}</div>
          <div class="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">${escapeHtml(row.datasetId)}</div>
        </div>
        <div class="min-w-0 pr-3">
          <code class="break-words text-xs font-semibold text-slate-700">${escapeHtml(row.path)}</code>
          <div class="mt-1 flex flex-wrap gap-1">
            ${(row.valueKinds || []).map(kind => `<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">${escapeHtml(kind)}</span>`).join('')}
            ${hits.length ? `<span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">${Formatters.formatNumber(hits.length, 0)} hit</span>` : ''}
          </div>
          ${debugLines}
        </div>
        <div class="text-right font-bold text-gray-700">${Formatters.formatNumber(row.presenceCount || 0, 0)}</div>
        <div class="text-right">
          <span class="inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${stockStatusStyle(row.status)}">
            ${escapeHtml(STOCK_FIELD_STATUS_LABELS[row.status] || row.status)}
          </span>
        </div>
      </div>
    `;
  }

  function renderStockFieldEmpty() {
    return `
      <div class="px-3 py-8 text-center text-sm font-semibold text-gray-400">
        표시할 필드가 없습니다.
      </div>
    `;
  }

  function getStockFieldRows() {
    const datasets = stockFieldManifest?.datasets || [];
    const rows = [];
    datasets.forEach(dataset => {
      if (stockFieldView.datasetId !== 'all' && dataset.id !== stockFieldView.datasetId) return;
      (dataset.fields || []).forEach(field => {
        if (field.status !== stockFieldView.status) return;
        rows.push({
          ...field,
          datasetId: dataset.id,
          datasetLabel: dataset.productLabel || dataset.id,
          internalSource: dataset.internalSource
        });
      });
    });
    return rows.sort((a, b) => {
      if (a.datasetId !== b.datasetId) return a.datasetId.localeCompare(b.datasetId);
      return a.path.localeCompare(b.path);
    });
  }

  function setStockFieldStatus(status) {
    if (!STOCK_FIELD_STATUS_ORDER.includes(status)) return;
    stockFieldView = { ...stockFieldView, status, page: 0 };
    renderStockFieldManifest();
  }

  function setStockFieldDataset(datasetId) {
    const datasetIds = new Set(['all', ...(stockFieldManifest?.datasets || []).map(item => item.id)]);
    if (!datasetIds.has(datasetId)) return;
    stockFieldView = { ...stockFieldView, datasetId, page: 0 };
    renderStockFieldManifest();
  }

  function setStockFieldPage(page) {
    stockFieldView = { ...stockFieldView, page: Number.isFinite(Number(page)) ? Number(page) : 0 };
    renderStockFieldManifest();
  }

  function toggleStockFieldDebug() {
    stockFieldView = { ...stockFieldView, debug: !stockFieldView.debug };
    renderStockFieldManifest();
  }

  function stockStatusStyle(status) {
    return STOCK_FIELD_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 border-gray-200';
  }

  function renderOpsCard({ title, icon, description, items }) {
    const failed = items.filter(item => item.status === 'fail').length;
    const warn = items.filter(item => item.status === 'warn').length;
    const skipped = items.filter(item => item.status === 'skip').length;
    const allSkipped = items.length > 0 && skipped === items.length;
    const badge = failed > 0
      ? { text: 'FAIL', cls: 'bg-red-100 text-red-700 border-red-200' }
      : warn > 0
        ? { text: 'WARN', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' }
        : allSkipped
          ? { text: 'SKIP', cls: 'bg-gray-100 text-gray-600 border-gray-200' }
          : { text: 'PASS', cls: 'bg-green-100 text-green-700 border-green-200' };

    return `
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <div class="flex items-center gap-2">
              <i class="fas ${icon} text-blue-500"></i>
              <h3 class="font-semibold text-gray-800">${title}</h3>
            </div>
            <p class="text-xs text-gray-500 mt-1">${description}</p>
          </div>
          <span class="px-2 py-1 rounded-full border text-xs font-bold ${badge.cls}">${badge.text}</span>
        </div>
        <div class="space-y-2">
          ${items.map(renderOpsItem).join('')}
        </div>
        ${skipped > 0 ? `<div class="text-[11px] text-gray-400 mt-3">${skipped} skipped outside target runtime</div>` : ''}
      </article>
    `;
  }

  function renderOpsItem(item) {
    const meta = {
      pass: { icon: 'fa-circle-check', cls: 'text-green-600', bg: 'bg-green-50 border-green-100' },
      fail: { icon: 'fa-circle-xmark', cls: 'text-red-600', bg: 'bg-red-50 border-red-100' },
      warn: { icon: 'fa-triangle-exclamation', cls: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-100' },
      skip: { icon: 'fa-circle-minus', cls: 'text-gray-500', bg: 'bg-gray-50 border-gray-100' }
    }[item.status] || { icon: 'fa-circle-question', cls: 'text-gray-500', bg: 'bg-gray-50 border-gray-100' };

    return `
      <div class="rounded-lg border ${meta.bg} p-3">
        <div class="flex items-start gap-3">
          <i class="fas ${meta.icon} ${meta.cls} mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-3">
              <div class="font-medium text-sm text-gray-800 truncate" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
              ${item.code ? `<code class="text-[11px] text-gray-500">${escapeHtml(item.code)}</code>` : ''}
            </div>
            <div class="text-xs text-gray-500 mt-1 break-words">${escapeHtml(item.detail || '')}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render folder details panel
   * @param {string} folderName
   * @param {Object} config
   * @param {Object} schema
   * @param {Object} freshness
   */
  function renderDetails(folderName, config, schema, freshness) {
    if (!elements?.detailsPanel) return;

    const color = StatusCard.getColor(folderName);
    const icon = StatusCard.getIcon(folderName);
    const statusClasses = FreshnessChecker.getStatusClasses(freshness.status);

    elements.detailsPanel.innerHTML = `
      <div class="p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 bg-${color}-100 rounded-xl flex items-center justify-center">
              <i class="fas ${icon} text-${color}-500 text-2xl"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-800">${capitalizeFirst(folderName)}</h2>
              <p class="text-gray-500">${config.description || ''}</p>
            </div>
          </div>
          <button onclick="DataLabUI.closeDetails()" class="text-gray-400 hover:text-gray-600 p-2">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <!-- Status Badge -->
        <div class="mb-6 p-4 rounded-xl ${statusClasses.bg} ${statusClasses.border} border">
          <div class="flex items-center justify-between">
            <span class="text-lg">${freshness.signal} ${freshness.label}</span>
            <span class="text-sm ${statusClasses.text}">
              업데이트 ${FreshnessChecker.formatDaysAgo(freshness.daysAgo)}
            </span>
          </div>
        </div>

        <!-- Info Grid -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-sm text-gray-500">버전</div>
            <div class="text-lg font-semibold">${Formatters.formatVersion(config.version)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-sm text-gray-500">파일</div>
            <div class="text-lg font-semibold">${Formatters.formatNumber(config.file_count, 0)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-sm text-gray-500">업데이트 주기</div>
            <div class="text-lg font-semibold capitalize">${config.update_frequency || '-'}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-sm text-gray-500">소스</div>
            <div class="text-lg font-semibold truncate" title="${config.source || '-'}">${config.source || '-'}</div>
          </div>
        </div>

        <!-- Schema Info -->
        ${schema ? renderSchemaInfo(schema) : '<p class="text-gray-400 text-sm italic">스키마 없음</p>'}
      </div>
    `;

    // Show panel
    elements.detailsPanel.classList.remove('hidden');
  }

  /**
   * Render schema information
   * @param {Object} schema
   * @returns {string} HTML string
   */
  function renderSchemaInfo(schema) {
    const filesSection = schema.files ? Object.keys(schema.files).length : 0;

    return `
      <div class="border-t pt-6">
        <h3 class="font-semibold text-gray-700 mb-3">스키마 정보</h3>
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-gray-500">스키마 버전:</span>
              <span class="font-medium ml-2">${schema.version || '-'}</span>
            </div>
            <div>
              <span class="text-gray-500">정의된 파일:</span>
              <span class="font-medium ml-2">${filesSection}</span>
            </div>
          </div>
          ${schema.files ? `
            <div class="mt-4">
              <div class="text-gray-500 text-sm mb-2">파일 목록:</div>
              <div class="flex flex-wrap gap-2">
                ${Object.keys(schema.files).map(f => `
                  <span class="px-2 py-1 bg-gray-200 rounded text-xs">${f}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Hide details panel
   */
  function hideDetails() {
    if (elements?.detailsPanel) {
      elements.detailsPanel.classList.add('hidden');
    }
  }

  /**
   * Update last updated timestamp
   * @param {string} timestamp
   */
  function updateTimestamp(timestamp) {
    if (elements?.timestampEl) {
      elements.timestampEl.textContent = `마지막 업데이트: ${Formatters.formatDate(timestamp, 'YYYY-MM-DD')}`;
    }
  }

  /**
   * Helper: capitalize first letter of each word
   */
  function capitalizeFirst(str) {
    return str.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeJs(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  return {
    init,
    renderSummary,
    renderCards,
    renderLoading,
    renderError,
    renderOpsLoading,
    renderOpsResults,
    renderOpsUnavailable,
    renderDepthLoading,
    renderDepthCoverage,
    renderDepthUnavailable,
    renderMarketAuditLoading,
    renderMarketDataAudit,
    renderMarketAuditUnavailable,
    renderStockFieldLoading,
    renderStockFieldManifest,
    renderStockFieldUnavailable,
    setStockFieldStatus,
    setStockFieldDataset,
    setStockFieldPage,
    toggleStockFieldDebug,
    renderDetails,
    hideDetails,
    updateTimestamp
  };
})();
