/**
 * DataTable - Searchable, sortable, paginated table component
 *
 * Renders data in a clean table format with built-in search,
 * sorting, and pagination features.
 *
 * @module data-table
 * @version 1.0.0
 * @requires Formatters
 */

const DataTable = (function() {

  // Table instances registry
  const instances = new Map();

  // Default configuration
  const DEFAULTS = {
    pageSize: 10,
    pageSizes: [10, 25, 50, 100],
    searchable: true,
    sortable: true,
    showPagination: true
  };

  /**
   * Column type formatters
   */
  const TYPE_FORMATTERS = {
    number: (val, decimals = 2) => Formatters.formatNumber(val, decimals),
    percent: (val, decimals = 1) => Formatters.formatPercent(val, decimals),
    date: (val, format = 'YYYY-MM-DD') => Formatters.formatDate(val, format),
    compact: (val, decimals = 1) => Formatters.formatCompact(val, decimals),
    text: (val) => val || '-',
    badge: (val, config) => {
      const badgeConfig = config.badges?.[val] || { bg: 'bg-gray-100', text: 'text-gray-600' };
      return `<span class="px-2 py-0.5 rounded text-xs font-medium ${badgeConfig.bg} ${badgeConfig.text}">${val}</span>`;
    }
  };

  /**
   * Sort comparator factory
   * @param {string} type - Column type
   * @returns {Function}
   */
  function getSortComparator(type) {
    switch (type) {
      case 'number':
      case 'percent':
      case 'compact':
        return (a, b) => (a || 0) - (b || 0);
      case 'date':
        return (a, b) => new Date(a || 0) - new Date(b || 0);
      default:
        return (a, b) => String(a || '').localeCompare(String(b || ''));
    }
  }

  /**
   * Filter data by search query
   * @param {Array} data - Data array
   * @param {string} query - Search query
   * @param {Array} columns - Column definitions
   * @returns {Array}
   */
  function filterData(data, query, columns) {
    if (!query || !query.trim()) return data;

    const searchTerm = query.toLowerCase().trim();
    const searchableCols = columns.filter(c => c.searchable !== false);

    return data.filter(row => {
      return searchableCols.some(col => {
        const value = row[col.key];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(searchTerm);
      });
    });
  }

  /**
   * Sort data by column
   * @param {Array} data - Data array
   * @param {string} key - Column key
   * @param {string} direction - 'asc' or 'desc'
   * @param {Object} column - Column definition
   * @returns {Array}
   */
  function sortData(data, key, direction, column) {
    const comparator = getSortComparator(column.type || 'text');
    const sorted = [...data].sort((a, b) => comparator(a[key], b[key]));
    return direction === 'desc' ? sorted.reverse() : sorted;
  }

  /**
   * Paginate data
   * @param {Array} data - Data array
   * @param {number} page - Current page (1-based)
   * @param {number} pageSize - Items per page
   * @returns {Object} { items, totalPages, start, end }
   */
  function paginateData(data, page, pageSize) {
    const totalPages = Math.ceil(data.length / pageSize);
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, data.length);

    return {
      items: data.slice(start, end),
      totalPages,
      start: start + 1,
      end,
      total: data.length
    };
  }

  /**
   * Render table header
   * @param {Array} columns
   * @param {Object} sortState
   * @param {boolean} sortable
   * @returns {string}
   */
  function renderHeader(columns, sortState, sortable) {
    const cells = columns.map(col => {
      const isSorted = sortState.key === col.key;
      const sortIcon = sortable && col.sortable !== false
        ? `<i class="fas fa-sort${isSorted ? (sortState.direction === 'asc' ? '-up' : '-down') : ''} ml-1 text-xs ${isSorted ? 'text-blue-500' : 'text-gray-300'}"></i>`
        : '';

      const cursorClass = sortable && col.sortable !== false ? 'cursor-pointer hover:bg-gray-100' : '';
      const widthStyle = col.width ? `width: ${col.width};` : '';

      return `
        <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider ${cursorClass}"
            style="${widthStyle}"
            data-key="${col.key}"
            ${sortable && col.sortable !== false ? 'data-sortable="true"' : ''}>
          <div class="flex items-center gap-1">
            ${col.label}${sortIcon}
          </div>
        </th>
      `;
    }).join('');

    return `<thead class="bg-gray-50 border-b border-gray-200"><tr>${cells}</tr></thead>`;
  }

  /**
   * Render table body
   * @param {Array} data - Page data
   * @param {Array} columns
   * @param {Object} options
   * @returns {string}
   */
  function renderBody(data, columns, options = {}) {
    if (!data.length) {
      return `
        <tbody>
          <tr>
            <td colspan="${columns.length}" class="px-4 py-8 text-center text-gray-500">
              <i class="fas fa-inbox text-3xl text-gray-300 mb-2"></i>
              <p>No data available</p>
            </td>
          </tr>
        </tbody>
      `;
    }

    const rows = data.map((row, rowIdx) => {
      const cells = columns.map(col => {
        let value = row[col.key];

        // Format value based on type
        if (col.formatter) {
          value = col.formatter(value, row);
        } else if (col.type && TYPE_FORMATTERS[col.type]) {
          value = TYPE_FORMATTERS[col.type](value, col.decimals || col.format || col);
        } else {
          value = value ?? '-';
        }

        const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
        const cellClass = col.cellClass || '';

        return `<td class="px-4 py-3 text-sm ${alignClass} ${cellClass}">${value}</td>`;
      }).join('');

      const rowClass = options.onRowClick ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-gray-50';
      return `<tr class="${rowClass} border-b border-gray-100" data-row-index="${rowIdx}">${cells}</tr>`;
    }).join('');

    return `<tbody>${rows}</tbody>`;
  }

  /**
   * Render pagination controls
   * @param {Object} pageInfo
   * @param {Array} pageSizes
   * @param {number} currentPageSize
   * @returns {string}
   */
  function renderPagination(pageInfo, pageSizes, currentPageSize) {
    const { totalPages, start, end, total } = pageInfo;
    const currentPage = Math.ceil(start / currentPageSize);

    // Page buttons
    let pageButtons = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      const isActive = i === currentPage;
      pageButtons += `
        <button class="px-3 py-1 text-sm rounded ${isActive ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'} border"
                data-page="${i}" ${isActive ? 'disabled' : ''}>
          ${i}
        </button>
      `;
    }

    return `
      <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
        <div class="flex items-center gap-4 text-sm text-gray-600">
          <span>Showing ${start}-${end} of ${total}</span>
          <select class="dt-page-size border rounded px-2 py-1 text-sm">
            ${pageSizes.map(s => `<option value="${s}" ${s === currentPageSize ? 'selected' : ''}>${s} / page</option>`).join('')}
          </select>
        </div>
        <div class="flex items-center gap-1">
          <button class="dt-prev px-2 py-1 text-sm rounded border bg-white text-gray-600 hover:bg-gray-100 ${currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                  ${currentPage <= 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i>
          </button>
          ${pageButtons}
          <button class="dt-next px-2 py-1 text-sm rounded border bg-white text-gray-600 hover:bg-gray-100 ${currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
                  ${currentPage >= totalPages ? 'disabled' : ''}>
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render complete table
   * @param {string|HTMLElement} container
   * @param {Object} config
   * @param {Array} config.columns - Column definitions
   * @param {Array} config.data - Data array
   * @param {Object} [config.options] - Table options
   * @returns {Object} Table instance
   */
  function render(container, config) {
    const containerEl = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!containerEl) {
      console.error('[DataTable] Container not found:', container);
      return null;
    }

    const { columns, data: rawData, options = {} } = config;
    const {
      pageSize = DEFAULTS.pageSize,
      pageSizes = DEFAULTS.pageSizes,
      searchable = DEFAULTS.searchable,
      sortable = DEFAULTS.sortable,
      showPagination = DEFAULTS.showPagination,
      onRowClick,
      title,
      emptyMessage
    } = options;

    // Destroy existing instance
    if (instances.has(container)) {
      instances.delete(container);
    }

    // State
    const state = {
      data: rawData,
      filteredData: rawData,
      currentPage: 1,
      pageSize,
      sortKey: null,
      sortDirection: 'asc',
      searchQuery: ''
    };

    // Generate ID
    const tableId = `dt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    /**
     * Re-render table
     */
    function update() {
      // Apply search
      let processedData = filterData(state.data, state.searchQuery, columns);

      // Apply sort
      if (state.sortKey) {
        const col = columns.find(c => c.key === state.sortKey);
        if (col) {
          processedData = sortData(processedData, state.sortKey, state.sortDirection, col);
        }
      }

      state.filteredData = processedData;

      // Paginate
      const pageInfo = paginateData(processedData, state.currentPage, state.pageSize);

      // Update table body
      const tbody = containerEl.querySelector('.dt-body');
      if (tbody) {
        tbody.innerHTML = renderBody(pageInfo.items, columns, { onRowClick }).replace('<tbody>', '').replace('</tbody>', '');
      }

      // Update pagination
      if (showPagination) {
        const paginationEl = containerEl.querySelector('.dt-pagination');
        if (paginationEl) {
          paginationEl.innerHTML = renderPagination(pageInfo, pageSizes, state.pageSize)
            .replace('<div class="flex', '<div class="flex').replace('</div></div>', '</div>');
        }
      }

      // Update result count
      const countEl = containerEl.querySelector('.dt-count');
      if (countEl) {
        countEl.textContent = `${processedData.length} results`;
      }
    }

    // Initial render
    const pageInfo = paginateData(rawData, state.currentPage, state.pageSize);

    containerEl.innerHTML = `
      <div class="dt-wrapper bg-white rounded-xl shadow overflow-hidden" id="${tableId}">
        ${title || searchable ? `
          <div class="px-4 py-3 border-b flex items-center justify-between">
            ${title ? `<h3 class="font-semibold text-gray-800">${title}</h3>` : '<div></div>'}
            ${searchable ? `
              <div class="flex items-center gap-2">
                <span class="dt-count text-xs text-gray-400">${rawData.length} results</span>
                <div class="relative">
                  <input type="text" class="dt-search pl-8 pr-3 py-1.5 text-sm border rounded-lg w-48 focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                         placeholder="Search...">
                  <i class="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="overflow-x-auto">
          <table class="w-full">
            ${renderHeader(columns, { key: state.sortKey, direction: state.sortDirection }, sortable)}
            <tbody class="dt-body">
              ${renderBody(pageInfo.items, columns, { onRowClick }).replace('<tbody>', '').replace('</tbody>', '')}
            </tbody>
          </table>
        </div>

        ${showPagination ? `<div class="dt-pagination">${renderPagination(pageInfo, pageSizes, state.pageSize)}</div>` : ''}
      </div>
    `;

    // Event handlers
    // Search
    const searchInput = containerEl.querySelector('.dt-search');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = e.target.value;
          state.currentPage = 1;
          update();
        }, 200);
      });
    }

    // Sort
    containerEl.querySelectorAll('th[data-sortable="true"]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (state.sortKey === key) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDirection = 'asc';
        }
        state.currentPage = 1;

        // Update header icons
        containerEl.querySelectorAll('th[data-sortable="true"]').forEach(h => {
          const icon = h.querySelector('i');
          if (icon) {
            icon.className = `fas fa-sort${h.dataset.key === state.sortKey ? (state.sortDirection === 'asc' ? '-up' : '-down') : ''} ml-1 text-xs ${h.dataset.key === state.sortKey ? 'text-blue-500' : 'text-gray-300'}`;
          }
        });

        update();
      });
    });

    // Pagination
    containerEl.addEventListener('click', (e) => {
      const pageBtn = e.target.closest('[data-page]');
      if (pageBtn) {
        state.currentPage = parseInt(pageBtn.dataset.page);
        update();
        return;
      }

      if (e.target.closest('.dt-prev')) {
        if (state.currentPage > 1) {
          state.currentPage--;
          update();
        }
        return;
      }

      if (e.target.closest('.dt-next')) {
        const totalPages = Math.ceil(state.filteredData.length / state.pageSize);
        if (state.currentPage < totalPages) {
          state.currentPage++;
          update();
        }
        return;
      }

      // Row click
      if (onRowClick) {
        const row = e.target.closest('tr[data-row-index]');
        if (row) {
          const idx = parseInt(row.dataset.rowIndex);
          const pageInfo = paginateData(state.filteredData, state.currentPage, state.pageSize);
          if (pageInfo.items[idx]) {
            onRowClick(pageInfo.items[idx], idx);
          }
        }
      }
    });

    // Page size change
    containerEl.addEventListener('change', (e) => {
      if (e.target.classList.contains('dt-page-size')) {
        state.pageSize = parseInt(e.target.value);
        state.currentPage = 1;
        update();
      }
    });

    // Instance methods
    const instance = {
      state,
      setData(newData) {
        state.data = newData;
        state.currentPage = 1;
        update();
      },
      refresh() {
        update();
      },
      getFilteredData() {
        return state.filteredData;
      },
      destroy() {
        containerEl.innerHTML = '';
        instances.delete(container);
      }
    };

    instances.set(container, instance);
    return instance;
  }

  /**
   * Get table instance
   * @param {string|HTMLElement} container
   * @returns {Object|null}
   */
  function getInstance(container) {
    return instances.get(container) || null;
  }

  return {
    render,
    getInstance,
    filterData,
    sortData,
    paginateData,
    TYPE_FORMATTERS,
    DEFAULTS
  };
})();
