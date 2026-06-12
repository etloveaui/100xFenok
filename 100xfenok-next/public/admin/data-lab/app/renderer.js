/**
 * Renderer - UI rendering functions
 *
 * Handles DOM updates based on state changes.
 *
 * @module renderer
 * @version 1.0.0
 */

const Renderer = (function() {

  // DOM element references
  let elements = null;

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
   * Render Data Atlas loading state.
   */
  function renderAtlasLoading() {
    if (!elements?.atlasContainer) return;
    elements.atlasContainer.innerHTML = `
      <div class="bg-white rounded-xl p-5 shadow animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          ${Array.from({ length: 4 }, () => '<div class="h-20 bg-gray-100 rounded-lg"></div>').join('')}
        </div>
        <div class="h-44 bg-gray-100 rounded-lg"></div>
      </div>
    `;
  }

  /**
   * Render Data Atlas unavailable state.
   * @param {string} message
   */
  function renderAtlasUnavailable(message) {
    if (!elements?.atlasContainer) return;
    elements.atlasContainer.innerHTML = `
      <div class="rounded-xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
        <div class="font-semibold mb-1">Data Atlas 확인 불가</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }

  /**
   * Render full feno-data atlas.
   * @param {Object} atlas
   * @param {string} activeCategory
   */
  function renderDataAtlas(atlas, activeCategory = 'all') {
    if (!elements?.atlasContainer) return;

    const totals = atlas?.totals || {};
    const categories = Array.isArray(atlas?.categories) ? atlas.categories : [];
    const files = Array.isArray(atlas?.files) ? atlas.files : [];
    const visibleFiles = activeCategory === 'all'
      ? files
      : files.filter((file) => file.category === activeCategory);
    const laneEntries = Object.entries(totals.laneCounts || {})
      .sort((left, right) => right[1] - left[1]);
    const activeLabel = activeCategory === 'all' ? '전체' : activeCategory;

    elements.atlasContainer.innerHTML = `
      <div class="bg-white rounded-xl border border-gray-100 shadow overflow-hidden">
        <div class="p-5 border-b border-gray-100">
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
            ${renderAtlasMetric('JSON 파일', Formatters.formatNumber(totals.fileCount || 0, 0), '전체 소비 대상')}
            ${renderAtlasMetric('카테고리', Formatters.formatNumber(totals.categoryCount || 0, 0), 'root 포함')}
            ${renderAtlasMetric('디렉터리', Formatters.formatNumber(totals.directoryCount || 0, 0), '세부 소스 경로')}
            ${renderAtlasMetric('히스토리', Formatters.formatNumber(totals.historicalCount || 0, 0), '시계열/분기/과거값')}
            ${renderAtlasMetric('용량', escapeHtml(totals.totalSizeLabel || '0 B'), 'manifest 기준')}
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <button onclick="DataLabUI.showAtlasCategory('all')" class="${atlasFilterClass(activeCategory === 'all')}">
              전체
            </button>
            ${categories.map((category) => `
              <button onclick="DataLabUI.showAtlasCategory('${escapeAttr(category.key)}')" class="${atlasFilterClass(activeCategory === category.key)}" title="${escapeAttr(category.description || '')}">
                ${escapeHtml(category.key)}
                <span class="ml-1 text-[10px] opacity-70">${Formatters.formatNumber(category.fileCount || 0, 0)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div class="border-b xl:border-b-0 xl:border-r border-gray-100 p-5">
            <h3 class="text-sm font-bold text-gray-700 mb-3">앱 소비 위치</h3>
            <div class="space-y-2">
              ${laneEntries.map(([lane, count]) => renderAtlasLane(lane, count, totals.fileCount || 0)).join('')}
            </div>
            <h3 class="text-sm font-bold text-gray-700 mt-6 mb-3">카테고리 요약</h3>
            <div class="max-h-[520px] overflow-y-auto pr-1 space-y-2">
              ${categories.map((category) => renderAtlasCategory(category, activeCategory)).join('')}
            </div>
          </div>

          <div class="min-w-0 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h3 class="text-sm font-bold text-gray-700">${escapeHtml(activeLabel)} 파일 목록</h3>
                <p class="text-xs text-gray-500">
                  ${Formatters.formatNumber(visibleFiles.length, 0)}개 표시 · 모든 항목은 public data 경로로 직접 소비 가능
                </p>
              </div>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
                manifest ${escapeHtml(atlas.manifestLastUpdated || '-')}
              </span>
            </div>
            <div class="overflow-x-auto rounded-xl border border-gray-100">
              <table class="min-w-full text-left text-xs">
                <thead class="bg-gray-50 text-[11px] uppercase tracking-[0.08em] text-gray-500">
                  <tr>
                    <th class="px-3 py-2">path</th>
                    <th class="px-3 py-2">lane</th>
                    <th class="px-3 py-2">class</th>
                    <th class="px-3 py-2">history</th>
                    <th class="px-3 py-2 text-right">size</th>
                    <th class="px-3 py-2">updated</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  ${visibleFiles.map(renderAtlasFileRow).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAtlasMetric(label, value, detail) {
    return `
      <div class="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div class="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">${escapeHtml(label)}</div>
        <div class="mt-1 text-2xl font-black text-gray-900">${value}</div>
        <div class="mt-1 text-[11px] text-gray-500">${escapeHtml(detail)}</div>
      </div>
    `;
  }

  function renderAtlasLane(lane, count, total) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div>
        <div class="flex items-center justify-between gap-3 text-xs">
          <span class="font-semibold text-gray-700">${escapeHtml(laneLabel(lane))}</span>
          <span class="text-gray-500">${Formatters.formatNumber(count, 0)} · ${pct}%</span>
        </div>
        <div class="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
          <div class="h-full rounded-full bg-indigo-500" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }

  function renderAtlasCategory(category, activeCategory) {
    const isActive = activeCategory === category.key;
    const historicalPct = category.fileCount > 0
      ? Math.round((category.historicalCount / category.fileCount) * 100)
      : 0;

    return `
      <button onclick="DataLabUI.showAtlasCategory('${escapeAttr(category.key)}')" class="w-full rounded-xl border p-3 text-left transition ${isActive ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-bold text-gray-800 truncate">${escapeHtml(category.key)}</div>
            <div class="mt-1 text-[11px] text-gray-500 line-clamp-2">${escapeHtml(category.description || category.source || '')}</div>
          </div>
          <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">${Formatters.formatNumber(category.fileCount || 0, 0)}</span>
        </div>
        <div class="mt-3 grid grid-cols-3 gap-2 text-[11px] text-gray-500">
          <span>hist ${Formatters.formatNumber(category.historicalCount || 0, 0)}</span>
          <span>${historicalPct}%</span>
          <span class="truncate text-right">${escapeHtml(category.totalSizeLabel || '0 B')}</span>
        </div>
      </button>
    `;
  }

  function renderAtlasFileRow(file) {
    return `
      <tr class="align-top hover:bg-gray-50">
        <td class="px-3 py-2 font-mono text-[11px] text-gray-700 break-all">${escapeHtml(file.path)}</td>
        <td class="px-3 py-2">
          <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">${escapeHtml(laneLabel(file.consumerLane))}</span>
        </td>
        <td class="px-3 py-2 text-gray-600">${escapeHtml(file.contentClass || '-')}</td>
        <td class="px-3 py-2">
          <span class="rounded-full px-2 py-1 text-[10px] font-bold ${file.historical ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
            ${file.historical ? 'yes' : 'no'}
          </span>
        </td>
        <td class="px-3 py-2 text-right text-gray-600">${escapeHtml(file.sizeLabel || '0 B')}</td>
        <td class="px-3 py-2 text-gray-500 whitespace-nowrap">${escapeHtml((file.updatedAt || '').slice(0, 10))}</td>
      </tr>
    `;
  }

  function atlasFilterClass(active) {
    return active
      ? 'rounded-full border border-indigo-300 bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white'
      : 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:border-indigo-300 hover:text-indigo-700';
  }

  function laneLabel(lane) {
    return {
      admin: 'Admin',
      explore: 'Explore',
      market: 'Market',
      screener: 'Screener',
      stock: 'Stock',
      superinvestors: 'Guru'
    }[lane] || lane || '-';
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

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  return {
    init,
    renderSummary,
    renderCards,
    renderLoading,
    renderError,
    renderAtlasLoading,
    renderAtlasUnavailable,
    renderDataAtlas,
    renderOpsLoading,
    renderOpsResults,
    renderOpsUnavailable,
    renderDetails,
    hideDetails,
    updateTimestamp
  };
})();
