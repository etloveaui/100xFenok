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

  return {
    init,
    renderSummary,
    renderCards,
    renderLoading,
    renderError,
    renderDetails,
    hideDetails,
    updateTimestamp
  };
})();
