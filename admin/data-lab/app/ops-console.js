/**
 * OpsConsole - read-only operational checks for Data Lab
 *
 * v1 scope: manifest route smoke + live asset parity + source/live drift
 * + GitHub Actions health checks + internal data timestamp guard.
 *
 * @module ops-console
 * @version 0.3.0
 */

const OpsConsole = (function() {
  const RAW_SOURCE_BASE = 'https://raw.githubusercontent.com/etloveaui/100xFenok/main/';
  const GITHUB_API_BASE = 'https://api.github.com/repos/etloveaui/100xFenok';
  const FETCH_TIMEOUT_MS = 8000;

  const ASSET_PARITY_WATCHLIST = [
    'admin/data-lab/index.html',
    'admin/data-lab/app/dashboard.js',
    'admin/data-lab/app/renderer.js',
    'admin/data-lab/app/ops-console.js',
    'admin/data-lab/styles/dashboard.css'
  ];

  const DRIFT_WATCHLIST = [
    'admin/data-lab/shared/config/manifest-loader.js',
    'admin/data-lab/shared/data-lab-config.js',
    'admin/shared/config/manifest-loader.js',
    'admin/valuation-lab/shared/lab-config.js',
    'admin/valuation-lab/shared/vlab-config.js',
    'admin/valuation-lab/shared/slickcharts-config.js',
    'admin/valuation-lab/expansion/dashboard.html'
  ];

  const ACTION_WORKFLOWS = [
    { label: 'Deploy Worker', name: 'Deploy Worker (Cloudflare)' }
  ];

  const FRESHNESS_GUARD_WATCHLIST = [
    {
      label: 'Manifest catalog',
      path: '/data/manifest.json',
      sourceDateReason: 'manifest spans sources with independent publishing schedules; no single freshness verdict',
      collectionPath: 'generatedAt',
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'Sector momentum',
      path: '/data/benchmarks/us.json',
      sourceDateResolver: resolveBenchmarkSourceClock,
      collectionPath: 'metadata.generated',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Scouter stock index',
      path: '/data/global-scouter/core/stocks_index.json',
      sourceDatePath: 'source_date',
      collectionPath: 'generated_at',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Sector ETF table',
      path: '/data/global-scouter/etfs/index.json',
      sourceDatePath: 'source_date',
      collectionPath: 'generated_at',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts universe',
      path: '/data/slickcharts/universe.json',
      sourceDateReason: 'provider publishes no source date; updated is collection time',
      collectionPath: 'updated',
      minCountPath: 'uniqueCount',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts returns',
      path: '/data/slickcharts/stocks-returns.json',
      sourceDateReason: 'provider publishes no source date; updated is collection time',
      collectionPath: 'updated',
      minCountPath: 'count',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts dividends',
      path: '/data/slickcharts/stocks-dividends.json',
      sourceDateReason: 'provider publishes no source date; updated is collection time',
      collectionPath: 'updated',
      minCountPath: 'count',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'ETF 전체 목록',
      path: '/data/stockanalysis/etf_universe.json',
      sourceDateReason: 'provider publishes no aggregate source date',
      collectionPath: 'generated_at',
      minCountPath: 'counts.records',
      minCount: 5000,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'ETF 분류',
      path: '/data/stockanalysis/classification/latest.json',
      sourceDateReason: 'derived classification has no independent source date',
      collectionPath: 'generated_at',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'StockAnalysis 수집 인덱스',
      path: '/data/stockanalysis/index.json',
      sourceDateReason: 'provider publishes no aggregate source date',
      collectionPath: 'generated_at',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: '시장 데이터 수집 목록',
      path: '/data/stockanalysis/surfaces/index.json',
      sourceDateReason: 'provider publishes no aggregate source date',
      collectionPath: 'generated_at',
      minCountPath: 'counts.rows',
      minCount: 10000,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: '시장 데이터 소비처',
      path: '/data/stockanalysis/surface_consumers.json',
      sourceDateReason: 'consumer registry has a build time but no upstream source date',
      collectionPath: 'updated_at',
      minCountPath: 'surfaces.length',
      minCount: 25,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: '어닝 일정 데이터',
      path: '/data/stockanalysis/surfaces/earnings_calendar.json',
      sourceDateReason: 'provider publishes no aggregate source date',
      collectionPath: 'fetched_at',
      minCountPath: 'counts.records',
      minCount: 1000,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: '신규 ETF 데이터',
      path: '/data/stockanalysis/surfaces/new_etfs.json',
      sourceDateReason: 'provider publishes no aggregate source date',
      collectionPath: 'fetched_at',
      minCountPath: 'counts.records',
      minCount: 10,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Market data audit',
      path: '/data/computed/market_data_audit.json',
      sourceDateReason: 'audit payload has a build time but no aggregate source date',
      collectionPath: 'market_source_parity.generated_at',
      minCountPath: 'market_facts.count',
      minCount: 5000,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Computed signals',
      path: '/data/computed/signals.json',
      sourceDateReason: 'computed signals span independent source schedules; use lane-specific readiness',
      collectionPath: 'generated_at',
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'Fear & Greed',
      path: '/data/sentiment/cnn-fear-greed.json',
      sourceDatePath: '',
      arrayLastDate: true,
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'PMI activity',
      path: '/data/macro/activity-surveys.json',
      sourceDatePath: 'meta.coverage.pmi_manufacturing.latest_date',
      collectionPath: 'meta.generated_at',
      warnAfterDays: 45,
      failAfterDays: 75
    },
    {
      label: 'Banking quarterly',
      path: '/data/macro/fred-banking-quarterly.json',
      sourceDateResolver: resolveSeriesSourceClock,
      collectionPath: 'fetched_at',
      warnAfterDays: 150,
      failAfterDays: 220
    }
  ];

  let lastResults = null;

  async function run() {
    const [routes, assets, drift, actions, freshness] = await Promise.all([
      runRouteSmoke(),
      runAssetParityChecks(),
      runDriftChecks(),
      runActionsHealth(),
      runFreshnessGuard()
    ]);

    lastResults = {
      checkedAt: new Date().toISOString(),
      routes,
      assets,
      drift,
      actions,
      freshness
    };

    return lastResults;
  }

  async function runRouteSmoke() {
    const checks = [];
    const basePath = safeBasePath();
    const isWorkers = location.hostname.endsWith('workers.dev');
    const expectsRootBase = isRootHostedRuntime();
    const expectedBasePath = expectsRootBase ? '' : '/100xFenok';
    const basePathOk = basePath === expectedBasePath;

    checks.push({
      label: 'Data Lab base path',
      status: basePathOk ? 'pass' : 'fail',
      code: basePath === '' ? 'root' : basePath,
      detail: basePathOk
        ? `Current runtime resolves manifest with ${expectedBasePath || 'root'} base path.`
        : `Unexpected base path for this runtime: ${basePath || 'root'}; expected ${expectedBasePath || 'root'}.`
    });

    checks.push(await probeRoute({
      label: 'Manifest route',
      path: '/data/manifest.json',
      expectedStatus: 200,
      requireJson: true,
      withBasePath: true
    }));

    checks.push(await probeRoute({
      label: 'ETF 목록 API',
      path: '/api/data/stockanalysis/etf-universe',
      expectedStatus: 200,
      requireJson: true,
      withBasePath: false
    }));

    if (isWorkers) {
      checks.push({
        label: 'Legacy /100xFenok prefix',
        status: basePathOk ? 'pass' : 'fail',
        code: basePathOk ? 'not-requested' : 'base-path',
        detail: basePathOk
          ? 'Runtime base path is root; legacy prefix is not requested to avoid intentional console 404 noise.'
          : 'Runtime base path is not root, so Data Lab may still request the legacy prefix.'
      });
    } else {
      checks.push({
        label: 'Legacy /100xFenok prefix',
        status: 'skip',
        code: 'runtime',
        detail: 'Workers-only regression guard skipped for this runtime.'
      });
    }

    return checks;
  }

  async function probeRoute({ label, path, expectedStatus, requireJson = false, withBasePath = true }) {
    const normalizedPath = path.replace(/\/{2,}/g, '/');
    const started = performance.now();

    try {
      const response = await fetchWithTimeout(toRuntimeUrl(normalizedPath, { withBasePath }), {
        headers: { 'Accept': requireJson ? 'application/json' : '*/*' }
      });
      const elapsed = Math.round(performance.now() - started);
      let jsonOk = true;

      if (requireJson && response.ok) {
        try {
          await response.clone().json();
        } catch {
          jsonOk = false;
        }
      }

      const ok = response.status === expectedStatus && jsonOk;
      return {
        label,
        status: ok ? 'pass' : 'fail',
        code: String(response.status),
        detail: ok
          ? `${normalizedPath} returned expected ${expectedStatus} in ${elapsed}ms.`
          : `${normalizedPath} returned ${response.status}; expected ${expectedStatus}${jsonOk ? '' : ' with valid JSON'}.`
      };
    } catch (error) {
      return {
        label,
        status: 'fail',
        code: 'ERR',
        detail: `${normalizedPath} probe failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async function runAssetParityChecks() {
    if (location.protocol === 'file:') {
      return [{
        label: 'Live asset parity checks',
        status: 'skip',
        code: 'file',
        detail: 'Serve Data Lab over http(s) to verify live asset availability.'
      }];
    }

    return Promise.all(ASSET_PARITY_WATCHLIST.map(checkLiveAssetParity));
  }

  async function checkLiveAssetParity(path) {
    const liveUrl = `${toRuntimeUrl(`/${path}`)}?ops=${Date.now()}`;

    try {
      const liveResponse = await fetchWithTimeout(liveUrl);

      if (!liveResponse.ok) {
        return {
          label: path,
          status: 'fail',
          code: String(liveResponse.status),
          detail: `Live asset fetch failed with ${liveResponse.status}.`
        };
      }

      if (isLocalRuntime()) {
        return {
          label: path,
          status: 'skip',
          code: 'local',
          detail: 'Local asset is reachable; deployed SHA parity runs on workers/pages.'
        };
      }

      const sourceUrl = `${RAW_SOURCE_BASE}${path}?ops=${Date.now()}`;
      const sourceResponse = await fetchWithTimeout(sourceUrl);

      if (!sourceResponse.ok) {
        return {
          label: path,
          status: 'fail',
          code: `${sourceResponse.status}/${liveResponse.status}`,
          detail: `Source/live fetch status mismatch. source=${sourceResponse.status}, live=${liveResponse.status}`
        };
      }

      const [sourceText, liveText] = await Promise.all([
        sourceResponse.text(),
        liveResponse.text()
      ]);
      const [sourceHash, liveHash] = await Promise.all([
        sha256(sourceText),
        sha256(liveText)
      ]);
      const matched = sourceHash === liveHash;

      return {
        label: path,
        status: matched ? 'pass' : 'fail',
        code: matched ? 'match' : 'drift',
        detail: matched
          ? `deployed asset matches source ${sourceHash.slice(0, 12)}`
          : `source ${sourceHash.slice(0, 12)} != live ${liveHash.slice(0, 12)}`
      };
    } catch (error) {
      return {
        label: path,
        status: 'warn',
        code: 'ERR',
        detail: `Asset parity check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async function runDriftChecks() {
    if (location.protocol === 'file:') {
      return [{
        label: 'Source / live drift checks',
        status: 'skip',
        code: 'file',
        detail: 'Serve Data Lab over http(s) to compare GitHub source with live assets.'
      }];
    }

    return Promise.all(DRIFT_WATCHLIST.map(checkSourceLivePair));
  }

  async function checkSourceLivePair(path) {
    const sourceUrl = `${RAW_SOURCE_BASE}${path}?ops=${Date.now()}`;
    const liveUrl = `${toRuntimeUrl(`/${path}`)}?ops=${Date.now()}`;

    try {
      const [sourceResponse, liveResponse] = await Promise.all([
        fetchWithTimeout(sourceUrl),
        fetchWithTimeout(liveUrl)
      ]);

      if (!sourceResponse.ok || !liveResponse.ok) {
        return {
          label: path,
          status: 'fail',
          code: `${sourceResponse.status}/${liveResponse.status}`,
          detail: `Source/live fetch status mismatch. source=${sourceResponse.status}, live=${liveResponse.status}`
        };
      }

      const [sourceText, liveText] = await Promise.all([
        sourceResponse.text(),
        liveResponse.text()
      ]);
      const [sourceHash, liveHash] = await Promise.all([
        sha256(sourceText),
        sha256(liveText)
      ]);
      const matched = sourceHash === liveHash;

      return {
        label: path,
        status: matched ? 'pass' : 'fail',
        code: matched ? 'match' : 'drift',
        detail: matched
          ? `source/live SHA match ${sourceHash.slice(0, 12)}`
          : `source ${sourceHash.slice(0, 12)} != live ${liveHash.slice(0, 12)}`
      };
    } catch (error) {
      return {
        label: path,
        status: 'warn',
        code: 'ERR',
        detail: `Drift check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async function runActionsHealth() {
    try {
      const [commitResponse, runsResponse] = await Promise.all([
        fetchGitHubJson(`${GITHUB_API_BASE}/commits/main`),
        fetchGitHubJson(`${GITHUB_API_BASE}/actions/runs?branch=main&per_page=20&exclude_pull_requests=true`)
      ]);

      const mainSha = commitResponse?.sha || '';
      const runs = Array.isArray(runsResponse?.workflow_runs) ? runsResponse.workflow_runs : [];
      const checks = [];

      checks.push({
        label: 'GitHub main HEAD',
        status: mainSha ? 'pass' : 'fail',
        code: mainSha ? shortSha(mainSha) : 'missing',
        detail: mainSha
          ? firstLine(commitResponse?.commit?.message || 'Main branch commit resolved.')
          : 'Could not resolve main branch HEAD from GitHub API.'
      });

      ACTION_WORKFLOWS.forEach(workflow => {
        checks.push(checkWorkflowRun(workflow, runs, mainSha));
      });

      return checks;
    } catch (error) {
      return [{
        label: 'GitHub Actions API',
        status: 'warn',
        code: 'ERR',
        detail: `Actions health unavailable: ${error instanceof Error ? error.message : String(error)}`
      }];
    }
  }

  function checkWorkflowRun(workflow, runs, mainSha) {
    const run = runs.find(item => item.name === workflow.name);

    if (!run) {
      return {
        label: workflow.label,
        status: 'fail',
        code: 'missing',
        detail: `No recent run found for ${workflow.name}.`
      };
    }

    const headMatches = mainSha && run.head_sha === mainSha;
    const isCompleted = run.status === 'completed';
    const isSuccess = run.conclusion === 'success';
    const status = !isCompleted
      ? 'warn'
      : !isSuccess
        ? 'fail'
        : headMatches
          ? 'pass'
          : 'warn';

    return {
      label: workflow.label,
      status,
      code: isCompleted ? (run.conclusion || 'done') : run.status,
      detail: [
        firstLine(run.display_title || run.name),
        `run=${run.id}`,
        `sha=${shortSha(run.head_sha)}`,
        headMatches ? 'main HEAD matched' : `main HEAD is ${shortSha(mainSha) || 'unknown'}`,
        formatAge(run.updated_at || run.created_at)
      ].filter(Boolean).join(' · ')
    };
  }

  async function runFreshnessGuard() {
    return Promise.all(FRESHNESS_GUARD_WATCHLIST.map(checkDataFreshness));
  }

  async function checkDataFreshness(check) {
    try {
      const response = await fetchWithTimeout(toRuntimeUrl(check.path), {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        return {
          label: check.label,
          status: 'fail',
          code: String(response.status),
          detail: `${check.path} fetch failed with ${response.status}.`
        };
      }

      const payload = await response.json();
      const sourceClock = resolveSourceClock(payload, check);
      const rawDate = sourceClock.value;
      const parsed = parseDateValue(rawDate);
      const countCheck = checkCountGuard(payload, check);
      const countDetail = countCheck.detail ? ` · ${countCheck.detail}` : '';
      const collectionDetail = formatCollectionDetail(payload, check);

      if (!parsed) {
        return {
          label: check.label,
          status: countCheck.status === 'fail' ? 'fail' : 'warn',
          code: 'unknown',
          detail: `source date unknown: ${sourceClock.reason || 'no source date or reason was emitted'}${collectionDetail}${countDetail}`
        };
      }

      const ageDays = daysSince(parsed);
      const dateStatus = ageDays > check.failAfterDays
        ? 'fail'
        : ageDays > check.warnAfterDays
          ? 'warn'
          : 'pass';
      const status = countCheck.status === 'fail' ? 'fail' : dateStatus;

      return {
        label: check.label,
        status,
        code: ageDays <= 0 ? 'today' : `${ageDays}d`,
        detail: `${sourceClock.path}=${formatDateValue(rawDate)} · warn>${check.warnAfterDays}d · fail>${check.failAfterDays}d${collectionDetail}${countDetail}`
      };
    } catch (error) {
      return {
        label: check.label,
        status: 'warn',
        code: 'ERR',
        detail: `Freshness guard failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  function resolveSourceClock(payload, check) {
    if (typeof check.sourceDateResolver === 'function') {
      return check.sourceDateResolver(payload);
    }

    const value = check.sourceDatePath ? getByPath(payload, check.sourceDatePath) : payload;
    if (check.arrayLastDate) {
      const item = Array.isArray(value) ? value[value.length - 1] : null;
      return {
        value: item?.date || item?.as_of || item?.source_date || null,
        reason: check.sourceDateReason || null,
        path: check.sourceDatePath ? `${check.sourceDatePath}[-1].date` : 'last[].date'
      };
    }
    return {
      value: check.sourceDatePath ? value : null,
      reason: (check.sourceReasonPath ? getByPath(payload, check.sourceReasonPath) : null)
        || check.sourceDateReason
        || null,
      path: check.sourceDatePath || 'source date'
    };
  }

  function completeSourceFloor(namedValues, label) {
    const missing = namedValues.filter((entry) => !parseDateValue(entry.value));
    if (!namedValues.length || missing.length) {
      const names = missing.length ? missing.map((entry) => entry.name) : ['no required inputs'];
      return {
        value: null,
        reason: `source date unavailable for required ${label}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` (+${names.length - 4} more)` : ''}`,
        path: `${label} complete floor`
      };
    }

    const oldest = [...namedValues]
      .sort((a, b) => parseDateValue(a.value) - parseDateValue(b.value))[0];
    return {
      value: oldest.value,
      reason: null,
      path: `${label} complete floor`
    };
  }

  function latestDatedRow(rows) {
    if (!Array.isArray(rows)) return null;
    return rows
      .map((row) => row?.date || row?.as_of || row?.source_date || null)
      .filter((value) => parseDateValue(value))
      .sort((a, b) => parseDateValue(a) - parseDateValue(b))
      .slice(-1)[0] || null;
  }

  function resolveBenchmarkSourceClock(payload) {
    const sections = payload?.sections && typeof payload.sections === 'object'
      ? Object.entries(payload.sections)
      : [];
    return completeSourceFloor(
      sections.map(([name, section]) => ({ name, value: latestDatedRow(section?.data) })),
      'benchmark sections'
    );
  }

  function resolveSeriesSourceClock(payload) {
    const series = payload?.series && typeof payload.series === 'object'
      ? Object.entries(payload.series)
      : [];
    return completeSourceFloor(
      series.map(([name, rows]) => ({ name, value: latestDatedRow(rows) })),
      'series'
    );
  }

  function formatCollectionDetail(payload, check) {
    if (!check.collectionPath) return '';
    const value = getByPath(payload, check.collectionPath);
    return value ? ` · collection/build ${check.collectionPath}=${formatDateValue(value)}` : '';
  }

  function checkCountGuard(payload, check) {
    if (!check.minCountPath) {
      return { status: 'pass', detail: '' };
    }

    const rawCount = getByPath(payload, check.minCountPath);
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);

    if (!Number.isFinite(count)) {
      return {
        status: 'fail',
        detail: `${check.minCountPath}=missing; expected>=${check.minCount}`
      };
    }

    return {
      status: count >= check.minCount ? 'pass' : 'fail',
      detail: `${check.minCountPath}=${count}; expected>=${check.minCount}`
    };
  }

  function getByPath(payload, path) {
    return String(path || '').split('.').filter(Boolean).reduce((value, segment) => {
      if (value === null || value === undefined) return undefined;
      return value[segment];
    }, payload);
  }

  function parseDateValue(value) {
    if (!value) return null;
    const text = String(value).trim();
    const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      return parsed.getFullYear() === Number(year)
        && parsed.getMonth() === Number(month) - 1
        && parsed.getDate() === Number(day)
        ? parsed
        : null;
    }

    const parsed = new Date(text.replace(' ', 'T'));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function daysSince(date) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.floor((now - target) / 86400000);
  }

  function formatDateValue(value) {
    return String(value || '').slice(0, 19);
  }

  function safeBasePath() {
    try {
      return ManifestLoader.getBasePath();
    } catch {
      return '';
    }
  }

  function isRootHostedRuntime() {
    return location.protocol === 'file:'
      || /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname)
      || location.hostname.endsWith('pages.dev')
      || location.hostname.endsWith('workers.dev');
  }

  function isLocalRuntime() {
    return location.protocol === 'file:'
      || /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname);
  }

  function toRuntimeUrl(path, options = {}) {
    const withBasePath = options.withBasePath !== false;
    const basePath = safeBasePath();
    const prefix = withBasePath ? basePath : '';
    const joined = `${prefix}/${String(path).replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
    return new URL(joined, location.origin).href;
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      return await fetch(url, {
        cache: 'no-store',
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchGitHubJson(url) {
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }

    return response.json();
  }

  function shortSha(sha) {
    return sha ? String(sha).slice(0, 9) : '';
  }

  function firstLine(value) {
    return String(value || '').split('\n')[0];
  }

  function formatAge(value) {
    if (!value) return '';
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return '';

    const elapsedMs = Date.now() - timestamp;
    if (elapsedMs < 0) return 'just now';

    const minutes = Math.round(elapsedMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;

    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  async function sha256(text) {
    if (!globalThis.crypto?.subtle) {
      return fallbackHash(text);
    }

    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function fallbackHash(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return `fallback-${Math.abs(hash).toString(16)}`;
  }

  function getLastResults() {
    return lastResults;
  }

  return {
    run,
    getLastResults,
    ASSET_PARITY_WATCHLIST,
    DRIFT_WATCHLIST,
    FRESHNESS_GUARD_WATCHLIST
  };
})();

window.OpsConsole = OpsConsole;
