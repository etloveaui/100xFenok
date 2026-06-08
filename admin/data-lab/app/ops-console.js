/**
 * OpsConsole - read-only operational checks for Data Lab
 *
 * v0 scope: manifest route smoke + source/live drift checks.
 *
 * @module ops-console
 * @version 0.1.0
 */

const OpsConsole = (function() {
  const RAW_SOURCE_BASE = 'https://raw.githubusercontent.com/etloveaui/100xFenok/main/';
  const FETCH_TIMEOUT_MS = 8000;

  const DRIFT_WATCHLIST = [
    'admin/data-lab/shared/config/manifest-loader.js',
    'admin/data-lab/shared/data-lab-config.js',
    'admin/shared/config/manifest-loader.js',
    'admin/valuation-lab/shared/lab-config.js',
    'admin/valuation-lab/shared/vlab-config.js',
    'admin/valuation-lab/shared/slickcharts-config.js',
    'admin/valuation-lab/expansion/dashboard.html'
  ];

  let lastResults = null;

  async function run() {
    const [routes, drift] = await Promise.all([
      runRouteSmoke(),
      runDriftChecks()
    ]);

    lastResults = {
      checkedAt: new Date().toISOString(),
      routes,
      drift
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
    DRIFT_WATCHLIST
  };
})();

window.OpsConsole = OpsConsole;
