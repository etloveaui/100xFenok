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
        description: '실제 화면이 읽는 JSON 기준 시각',
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
            <h3 class="font-semibold text-gray-800">미러/사용 현황</h3>
            <p class="text-xs text-gray-500 mt-1 break-words">${escapeHtml(manifest?.generated_at || '-')}</p>
          </div>
          <span class="px-2 py-1 rounded-full border text-xs font-bold ${manifest?.mirror_sync_status === 'ok' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}">
            ${manifest?.mirror_sync_status === 'ok' ? '동기화됨' : '점검'}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          ${renderDepthMetric('루트 JSON', totals.rootJsonCount)}
          ${renderDepthMetric('공개 JSON', totals.publicJsonCount)}
          ${renderDepthMetric('직접 호출', totals.directDataFetchCount)}
          ${renderDepthMetric('동적 경로', totals.dynamicPatternCount)}
        </div>
      </article>
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <h3 class="font-semibold text-gray-800 mb-3">생성 인덱스</h3>
        <div class="space-y-2">
          ${generated.map(item => `
            <div class="rounded-lg border ${item.mirrored ? 'bg-green-50 border-green-100' : 'bg-yellow-50 border-yellow-100'} p-3">
              <div class="flex items-center justify-between gap-3">
                <code class="min-w-0 truncate text-xs font-semibold text-gray-700" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</code>
                <span class="shrink-0 text-[10px] font-bold ${item.mirrored ? 'text-green-700' : 'text-yellow-700'}">${item.mirrored ? '미러됨' : '점검'}</span>
              </div>
              <div class="mt-1 text-[11px] text-gray-500">원본 파일 ${Formatters.formatNumber(item.sourceFiles?.length || 0, 0)}개</div>
            </div>
          `).join('')}
        </div>
      </article>
      <article class="bg-white rounded-xl p-5 shadow border border-gray-100">
        <h3 class="font-semibold text-gray-800 mb-3">사용 중인 데이터 분류</h3>
        <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
          ${activeCategories.map(item => `
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold text-sm text-gray-800 truncate" title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
                <span class="text-[10px] font-bold text-gray-500">파일 ${Formatters.formatNumber(item.rootJsonCount, 0)}개</span>
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

  function renderMarketDataAudit(
    audit,
    sourceParity,
    stockanalysisIndex,
    stockanalysisCoverage,
    etfClassification,
    stockanalysisSurfaceIndex,
    stockanalysisSurfaceConsumers,
    stockanalysisEtfUniverse,
    stockanalysisEtfUniverseApi,
    stockanalysisNewEtfs,
    stockanalysisIncremental,
    stockanalysisIncrementalPlan,
    stockanalysisHistoryGapReport,
    stockanalysisPendingLedger,
    marketFactsIndex
  ) {
    if (!elements?.marketAuditContainer) return;
    const stockanalysis = audit?.stockanalysis || {};
    const detailCoverage = stockanalysisCoverage || stockanalysisIndex?.etf_detail_coverage || {};
    const detailCoverageCounts = detailCoverage?.counts || {};
    const missingBySource = detailCoverageCounts.missing_by_source || {};
    const backfill = audit?.backfill || {};
    const facts = audit?.market_facts || {};
    const factsCoverage = marketFactsIndex?.coverage || facts.coverage || {};
    const returnCoverage = facts.return_field_coverage || {};
    const returnDenominators = facts.return_field_denominators || {};
    const returnEtfDenominator = Number(returnDenominators.etf || factsCoverage.etf || 0);
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
        title: 'ETF 상세 수집',
        status: ready ? 'pass' : 'warn',
        code: ready ? '정상' : '점검',
        rows: [
          ['전체 후보', detailCoverageCounts.candidate_total ?? stockanalysis.universe_records],
          ['상세 파일', `${Formatters.formatNumber(detailCoverageCounts.covered_detail_files ?? stockanalysis.etf_detail_files ?? 0, 0)} (${Formatters.formatNumber(detailCoverageCounts.coverage_pct ?? 0, 2)}%)`],
          ['기본 상세', `${Formatters.formatNumber(detailCoverageCounts.stockanalysis_detail_files ?? 0, 0)} (${Formatters.formatNumber(detailCoverageCounts.primary_stockanalysis_pct ?? 0, 2)}%)`],
          ['보조 가격 상세', detailCoverageCounts.yahoo_fallback_files],
          ['상세 누락', detailCoverageCounts.missing_detail_files],
          ['신규 ETF 누락', missingBySource.new_etfs],
          ['ETF 목록 누락', missingBySource.etf_universe],
          ['스크리너 누락', missingBySource.etf_screener],
          ['대기 추적', detailCoverageCounts.pending_tracked_missing ?? detailCoverageCounts.pending_tracked]
        ]
      })}
      ${renderMarketAuditCard({
        title: '수집 무결성',
        status: Number(backfill.hard_error_count || 0) === 0 && ready ? 'pass' : 'warn',
        code: Number(backfill.hard_error_count || 0) === 0 ? '치명 0' : '치명',
        rows: [
          ['성공', backfill.status_counts?.ok],
          ['오류', backfill.status_counts?.error],
          ['치명 오류', backfill.hard_error_count],
          ['빈 구간', Array.isArray(backfill.missing_offsets) ? backfill.missing_offsets.length : '-']
        ]
      })}
      ${renderMarketAuditCard({
        title: '수집 파일 정리',
        status: transientFileCount === 0 ? 'pass' : 'warn',
        code: transientFileCount === 0 ? '정리됨' : `임시 ${Formatters.formatNumber(transientFileCount, 0)}`,
        rows: [
          ['원본 파일', backfill.raw_chunk_files],
          ['제외 파일', ignoredChunkCount],
          ['임시 파일', transientFileCount],
          ['최종 반영 가능', backfill.ready_for_finalize === true ? '가능' : '대기']
        ]
      })}
      ${renderMarketAuditCard({
        title: '시장 데이터 정규화',
        status: Number(facts.count || 0) >= 5000 ? 'pass' : 'warn',
        code: `${Formatters.formatNumber(facts.count || 0, 0)}건`,
        rows: [
          ['ETF', factsCoverage.etf],
          ['주식', factsCoverage.stock],
          ['정규화 상세', factsCoverage.stockanalysis],
          ['보조 가격 반영', factsCoverage.stockanalysis_yf_fallback],
          ['가격 원천', factsCoverage.yf]
        ]
      })}
      ${renderMarketAuditCard({
        title: 'ETF 수익률 커버리지',
        status: isReturnCoverageComplete(returnCoverage, returnEtfDenominator) ? 'pass' : 'warn',
        code: `${Formatters.formatNumber(Number(returnCoverage?.return_1y?.etf || 0), 0)} / ${Formatters.formatNumber(returnEtfDenominator, 0)}`,
        rows: [
          ['1개월', formatReturnCoverage(returnCoverage.return_1m, returnEtfDenominator)],
          ['3개월', formatReturnCoverage(returnCoverage.return_3m, returnEtfDenominator)],
          ['YTD', formatReturnCoverage(returnCoverage.return_ytd, returnEtfDenominator)],
          ['1년', formatReturnCoverage(returnCoverage.return_1y, returnEtfDenominator)],
          ['3년 CAGR', formatReturnCoverage(returnCoverage.return_3y_avg, returnEtfDenominator)],
          ['5년 CAGR', formatReturnCoverage(returnCoverage.return_5y_avg, returnEtfDenominator)],
          ['10년 CAGR', formatReturnCoverage(returnCoverage.return_10y_avg, returnEtfDenominator)],
          ['상장 이후 CAGR', formatReturnCoverage(returnCoverage.return_max_avg, returnEtfDenominator)]
        ]
      })}
      ${renderMarketAuditCard({
        title: '소스 일치성',
        status: Number(facts.policy_mismatch_fields || 0) === 0 && Number(facts.percent_scale_warnings || 0) === 0 ? 'pass' : 'warn',
        code: escapeHtml(generatedAt).slice(0, 10),
        rows: [
          ['검사 파일', parity.inspected_ticker_files || facts.audited_ticker_files],
          ['복수 후보', parity.multi_candidate_fields || facts.multi_candidate_fields],
          ['차이', parity.divergence_rows],
          ['단위 경고', facts.percent_scale_warnings]
        ]
      })}
      ${renderEtfClassificationAudit(etfClassification)}
      ${renderEtfUniverseSnapshot(stockanalysisEtfUniverse, stockanalysisEtfUniverseApi, stockanalysisNewEtfs, detailCoverage)}
      ${renderEtfCoverageGapAudit(detailCoverage)}
      ${renderStockanalysisSurfaceCatalog(stockanalysisSurfaceIndex, stockanalysisSurfaceConsumers)}
      ${renderStockanalysisFetchAudit(stockanalysisIndex)}
      ${renderIncrementalBackfillAudit(stockanalysisIndex, stockanalysisIncremental, stockanalysisIncrementalPlan, marketFactsIndex, audit?.incremental_etf)}
      ${renderHistoryGapPreflightAudit(stockanalysisHistoryGapReport)}
      ${renderEtfBackfillDrilldown(stockanalysisIndex, stockanalysisIncremental, stockanalysisIncrementalPlan, stockanalysisPendingLedger)}
      ${renderSourceParityDetail(sourceParity)}
    `;
  }

  function isReturnCoverageComplete(coverage, denominator) {
    if (!denominator) return false;
    return ['return_1m', 'return_3m', 'return_ytd', 'return_1y'].every((field) =>
      Number(coverage?.[field]?.etf || 0) >= denominator
    );
  }

  function formatReturnCoverage(row, denominator) {
    const count = Number(row?.etf || 0);
    const pct = Number.isFinite(Number(row?.etf_coverage_pct))
      ? Number(row.etf_coverage_pct)
      : (denominator ? (count / denominator) * 100 : 0);
    const sources = formatReturnSourceBreakdown(row);
    return `${Formatters.formatNumber(count, 0)} / ${Formatters.formatNumber(denominator, 0)} (${Formatters.formatNumber(pct, 1)}%)${sources ? ` · ${sources}` : ''}`;
  }

  function formatReturnSourceBreakdown(row) {
    if (!row || typeof row !== 'object') return '';
    return [
      formatSourceCount('가격 히스토리', row.yf_history_1y),
      formatSourceCount('요약값', row.yf_info),
      formatSourceCount('상세 히스토리', row.stockanalysis_history),
      formatSourceCount('성과표', row.stockanalysis_performance)
    ].filter(Boolean).join(' · ');
  }

  function formatSourceCount(label, value) {
    const count = Number(value || 0);
    if (!Number.isFinite(count) || count <= 0) return '';
    return `${label} ${Formatters.formatNumber(count, 0)}`;
  }

  function renderEtfUniverseSnapshot(universe, mergedUniverse, newEtfs, coverage) {
    const universeCounts = universe?.counts || {};
    const mergedCounts = mergedUniverse?.counts || {};
    const classification = universeCounts.classification || {};
    const newRows = Array.isArray(newEtfs?.records) ? newEtfs.records : [];
    const coverageCounts = coverage?.counts || {};
    const sourceBreakdown = coverageCounts.source_breakdown || {};
    const missingBySource = coverageCounts.missing_by_source || {};
    if (!universe && !mergedUniverse && !newRows.length) return '';

    const newestRows = [...newRows]
      .filter((row) => row?.s)
      .sort((a, b) => String(b?.inceptionDate || '').localeCompare(String(a?.inceptionDate || '')) || String(a?.s || '').localeCompare(String(b?.s || '')))
      .slice(0, 8);
    const latestDate = newestRows[0]?.inceptionDate || newEtfs?.fetched_at || '-';
    const fetchedAt = newEtfs?.fetched_at || mergedUniverse?.screener_fetched_at || universe?.generated_at || '-';

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-4">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">ETF 목록·신규 상장 스냅샷</h3>
            <p class="text-xs text-gray-500 mt-1">ETF 목록 API · 신규 상장 데이터 · 상세 커버리지</p>
          </div>
          <span class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-500">
            ${escapeHtml(fetchedAt).slice(0, 10)}
          </span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          ${renderAuditMetric('전체 ETF', mergedCounts.records ?? universeCounts.records ?? sourceBreakdown.etf_universe)}
          ${renderAuditMetric('가격 제공', mergedCounts.with_price)}
          ${renderAuditMetric('거래량 제공', mergedCounts.with_volume)}
          ${renderAuditMetric('보유종목 제공', mergedCounts.with_holdings)}
          ${renderAuditMetric('보수율 제공', mergedCounts.with_expense_ratio ?? universeCounts.detail_enrichment?.expense_ratio)}
          ${renderAuditMetric('기간 수익률 제공', mergedCounts.with_performance ?? universeCounts.detail_enrichment?.performance)}
          ${renderAuditMetric('목록 추가분', mergedCounts.screener_only)}
          ${renderAuditMetric('신규 상장', newEtfs?.counts?.records ?? newRows.length)}
          ${renderAuditMetric('최신 상장일', escapeHtml(latestDate).slice(0, 10))}
          ${renderAuditMetric('신규 상세 대기', missingBySource.new_etfs)}
          ${renderAuditMetric('레버리지', classification.leveraged)}
          ${renderAuditMetric('단일종목', classification.single_stock)}
          ${renderAuditMetric('인버스', classification.inverse)}
          ${renderAuditMetric('상세 커버리지', `${Formatters.formatNumber(coverageCounts.coverage_pct || 0, 2)}%`)}
        </div>
        ${newestRows.length ? `
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            ${newestRows.map((row) => renderNewEtfMiniCard(row)).join('')}
          </div>
        ` : `
          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs font-semibold text-gray-400">표시할 신규 ETF가 없습니다.</div>
        `}
        <p class="text-[11px] leading-relaxed text-gray-500">
          공개 ETF 목록은 ETF 목록 API에서 가격, 변동률, 거래량, 보유종목 수, 보수율, 기간 수익률을 함께 읽습니다. 상세 파일이 아직 없으면 공개 상세는 요약/가격 제공 상태로 열리고, 다음 데이터 갱신에서 보유 구성과 분류가 자동 보강됩니다.
        </p>
      </section>
    `;
  }

  function renderNewEtfMiniCard(row) {
    const ticker = String(row?.s || '').trim().toUpperCase();
    const name = String(row?.n || ticker || '-').trim();
    const date = String(row?.inceptionDate || '-').slice(0, 10);
    const price = typeof row?.price === 'number' && Number.isFinite(row.price)
      ? `$${Formatters.formatNumber(row.price, 2)}`
      : '-';
    const change = typeof row?.change === 'number' && Number.isFinite(row.change)
      ? `${row.change >= 0 ? '+' : ''}${Formatters.formatNumber(row.change, 2)}%`
      : '-';
    return `
      <a href="/etfs/${encodeURIComponent(ticker)}" class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-3 transition hover:border-cyan-200 hover:bg-white">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-sm font-black text-gray-800" title="${escapeHtml(name)}">${escapeHtml(ticker || '-')}</div>
            <div class="mt-1 truncate text-[11px] font-semibold text-gray-500" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          </div>
          <span class="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-black text-gray-500">${escapeHtml(date)}</span>
        </div>
        <div class="mt-3 flex items-center justify-between gap-2 text-[11px] font-black">
          <span class="text-gray-500">${escapeHtml(price)}</span>
          <span class="${String(change).startsWith('-') ? 'text-rose-600' : 'text-emerald-600'}">${escapeHtml(change)}</span>
        </div>
      </a>
    `;
  }

  function renderTickerChipList(tickers, tone) {
    if (!tickers.length) {
      return '<div class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs font-semibold text-gray-400">표시할 티커가 없습니다.</div>';
    }
    const toneClass = tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    return `
      <div class="flex flex-wrap gap-1.5">
        ${tickers.map((ticker) => `
          <a
            href="/etfs/${encodeURIComponent(String(ticker || '').trim().toUpperCase())}"
            class="rounded-full border px-2 py-1 text-[11px] font-black ${toneClass}"
          >${escapeHtml(ticker)}</a>
        `).join('')}
      </div>
    `;
  }

  function renderEtfCoverageGapAudit(coverage) {
    const samples = coverage?.samples || {};
    const counts = coverage?.counts || {};
    const reasonSummary = coverage?.missing_reason_summary || counts.missing_failure_breakdown || {};
    const statusSummary = coverage?.missing_status_summary || counts.missing_status_breakdown || {};
    const reasonSamples = coverage?.missing_reason_samples || {};
    const statusSamples = coverage?.missing_status_samples || {};
    const missing = Array.isArray(samples.missing) ? samples.missing.filter(Boolean).slice(0, 36) : [];
    const mismatch = sampleTickers(reasonSamples.external_quote_type_mismatch, samples.missing_external_quote_type_mismatch, 24);
    const untracked = sampleTickers(reasonSamples.untracked, statusSamples.untracked, samples.missing_untracked, 24);
    const cooldown = sampleTickers(statusSamples.retry_cooldown, samples.missing_retry_cooldown, 24);
    const retryPending = sampleTickers(statusSamples.retry_pending, samples.missing_retry_pending, 24);
    const yahooFallback = Array.isArray(samples.yahoo_fallback) ? samples.yahoo_fallback.filter(Boolean).slice(0, 36) : [];
    if (!missing.length && !yahooFallback.length) return '';

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-5">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">ETF 상세 누락 샘플</h3>
            <p class="text-xs text-gray-500 mt-1">coverage/etf_detail.json · 신규 ETF/ETF 목록/스크리너 기준</p>
          </div>
          <span class="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
            ${Formatters.formatNumber(counts.missing_detail_files || missing.length, 0)}개 누락
          </span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          ${renderAuditMetric('신규 ETF 누락', counts.missing_by_source?.new_etfs)}
          ${renderAuditMetric('ETF 목록 누락', counts.missing_by_source?.etf_universe)}
          ${renderAuditMetric('스크리너 누락', counts.missing_by_source?.etf_screener)}
          ${renderAuditMetric('보조 가격 상세', counts.yahoo_fallback_files)}
          ${renderAuditMetric('ETF로 인식되지 않음', reasonSummary.external_quote_type_mismatch)}
          ${renderAuditMetric('아직 재시도 전', reasonSummary.untracked)}
          ${renderAuditMetric('재시도 예약됨', statusSummary.retry_cooldown)}
          ${renderAuditMetric('다음 수집 후보', statusSummary.retry_pending)}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div class="mb-3 text-xs font-black text-gray-700">ETF로 인식되지 않음</div>
            ${renderTickerChipList(mismatch, 'warn')}
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div class="mb-3 text-xs font-black text-gray-700">재시도 예약됨</div>
            ${renderTickerChipList(cooldown, 'warn')}
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div class="mb-3 text-xs font-black text-gray-700">다음 수집 후보</div>
            ${renderTickerChipList(retryPending.length ? retryPending : untracked, 'warn')}
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div class="mb-3 text-xs font-black text-gray-700">보조 가격 임시 적용</div>
            ${renderTickerChipList(yahooFallback, 'ok')}
          </div>
        </div>
        <p class="text-[11px] leading-relaxed text-gray-500">
          이 항목들은 서로 배타적인 합계가 아니라 진단용 분류입니다. 실제 누락 수는 위의 상세 누락 수를 기준으로 보고, ETF 페이지는 먼저 요약 정보로 열리며 다음 수집 또는 보조 가격 상세가 갱신되면 이 분류도 자동으로 바뀝니다.
        </p>
      </section>
    `;
  }

  function sampleTickers(...items) {
    const limit = Number(items[items.length - 1]) || 24;
    const lists = items.slice(0, -1);
    for (const item of lists) {
      if (Array.isArray(item)) {
        const rows = item.filter(Boolean).slice(0, limit);
        if (rows.length) return rows;
      }
    }
    return [];
  }

  function renderStockanalysisSurfaceCatalog(index, consumers) {
    const counts = index?.counts || {};
    const results = Array.isArray(index?.results) ? index.results : [];
    if (!index || results.length === 0) return '';
    const consumerMap = getStockanalysisSurfaceConsumers(consumers);
    const groups = new Map();
    results.forEach((row) => {
      const group = row?.group || 'other';
      const current = groups.get(group) || { count: 0, rows: 0, failed: 0, samples: [] };
      current.count += 1;
      current.rows += Number(row?.rows || 0);
      if (row?.status !== 'ok') current.failed += 1;
      if (current.samples.length < 3 && row?.surface) current.samples.push(row.surface);
      groups.set(group, current);
    });
    const groupRows = Array.from(groups.entries())
      .sort((a, b) => b[1].rows - a[1].rows)
      .slice(0, 6)
      .map(([group, value]) => [
        group,
        `${Formatters.formatNumber(value.rows, 0)}행`,
        `${Formatters.formatNumber(value.count, 0)}개 항목`,
        value.failed ? `${Formatters.formatNumber(value.failed, 0)}개 오류` : '정상',
        value.samples.join(', ')
      ]);
    const connected = results.filter((row) => (consumerMap[row?.surface] || []).length > 0).length;
    const unconnected = results
      .filter((row) => !(consumerMap[row?.surface] || []).length)
      .slice(0, 8)
      .map((row) => row.surface || '-');
    const consumerRows = results
      .map((row) => {
        const consumer = summarizeSurfaceConsumers(consumerMap[row?.surface]);
        return [
          row?.surface || '-',
          consumer,
          `${Formatters.formatNumber(row?.rows || 0, 0)}행`,
          row?.status === 'ok' ? '정상' : '점검'
        ];
      })
      .slice(0, 12);

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">시장 데이터 수집 현황</h3>
            <p class="text-xs text-gray-500 mt-1">data/stockanalysis/surfaces/index.json</p>
          </div>
          <span class="px-2 py-1 rounded-full border text-xs font-bold ${Number(counts.failed || 0) === 0 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}">
            ${Formatters.formatNumber(counts.ok || 0, 0)} / ${Formatters.formatNumber(counts.surfaces_requested || results.length, 0)}
          </span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          ${renderAuditMetric('수집 항목', Formatters.formatNumber(counts.surfaces_requested || results.length, 0))}
          ${renderAuditMetric('정상', Formatters.formatNumber(counts.ok || 0, 0))}
          ${renderAuditMetric('테이블', Formatters.formatNumber(counts.tables || 0, 0))}
          ${renderAuditMetric('행', Formatters.formatNumber(counts.rows || 0, 0))}
          ${renderAuditMetric('화면 연결', `${Formatters.formatNumber(connected, 0)} / ${Formatters.formatNumber(results.length, 0)}`)}
          ${renderAuditMetric('추가 점검', Formatters.formatNumber(unconnected.length, 0))}
        </div>
        ${renderParityTable(
          ['분류', '행', '수집 항목', '상태', '예시'],
          groupRows.map((row) => row.map((cell) => escapeHtml(cell)))
        )}
        ${renderParityTable(
          ['데이터 항목', '대표 화면', '행', '상태'],
          consumerRows.map((row) => row.map((cell) => escapeHtml(cell)))
        )}
        ${unconnected.length ? `
          <p class="text-[11px] leading-relaxed text-amber-700">
            추가 점검 필요: ${escapeHtml(unconnected.join(', '))}
          </p>
        ` : `
          <p class="text-[11px] leading-relaxed text-gray-500">
            수집된 시장 데이터 항목은 공개 화면 또는 종목/ETF 상세 보조 카드와 연결되어 있습니다.
          </p>
        `}
      </section>
    `;
  }

  function getStockanalysisSurfaceConsumers(payload) {
    const map = {};
    const rows = Array.isArray(payload?.surfaces) ? payload.surfaces : [];
    rows.forEach((row) => {
      const surface = String(row?.surface || '').trim();
      if (!surface) return;
      const consumers = Array.isArray(row?.consumers) ? row.consumers : [];
      map[surface] = consumers
        .map(formatSurfaceConsumer)
        .filter(Boolean);
    });
    return map;
  }

  function formatSurfaceConsumer(consumer) {
    const route = String(consumer?.route || '').trim();
    const label = String(consumer?.label || '').trim();
    if (route && label) return `${route} · ${label}`;
    return route || label;
  }

  function summarizeSurfaceConsumers(consumers) {
    const rows = Array.isArray(consumers) ? consumers : [];
    if (!rows.length) return '점검 필요';
    if (rows.length <= 2) return rows.join(' / ');
    return `${rows.slice(0, 2).join(' / ')} 외 ${rows.length - 2}`;
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
        ['전체 목록 L/I/S', formatClassificationCounts(universe?.classification)],
        ['스크리너 L/I/S', formatClassificationCounts(screener?.classification)],
        ['전체 목록 행', universe?.records],
        ['스크리너 행', screener?.records]
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
    const candidateTotal = Number(counts.etf_candidate_total || index.etf_detail_coverage?.counts?.candidate_total || 0);
    const covered = Number(counts.etf_detail_covered || index.etf_detail_coverage?.counts?.covered_detail_files || 0);
    const coveragePct = Number(counts.etf_detail_coverage_pct || index.etf_detail_coverage?.counts?.coverage_pct || 0);
    const source404 = Array.isArray(index.results)
      ? index.results.filter((row) => String(row?.error || '').includes('404')).length
      : failed;
    return renderMarketAuditCard({
      title: '최근 ETF 상세 갱신',
      status: hardFailed === 0 ? 'pass' : 'warn',
      code: `${Formatters.formatNumber(ok, 0)} / ${Formatters.formatNumber(requested, 0)} 성공`,
      rows: [
        ['실행일', escapeHtml(index.generated_at || '-').slice(0, 10)],
        ['이번 요청', requested],
        ['이번 성공', ok],
        ['이번 미제공', source404],
        ['이번 치명 오류', hardFailed],
        ['전체 커버리지', `${Formatters.formatNumber(covered, 0)} / ${Formatters.formatNumber(candidateTotal, 0)} (${Formatters.formatNumber(coveragePct, 2)}%)`]
      ]
    });
  }

  function renderIncrementalBackfillAudit(index, incremental, incrementalPlan, marketFactsIndex, auditIncremental) {
    const counts = index?.counts || {};
    const auditCounts = auditIncremental?.counts || {};
    const incrementalCounts = incremental?.counts || {};
    const planCounts = incrementalPlan?.counts || {};
    const selected = Number(incrementalCounts.selected ?? auditCounts.selected ?? counts.incremental_etf_backfill_selected ?? 0);
    const candidates = Number(incrementalCounts.candidates ?? auditCounts.candidates ?? counts.incremental_etf_backfill_candidates ?? 0);
    const fallbackRetry = Number(incrementalCounts.fallback_retry ?? auditCounts.fallback_retry ?? 0);
    const historyGap = Number(incrementalCounts.history_gap ?? auditCounts.history_gap ?? 0);
    const planSelected = Number(planCounts.incremental_selected ?? auditCounts.plan_selected ?? 0);
    const planCandidates = Number(planCounts.incremental_candidates ?? auditCounts.plan_candidates ?? 0);
    const planHistoryGap = Number(planCounts.history_gap ?? auditCounts.plan_history_gap ?? 0);
    const cooldownSkipped = Number(incrementalCounts.cooldown_skipped ?? auditCounts.cooldown_skipped ?? counts.incremental_etf_cooldown_skipped ?? 0);
    const cooldownActive = Number(auditCounts.pending_ledger_cooldown ?? incrementalCounts.ledger_cooldown ?? counts.incremental_etf_ledger_cooldown ?? 0);
    const fallbackOk = Number(auditCounts.etfs_yahoo_fallback_ok ?? counts.etfs_yahoo_fallback_ok ?? 0);
    const stillPending = Number(auditCounts.etfs_still_pending ?? counts.etfs_still_pending ?? 0);
    const fallbackCoverage = Number(auditCounts.market_facts_yf_fallback ?? marketFactsIndex?.coverage?.stockanalysis_yf_fallback ?? 0);
    const generatedAt = incremental?.generated_at || auditIncremental?.proof_generated_at || auditIncremental?.index_generated_at || index?.generated_at || '-';
    const planGeneratedAt = incrementalPlan?.generated_at || auditIncremental?.plan_generated_at || '-';
    const hasIncrementalFile = Boolean(incremental) || auditIncremental?.proof_file_exists === true;
    const hasPlanFile = Boolean(incrementalPlan) || auditIncremental?.plan_file_exists === true;
    const hasRunEvidence = Boolean(auditIncremental?.has_run_evidence) || hasIncrementalFile || selected > 0 || fallbackOk > 0 || fallbackCoverage > 0;
    const auditStatus = auditIncremental?.status || (hasRunEvidence ? 'observed' : 'waiting');
    const status = auditStatus === 'pass' ? 'pass' : 'warn';
    const code = hasRunEvidence
      ? `${Formatters.formatNumber(selected, 0)}개 선택`
      : hasPlanFile
      ? `${Formatters.formatNumber(planSelected, 0)}개 계획`
      : '대기';
    const notes = Array.isArray(auditIncremental?.notes) ? auditIncremental.notes : [];
    const evidenceMode = hasRunEvidence && hasPlanFile
      ? '실행 증거 + 보강 계획'
      : hasRunEvidence
      ? '실행 증거'
      : hasPlanFile
      ? '보강 계획'
      : '대기';

    return renderMarketAuditCard({
      title: '자동 ETF 보강',
      status,
      code,
      rows: [
        ['감사 상태', auditStatus],
        ['실행/계획', evidenceMode],
        ['생성일', escapeHtml(generatedAt).slice(0, 10)],
        ['계획일', escapeHtml(planGeneratedAt).slice(0, 10)],
        ['후보', candidates],
        ['선택', selected],
        ['계획 후보', planCandidates],
        ['계획 선택', planSelected],
        ['계획: 다년 히스토리', planHistoryGap],
        ['보조 가격 재시도', fallbackRetry],
        ['최근 실행: 다년 히스토리', historyGap],
        ['이번 선택 제외', cooldownSkipped],
        ['재시도 대기', cooldownActive],
        ['보조 가격 반영', fallbackOk],
        ['아직 대기', stillPending],
        ['정규화 반영', fallbackCoverage],
        ['증거 파일', hasIncrementalFile ? '있음' : '대기'],
        ['계획 파일', hasPlanFile ? '있음' : '대기'],
        ['메모', notes.length ? notes.join(', ') : '-']
      ]
    });
  }

  function renderHistoryGapPreflightAudit(report) {
    if (!report) return '';
    const missing = Number(report.missing_required_history || 0);
    const complete = Number(report.complete_required_history || 0);
    const total = Number(report.primary_stockanalysis_detail_files || 0);
    const missingByPeriod = report.missing_by_period || {};
    const plan = report.incremental_plan || {};
    const planMatches = plan.matches_current_gap === true && plan.matches_required_periods === true;
    const marketFacts3y = report.market_facts_return_3y || {};
    const dispatchInputs = report.recommended_dispatch?.inputs || {};

    return renderMarketAuditCard({
      title: 'ETF 히스토리 사전 점검',
      status: missing === 0 && planMatches ? 'pass' : 'warn',
      code: missing > 0
        ? `${Formatters.formatNumber(missing, 0)}개 보강 필요`
        : '완료',
      rows: [
        ['생성일', escapeHtml(report.generated_at || '-').slice(0, 10)],
        ['직접 스캔', `${Formatters.formatNumber(total, 0)}개`],
        ['3Y/5Y 완료', complete],
        ['보강 필요', missing],
        ['커버리지', `${Formatters.formatNumber(report.coverage_pct || 0, 2)}%`],
        ['월간 3년 누락', missingByPeriod.monthly_3y],
        ['월간 5년 누락', missingByPeriod.monthly_5y],
        ['수량 계획 일치', plan.matches_current_gap === true ? '일치' : '불일치'],
        ['기간 계획 일치', plan.matches_required_periods === true ? '일치' : '불일치'],
        ['계획 후보', plan.counts?.history_gap ?? '-'],
        ['추천 청크', dispatchInputs.incremental_etf_limit || '-'],
        ['시장 팩트 3년', `${Formatters.formatNumber(marketFacts3y.etf || 0, 0)} / ${Formatters.formatNumber(marketFacts3y.etf_denominator || 0, 0)}`]
      ]
    });
  }

  function renderEtfBackfillDrilldown(index, incremental, incrementalPlan, pendingLedger) {
    if (!index && !incremental && !incrementalPlan && !pendingLedger) return '';
    const counts = index?.counts || {};
    const planBackfill = incrementalPlan?.incremental_etf_backfill || null;
    const incrementalCounts = planBackfill?.counts || incremental?.counts || index?.incremental_etf_backfill?.counts || {};
    const selected = Array.isArray(planBackfill?.selected)
      ? planBackfill.selected
      : Array.isArray(incremental?.selected)
      ? incremental.selected
      : (Array.isArray(index?.incremental_etf_backfill?.selected) ? index.incremental_etf_backfill.selected : []);
    const failedResults = Array.isArray(index?.results)
      ? index.results.filter((row) => {
          const status = String(row?.status || '').trim();
          return status && status !== 'ok' && status !== 'fallback_ok';
        })
      : [];
    const ledgerRows = normalizePendingLedgerRows(pendingLedger);
    const trackedCount = Number(pendingLedger?.counts?.tracked ?? counts.incremental_etf_ledger_tracked ?? ledgerRows.length) || 0;
    const cooldownCount = Number(pendingLedger?.counts?.cooldown ?? counts.incremental_etf_ledger_cooldown ?? 0) || 0;
    const retryNowCount = Math.max(trackedCount - cooldownCount, 0);
    const generatedAt = incrementalPlan?.generated_at || incremental?.generated_at || index?.incremental_etf_backfill?.generated_at || index?.generated_at || '-';
    const nextRetryAt = findEarliestIso(ledgerRows.map((row) => row.next_attempt_after_utc));
    const lastAttemptAt = findLatestIso(ledgerRows.map((row) => row.last_attempt_utc));
    const repeatedFailureCount = ledgerRows.filter((row) => Number(row.consecutive_failures || 0) >= 3).length;

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-5">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">ETF 수집 대기열</h3>
            <p class="text-xs text-gray-500 mt-1">index.json · incremental_latest.json · incremental_plan_latest.json · pending_ledger.json</p>
          </div>
          <span class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-500">
            ${escapeHtml(generatedAt).slice(0, 10)}
          </span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          ${renderAuditMetric('다음 선택', incrementalCounts.selected ?? selected.length)}
          ${renderAuditMetric('누락 후보', incrementalCounts.missing)}
          ${renderAuditMetric('보조 가격 재시도 후보', incrementalCounts.fallback_retry)}
          ${renderAuditMetric('다년 히스토리 보강 후보', incrementalCounts.history_gap)}
          ${renderAuditMetric('추적 중', trackedCount)}
          ${renderAuditMetric('재시도 예약됨', cooldownCount)}
          ${renderAuditMetric('지금 재시도 가능', retryNowCount)}
          ${renderAuditMetric('가장 빠른 재시도일', formatBackfillDate(nextRetryAt))}
          ${renderAuditMetric('최근 확인일', formatBackfillDate(lastAttemptAt))}
          ${renderAuditMetric('반복 미확인', repeatedFailureCount)}
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
          ${renderBackfillMiniTable(
            '다음 수집 대상',
            ['티커', '이유', '소스', '실패'],
            selected.slice(0, 12).map((row) => [
              escapeHtml(row?.ticker ?? '-'),
              escapeHtml(formatBackfillReason(row?.reason)),
              escapeHtml(formatBackfillSource(row?.source)),
              escapeHtml(Formatters.formatNumber(row?.prior_failures || 0, 0))
            ])
          )}
          ${renderBackfillMiniTable(
            '이번 실행 미해결',
            ['티커', '제공처', '상태', '오류'],
            failedResults.slice(0, 12).map((row) => [
              escapeHtml(row?.ticker ?? '-'),
              escapeHtml(formatBackfillSource(row?.provider)),
              escapeHtml(row?.status ?? '-'),
              escapeHtml(shortenError(row?.error || row?.stockanalysis_error))
            ])
          )}
          ${renderBackfillMiniTable(
            '재시도 대기',
            ['티커', '실패', '다음 시도', '사유'],
            ledgerRows.slice(0, 12).map((row) => [
              escapeHtml(row.ticker),
              escapeHtml(`${Formatters.formatNumber(row.consecutive_failures || 0, 0)}회`),
              escapeHtml(formatBackfillDate(row.next_attempt_after_utc)),
              escapeHtml(shortenError(row.failure_reason))
            ])
          )}
        </div>
        <p class="text-[11px] leading-relaxed text-gray-500">
          대기열은 수집기가 만든 JSON을 그대로 읽습니다. 재시도 예약은 반복 미확인 항목을 일정 기간 쉬게 해 수집 슬롯 낭비를 줄이는 장치이며, 추적 중인 항목에는 보조 가격 상세가 이미 붙었지만 원본 상세 재확인이 남은 항목도 포함될 수 있습니다.
        </p>
      </section>
    `;
  }

  function normalizePendingLedgerRows(pendingLedger) {
    const entries = pendingLedger?.entries || {};
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return [];
    return Object.entries(entries)
      .map(([ticker, value]) => ({
        ticker,
        ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
      }))
      .sort((a, b) => {
        const aFailures = Number(a.consecutive_failures || 0);
        const bFailures = Number(b.consecutive_failures || 0);
        if (aFailures !== bFailures) return bFailures - aFailures;
        return String(b.last_attempt_utc || '').localeCompare(String(a.last_attempt_utc || ''));
      });
  }

  function findEarliestIso(values) {
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))[0] || '';
  }

  function findLatestIso(values) {
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || '';
  }

  function renderBackfillMiniTable(title, headers, rows) {
    const body = rows.length
      ? renderParityTable(headers, rows)
      : '<div class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs font-semibold text-gray-400">표시할 항목이 없습니다.</div>';
    return `
      <div class="min-w-0 rounded-xl border border-gray-100 bg-slate-50 p-4">
        <div class="mb-3 text-xs font-black text-gray-700">${escapeHtml(title)}</div>
        ${body}
      </div>
    `;
  }

  function formatBackfillReason(reason) {
    const value = String(reason || '').trim();
    if (value === 'missing') return '상세 없음';
    if (value === 'fallback_retry') return '보조 가격 재시도';
    if (value === 'history_gap') return '다년 히스토리 보강';
    if (value === 'stale') return '오래된 파일';
    return value || '-';
  }

  function formatBackfillSource(source) {
    const value = String(source || '').trim();
    if (value === 'etf_universe') return 'ETF 목록';
    if (value === 'new_etfs') return '신규 ETF';
    if (value === 'etf_screener') return 'ETF 스크리너';
    if (value === 'stockanalysis') return '기본 상세';
    if (value === 'yahoo_finance') return '보조 가격';
    return value || '-';
  }

  function formatBackfillDate(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    return text.slice(0, 10);
  }

  function shortenError(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '-';
    return text.length > 86 ? `${text.slice(0, 83)}...` : text;
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
   * Source parity detail block: diagnosis-count strip and the top rows that
   * need an operator's attention.
   */
  function renderSourceParityDetail(sourceParity) {
    if (!sourceParity) {
      return `
        <div class="xl:col-span-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
          소스 일치성 상세 데이터 없음 (computed/market_source_parity.json)
        </div>
      `;
    }

    const summary = sourceParity.summary || {};
    const counts = summary.diagnosis_counts || {};
    const diagItems = [
      ['stale', '시점 차이'],
      ['scale_mismatch', '단위 불일치'],
      ['sign_divergence', '부호 불일치'],
      ['value_drift', '값 차이'],
      ['agreement', '일치']
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
          ['티커', '항목', '선택 원천', '지연 원천', '차이율', '시점'],
          topStale.map((row) => [
            escapeHtml(row.ticker ?? '-'),
            escapeHtml(row.field ?? '-'),
            escapeHtml(row.selected_source ?? '-'),
            escapeHtml((Array.isArray(row.stale_sources) ? row.stale_sources : []).join(', ') || '-'),
            escapeHtml(formatSpreadPct(row.relative_spread_pct)),
            escapeHtml(formatFreshness(row.freshness))
          ])
        )
      : '<div class="text-xs text-gray-400">시점 차이 행이 없습니다.</div>';

    const signTable = topSignDiv.length
      ? renderParityTable(
          ['티커', '항목', '값', '차이율'],
          topSignDiv.map((row) => [
            escapeHtml(row.ticker ?? '-'),
            escapeHtml(row.field ?? '-'),
            escapeHtml(formatParityValues(row.values)),
            escapeHtml(formatSpreadPct(row.relative_spread_pct))
          ])
        )
      : '<div class="text-xs text-gray-400">부호 불일치 행이 없습니다.</div>';

    return `
      <section class="xl:col-span-4 bg-white rounded-xl p-5 shadow border border-gray-100 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-800">소스 일치성 진단 상세</h3>
            <p class="text-xs text-gray-500 mt-1">computed/market_source_parity.json</p>
          </div>
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">진단 분포</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">${diagStrip}</div>
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            시점 차이 상위
          </div>
          ${staleTable}
        </div>
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            부호 불일치 상위
          </div>
          ${signTable}
        </div>
        <p class="text-[11px] leading-relaxed text-gray-500">
          상대 시점 차이는 가장 신선한 후보와 다른 원천 사이의 날짜 차이를 뜻합니다. 절대적인 데이터 노후 여부는 별도 신선도 감사에서 판단합니다.
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
            ${Formatters.formatNumber(rows.length, 0)}개 필드 · ${Formatters.formatNumber(stockFieldView.page + 1, 0)} / ${Formatters.formatNumber(pageCount, 0)}
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
