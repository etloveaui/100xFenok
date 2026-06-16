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
    { label: 'Deploy Worker', name: 'Deploy Worker (Cloudflare)' },
    { label: 'Deploy Pages', name: 'Deploy to GitHub Pages' }
  ];

  const FRESHNESS_GUARD_WATCHLIST = [
    {
      label: 'Manifest catalog',
      path: '/data/manifest.json',
      datePath: 'last_updated',
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'Sector momentum',
      path: '/data/benchmarks/summaries.json',
      datePath: 'metadata.generated',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Scouter stock index',
      path: '/data/global-scouter/core/stocks_index.json',
      datePath: 'source_date',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Sector ETF table',
      path: '/data/global-scouter/etfs/index.json',
      datePath: 'source_date',
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts universe',
      path: '/data/slickcharts/universe.json',
      datePath: 'updated',
      minCountPath: 'uniqueCount',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts returns',
      path: '/data/slickcharts/stocks-returns.json',
      datePath: 'updated',
      minCountPath: 'count',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'SlickCharts dividends',
      path: '/data/slickcharts/stocks-dividends.json',
      datePath: 'updated',
      minCountPath: 'count',
      minCount: 500,
      warnAfterDays: 7,
      failAfterDays: 14
    },
    {
      label: 'Computed signals',
      path: '/data/computed/signals.json',
      datePath: 'as_of',
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'Fear & Greed',
      path: '/data/sentiment/cnn-fear-greed.json',
      datePath: '',
      arrayLastDate: true,
      warnAfterDays: 1,
      failAfterDays: 3
    },
    {
      label: 'PMI activity',
      path: '/data/macro/activity-surveys.json',
      datePath: 'meta.coverage.pmi_manufacturing.latest_release_date',
      warnAfterDays: 45,
      failAfterDays: 75
    },
    {
      label: 'Banking quarterly',
      path: '/data/macro/fred-banking-quarterly.json',
      datePath: 'series.DRALACBN',
      arrayLastDate: true,
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

    const deadPrefix = await probeRoute({
      label: 'Legacy /100xFenok prefix',
      path: '/100xFenok/data/manifest.json',
      expectedStatus: 404,
      withBasePath: false
    });

    checks.push(isWorkers ? deadPrefix : {
      ...deadPrefix,
      status: deadPrefix.status === 'fail' ? 'skip' : deadPrefix.status,
      detail: `${deadPrefix.detail} Workers-only regression guard.`
    });

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
      const rawDate = resolveDateValue(payload, check);
      const parsed = parseDateValue(rawDate);

      if (!parsed) {
        return {
          label: check.label,
          status: 'fail',
          code: 'missing',
          detail: `${check.path} has no readable date at ${formatDatePath(check)}.`
        };
      }

      const ageDays = daysSince(parsed);
      const dateStatus = ageDays > check.failAfterDays
        ? 'fail'
        : ageDays > check.warnAfterDays
          ? 'warn'
          : 'pass';
      const countCheck = checkCountGuard(payload, check);
      const status = countCheck.status === 'fail' ? 'fail' : dateStatus;
      const countDetail = countCheck.detail ? ` · ${countCheck.detail}` : '';

      return {
        label: check.label,
        status,
        code: ageDays <= 0 ? 'today' : `${ageDays}d`,
        detail: `${formatDatePath(check)}=${formatDateValue(rawDate)} · warn>${check.warnAfterDays}d · fail>${check.failAfterDays}d${countDetail}`
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

  function resolveDateValue(payload, check) {
    const value = check.datePath ? getByPath(payload, check.datePath) : payload;
    if (check.arrayLastDate) {
      const item = Array.isArray(value) ? value[value.length - 1] : null;
      return item?.date || item?.updated || item?.as_of || null;
    }
    return value;
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
      return new Date(Number(year), Number(month) - 1, Number(day));
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

  function formatDatePath(check) {
    if (check.arrayLastDate && !check.datePath) return 'last[].date';
    if (check.arrayLastDate) return `${check.datePath}[-1].date`;
    return check.datePath;
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
