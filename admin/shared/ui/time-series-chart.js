/**
 * TimeSeriesChart - Chart.js wrapper for time series data
 *
 * Provides easy-to-use interface for rendering line charts with
 * period selectors and responsive design.
 *
 * @module time-series-chart
 * @version 1.0.0
 * @requires Chart.js 4.4.1 (CDN)
 * @requires Formatters
 */

const TimeSeriesChart = (function() {

  // Chart instances registry
  const instances = new Map();

  // Default configuration
  const DEFAULTS = {
    periods: ['7D', '30D', '90D', '1Y', 'ALL'],
    type: 'line',
    colors: {
      primary: 'rgb(59, 130, 246)',    // blue-500
      secondary: 'rgb(16, 185, 129)',   // emerald-500
      tertiary: 'rgb(245, 158, 11)',    // amber-500
      grid: 'rgba(0, 0, 0, 0.05)',
      text: 'rgb(107, 114, 128)'        // gray-500
    },
    height: 300
  };

  // Period to days mapping
  const PERIOD_DAYS = {
    '7D': 7,
    '30D': 30,
    '90D': 90,
    '1Y': 365,
    '3Y': 1095,
    '5Y': 1825,
    'ALL': Infinity
  };

  /**
   * Filter data by period
   * @param {Array} data - Array of { date, value } or similar
   * @param {string} period - Period string (7D, 30D, etc.)
   * @returns {Array}
   */
  function filterByPeriod(data, period) {
    if (!data || !data.length) return [];
    if (period === 'ALL') return data;

    const days = PERIOD_DAYS[period] || 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return data.filter(d => new Date(d.date) >= cutoff);
  }

  /**
   * Convert benchmark data to chart format
   * @param {Array} data - Benchmark data array
   * @param {string} valueKey - Key for y-axis value (e.g., 'best_pe_ratio')
   * @returns {Array} { date, value }
   */
  function convertBenchmarkData(data, valueKey) {
    return data.map(d => ({
      date: d.date,
      value: d[valueKey]
    })).filter(d => d.value !== null && d.value !== undefined);
  }

  /**
   * Create chart configuration
   * @param {Object} options
   * @returns {Object} Chart.js configuration
   */
  function createConfig(options) {
    const {
      data,
      labels,
      datasets,
      type = 'line',
      title,
      yLabel,
      xLabel,
      colors = DEFAULTS.colors,
      showLegend = true,
      tension = 0.3,
      fill = false
    } = options;

    // Process datasets
    const chartDatasets = datasets.map((ds, i) => {
      const colorKeys = ['primary', 'secondary', 'tertiary'];
      const color = ds.color || colors[colorKeys[i % colorKeys.length]];

      return {
        label: ds.label,
        data: ds.data,
        borderColor: color,
        backgroundColor: fill ? color.replace('rgb', 'rgba').replace(')', ', 0.1)') : 'transparent',
        tension: ds.tension !== undefined ? ds.tension : tension,
        fill: ds.fill !== undefined ? ds.fill : fill,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      };
    });

    return {
      type,
      data: {
        labels,
        datasets: chartDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: showLegend && datasets.length > 1,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 12,
              usePointStyle: true,
              font: { size: 11 }
            }
          },
          title: {
            display: !!title,
            text: title,
            font: { size: 14, weight: 'bold' },
            padding: { bottom: 10 }
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#1f2937',
            bodyColor: '#4b5563',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: (ctx) => {
                const value = ctx.parsed.y;
                return `${ctx.dataset.label}: ${Formatters.formatNumber(value, 2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: !!xLabel,
              text: xLabel,
              color: colors.text
            },
            grid: {
              display: false
            },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              color: colors.text,
              font: { size: 10 }
            }
          },
          y: {
            title: {
              display: !!yLabel,
              text: yLabel,
              color: colors.text
            },
            grid: {
              color: colors.grid
            },
            ticks: {
              color: colors.text,
              font: { size: 10 },
              callback: (value) => Formatters.formatNumber(value, 1)
            }
          }
        }
      }
    };
  }

  /**
   * Render chart with period selector
   * @param {string|HTMLElement} container - Container selector or element
   * @param {Object} options
   * @param {Array} options.data - Raw data array with date field
   * @param {string|Array} options.valueKey - Key(s) for value extraction
   * @param {Array} [options.periods] - Available periods
   * @param {string} [options.defaultPeriod] - Default selected period
   * @param {string} [options.title] - Chart title
   * @param {string} [options.yLabel] - Y-axis label
   * @param {Function} [options.onPeriodChange] - Period change callback
   * @returns {Object} Chart instance wrapper
   */
  function render(container, options) {
    const containerEl = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!containerEl) {
      console.error('[TimeSeriesChart] Container not found:', container);
      return null;
    }

    const {
      data,
      valueKey,
      periods = DEFAULTS.periods,
      defaultPeriod = '1Y',
      title,
      yLabel,
      xLabel,
      height = DEFAULTS.height,
      onPeriodChange
    } = options;

    // Generate unique ID
    const chartId = `tsc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Destroy existing chart if any
    if (instances.has(container)) {
      instances.get(container).destroy();
    }

    // Create HTML structure
    containerEl.innerHTML = `
      <div class="tsc-wrapper">
        <div class="tsc-header flex items-center justify-between mb-3">
          ${title ? `<h3 class="text-sm font-semibold text-gray-700">${title}</h3>` : '<div></div>'}
          <div class="tsc-period-selector flex gap-1" data-chart-id="${chartId}">
            ${periods.map(p => `
              <button
                class="px-2 py-1 text-xs rounded transition-colors ${p === defaultPeriod ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                data-period="${p}"
              >${p}</button>
            `).join('')}
          </div>
        </div>
        <div class="tsc-canvas-wrapper" style="height: ${height}px;">
          <canvas id="${chartId}"></canvas>
        </div>
      </div>
    `;

    // Get canvas
    const canvas = containerEl.querySelector(`#${chartId}`);
    if (!canvas) {
      console.error('[TimeSeriesChart] Canvas not found');
      return null;
    }

    // Prepare initial data
    const valueKeys = Array.isArray(valueKey) ? valueKey : [valueKey];
    const filteredData = filterByPeriod(data, defaultPeriod);

    const datasets = valueKeys.map((key, i) => {
      const keyLabel = typeof key === 'object' ? key.label : key;
      const keyValue = typeof key === 'object' ? key.key : key;

      return {
        label: keyLabel,
        data: filteredData.map(d => d[keyValue])
      };
    });

    const labels = filteredData.map(d => Formatters.formatDate(d.date, 'MM/DD'));

    // Create chart
    const config = createConfig({
      labels,
      datasets,
      yLabel,
      xLabel
    });

    const chart = new Chart(canvas, config);

    // Store instance
    const wrapper = {
      chart,
      data,
      valueKeys,
      currentPeriod: defaultPeriod,
      updatePeriod(period) {
        const filtered = filterByPeriod(data, period);
        const newLabels = filtered.map(d => Formatters.formatDate(d.date, 'MM/DD'));

        chart.data.labels = newLabels;
        valueKeys.forEach((key, i) => {
          const keyValue = typeof key === 'object' ? key.key : key;
          chart.data.datasets[i].data = filtered.map(d => d[keyValue]);
        });

        chart.update('active');
        this.currentPeriod = period;

        if (onPeriodChange) {
          onPeriodChange(period, filtered);
        }
      },
      destroy() {
        chart.destroy();
        instances.delete(container);
      }
    };

    instances.set(container, wrapper);

    // Setup period selector events
    const periodBtns = containerEl.querySelectorAll('.tsc-period-selector button');
    periodBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.target.dataset.period;

        // Update button styles
        periodBtns.forEach(b => {
          b.classList.remove('bg-blue-500', 'text-white');
          b.classList.add('bg-gray-100', 'text-gray-600');
        });
        e.target.classList.remove('bg-gray-100', 'text-gray-600');
        e.target.classList.add('bg-blue-500', 'text-white');

        // Update chart
        wrapper.updatePeriod(period);
      });
    });

    return wrapper;
  }

  /**
   * Render comparison chart (multiple series)
   * @param {string|HTMLElement} container
   * @param {Object} options
   * @param {Array} options.series - Array of { name, data, valueKey }
   * @returns {Object} Chart wrapper
   */
  function renderComparison(container, options) {
    const { series, ...restOptions } = options;

    // Merge all dates
    const allDates = new Set();
    series.forEach(s => {
      s.data.forEach(d => allDates.add(d.date));
    });
    const sortedDates = Array.from(allDates).sort();

    // Create aligned datasets
    const datasets = series.map(s => {
      const dataMap = new Map(s.data.map(d => [d.date, d[s.valueKey]]));
      return {
        label: s.name,
        data: sortedDates.map(date => dataMap.get(date) || null),
        color: s.color
      };
    });

    // Create merged data with dates
    const mergedData = sortedDates.map(date => {
      const row = { date };
      series.forEach(s => {
        const dataMap = new Map(s.data.map(d => [d.date, d[s.valueKey]]));
        row[s.name] = dataMap.get(date) || null;
      });
      return row;
    });

    return render(container, {
      ...restOptions,
      data: mergedData,
      valueKey: series.map(s => ({ key: s.name, label: s.name }))
    });
  }

  /**
   * Get chart instance
   * @param {string|HTMLElement} container
   * @returns {Object|null}
   */
  function getInstance(container) {
    return instances.get(container) || null;
  }

  /**
   * Destroy all chart instances
   */
  function destroyAll() {
    instances.forEach(wrapper => wrapper.destroy());
    instances.clear();
  }

  return {
    render,
    renderComparison,
    filterByPeriod,
    convertBenchmarkData,
    createConfig,
    getInstance,
    destroyAll,
    DEFAULTS,
    PERIOD_DAYS
  };
})();
