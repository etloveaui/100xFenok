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
   * Render Ops loading state
   */
  function renderOpsLoading() {
    if (!elements?.opsContainer) return;
    elements.opsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-5 shadow animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div class="space-y-3">
          <div class="h-3 bg-gray-200 rounded w-full"></div>
          <div class="h-3 bg-gray-200 rounded w-4/5"></div>
          <div class="h-3 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
      <div class="bg-white rounded-xl p-5 shadow animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div class="space-y-3">
          <div class="h-3 bg-gray-200 rounded w-full"></div>
          <div class="h-3 bg-gray-200 rounded w-4/5"></div>
          <div class="h-3 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
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
        title: 'Source / Live Drift',
        icon: 'fa-code-compare',
        description: 'GitHub source HEAD vs current served admin assets',
        items: results.drift
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
    const badge = failed > 0
      ? { text: 'FAIL', cls: 'bg-red-100 text-red-700 border-red-200' }
      : warn > 0
        ? { text: 'WARN', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' }
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

  return {
    init,
    renderSummary,
    renderCards,
    renderLoading,
    renderError,
    renderOpsLoading,
    renderOpsResults,
    renderOpsUnavailable,
    renderDetails,
    hideDetails,
    updateTimestamp
  };
})();
