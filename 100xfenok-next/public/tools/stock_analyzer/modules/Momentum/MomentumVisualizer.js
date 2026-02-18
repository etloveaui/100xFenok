/**
 * MomentumVisualizer - Visualization components for momentum data
 * Creates charts, heatmaps, and other visual representations
 *
 * @module Momentum/MomentumVisualizer
 * @version 1.0.0
 */

class MomentumVisualizer {
    constructor(config = {}) {
        this.config = {
            chartLibrary: config.chartLibrary || 'canvas', // canvas, svg, chartjs
            colorScheme: config.colorScheme || 'default',
            animationDuration: config.animationDuration || 300,
            responsive: config.responsive !== false,
            tooltips: config.tooltips !== false,
            maxDataPoints: config.maxDataPoints || 1000
        };

        // Color schemes
        this.colorSchemes = {
            default: {
                positive: '#10b981',
                negative: '#ef4444',
                neutral: '#6b7280',
                primary: '#3b82f6',
                secondary: '#8b5cf6',
                warning: '#f59e0b',
                gradient: {
                    positive: ['#dcfce7', '#86efac', '#22c55e', '#16a34a', '#15803d'],
                    negative: ['#fee2e2', '#fca5a5', '#ef4444', '#dc2626', '#991b1b'],
                    heatmap: ['#0d9488', '#10b981', '#84cc16', '#eab308', '#f59e0b', '#ef4444']
                }
            },
            dark: {
                positive: '#34d399',
                negative: '#f87171',
                neutral: '#9ca3af',
                primary: '#60a5fa',
                secondary: '#a78bfa',
                warning: '#fbbf24',
                gradient: {
                    positive: ['#064e3b', '#047857', '#10b981', '#34d399', '#6ee7b7'],
                    negative: ['#7f1d1d', '#991b1b', '#dc2626', '#ef4444', '#f87171'],
                    heatmap: ['#115e59', '#0d9488', '#14b8a6', '#5eead4', '#99f6e4']
                }
            }
        };

        this.currentScheme = this.colorSchemes[this.config.colorScheme] || this.colorSchemes.default;

        // Chart instances
        this.charts = new Map();

        // Canvas contexts
        this.canvases = new Map();

        console.log('✅ MomentumVisualizer initialized');
    }

    /**
     * Create momentum heatmap
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Company data with momentum scores
     * @param {Object} options - Visualization options
     */
    createHeatmap(container, data, options = {}) {
        const config = {
            rows: options.rows || 10,
            cols: options.cols || 10,
            metric: options.metric || 'momentumScore',
            groupBy: options.groupBy || 'sector',
            showLabels: options.showLabels !== false,
            interactive: options.interactive !== false,
            ...options
        };

        // Clear container
        container.innerHTML = '';

        // Create heatmap container
        const heatmapDiv = document.createElement('div');
        heatmapDiv.className = 'momentum-heatmap';
        heatmapDiv.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: repeat(${config.cols}, 1fr);
            grid-template-rows: repeat(${config.rows}, 1fr);
            gap: 2px;
            padding: 10px;
        `;

        // Group and prepare data
        const grouped = this.groupDataForHeatmap(data, config);

        // Create cells
        grouped.forEach((item, index) => {
            const cell = this.createHeatmapCell(item, config);
            heatmapDiv.appendChild(cell);
        });

        // Add legend
        if (config.showLegend !== false) {
            const legend = this.createHeatmapLegend(config);
            container.appendChild(legend);
        }

        container.appendChild(heatmapDiv);

        // Store reference
        this.charts.set(`heatmap-${container.id}`, {
            type: 'heatmap',
            container,
            data: grouped,
            config
        });
    }

    /**
     * Create line chart for momentum trends
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Time series data
     * @param {Object} options - Chart options
     */
    createLineChart(container, data, options = {}) {
        const config = {
            width: options.width || container.clientWidth,
            height: options.height || 300,
            padding: options.padding || { top: 20, right: 20, bottom: 40, left: 60 },
            showGrid: options.showGrid !== false,
            showLegend: options.showLegend !== false,
            animate: options.animate !== false,
            ...options
        };

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        this.canvases.set(`line-${container.id}`, ctx);

        // Calculate scales
        const scales = this.calculateScales(data, config);

        // Draw grid
        if (config.showGrid) {
            this.drawGrid(ctx, scales, config);
        }

        // Draw axes
        this.drawAxes(ctx, scales, config);

        // Draw lines
        if (Array.isArray(data[0])) {
            // Multiple series
            data.forEach((series, index) => {
                this.drawLine(ctx, series, scales, config, index);
            });
        } else {
            // Single series
            this.drawLine(ctx, data, scales, config, 0);
        }

        // Draw legend
        if (config.showLegend && config.series) {
            this.drawLegend(ctx, config.series, config);
        }

        // Add interactivity
        if (config.interactive !== false) {
            this.addChartInteractivity(canvas, data, scales, config);
        }
    }

    /**
     * Create bar chart for rankings
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Company data
     * @param {Object} options - Chart options
     */
    createBarChart(container, data, options = {}) {
        const config = {
            width: options.width || container.clientWidth,
            height: options.height || 300,
            padding: options.padding || { top: 20, right: 20, bottom: 40, left: 60 },
            orientation: options.orientation || 'vertical',
            showValues: options.showValues !== false,
            limit: options.limit || 20,
            ...options
        };

        // Limit data
        const limitedData = data.slice(0, config.limit);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        this.canvases.set(`bar-${container.id}`, ctx);

        // Draw bars
        if (config.orientation === 'horizontal') {
            this.drawHorizontalBars(ctx, limitedData, config);
        } else {
            this.drawVerticalBars(ctx, limitedData, config);
        }
    }

    /**
     * Create scatter plot for correlation analysis
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Data points [{x, y, label}]
     * @param {Object} options - Chart options
     */
    createScatterPlot(container, data, options = {}) {
        const config = {
            width: options.width || container.clientWidth,
            height: options.height || 400,
            padding: options.padding || { top: 20, right: 20, bottom: 40, left: 60 },
            pointSize: options.pointSize || 4,
            showTrendline: options.showTrendline !== false,
            showQuadrants: options.showQuadrants !== false,
            ...options
        };

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        this.canvases.set(`scatter-${container.id}`, ctx);

        // Calculate scales
        const scales = this.calculateScatterScales(data, config);

        // Draw grid
        this.drawGrid(ctx, scales, config);

        // Draw quadrants
        if (config.showQuadrants) {
            this.drawQuadrants(ctx, scales, config);
        }

        // Draw axes
        this.drawAxes(ctx, scales, config);

        // Draw points
        this.drawScatterPoints(ctx, data, scales, config);

        // Draw trendline
        if (config.showTrendline) {
            this.drawTrendline(ctx, data, scales, config);
        }

        // Add labels if specified
        if (config.showLabels) {
            this.drawScatterLabels(ctx, data, scales, config);
        }
    }

    /**
     * Create sparkline chart
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Data points
     * @param {Object} options - Chart options
     */
    createSparkline(container, data, options = {}) {
        const config = {
            width: options.width || 100,
            height: options.height || 30,
            lineWidth: options.lineWidth || 1,
            color: options.color || this.currentScheme.primary,
            showDots: options.showDots || false,
            ...options
        };

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');

        // Calculate min/max
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        // Draw sparkline
        ctx.strokeStyle = config.color;
        ctx.lineWidth = config.lineWidth;
        ctx.beginPath();

        data.forEach((value, index) => {
            const x = (index / (data.length - 1)) * config.width;
            const y = config.height - ((value - min) / range) * config.height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            // Draw dots if requested
            if (config.showDots) {
                ctx.fillStyle = config.color;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        ctx.stroke();

        // Highlight last point
        const lastX = config.width;
        const lastY = config.height - ((data[data.length - 1] - min) / range) * config.height;
        ctx.fillStyle = data[data.length - 1] >= data[0]
            ? this.currentScheme.positive
            : this.currentScheme.negative;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Create gauge chart for single metric
     * @param {HTMLElement} container - Container element
     * @param {number} value - Current value
     * @param {Object} options - Chart options
     */
    createGauge(container, value, options = {}) {
        const config = {
            min: options.min || 0,
            max: options.max || 100,
            width: options.width || 200,
            height: options.height || 150,
            label: options.label || '',
            zones: options.zones || [
                { min: 0, max: 30, color: this.currentScheme.negative },
                { min: 30, max: 70, color: this.currentScheme.warning },
                { min: 70, max: 100, color: this.currentScheme.positive }
            ],
            ...options
        };

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');

        const centerX = config.width / 2;
        const centerY = config.height - 20;
        const radius = Math.min(config.width, config.height) / 2 - 20;

        // Draw background arc
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, Math.PI, 0);
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 20;
        ctx.stroke();

        // Draw zones
        config.zones.forEach(zone => {
            const startAngle = Math.PI + (zone.min / config.max) * Math.PI;
            const endAngle = Math.PI + (zone.max / config.max) * Math.PI;

            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.strokeStyle = zone.color;
            ctx.lineWidth = 18;
            ctx.stroke();
        });

        // Draw needle
        const needleAngle = Math.PI + (value / config.max) * Math.PI;
        const needleLength = radius - 10;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(needleAngle);

        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(0, -needleLength);
        ctx.lineTo(5, 0);
        ctx.fillStyle = '#1f2937';
        ctx.fill();

        ctx.restore();

        // Draw center circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#1f2937';
        ctx.fill();

        // Draw value text
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(value.toFixed(0), centerX, centerY + 40);

        // Draw label
        if (config.label) {
            ctx.font = '14px sans-serif';
            ctx.fillText(config.label, centerX, centerY + 60);
        }
    }

    /**
     * Create comparison chart
     * @param {HTMLElement} container - Container element
     * @param {Array} companies - Companies to compare
     * @param {Array} metrics - Metrics to compare
     * @param {Object} options - Chart options
     */
    createComparisonChart(container, companies, metrics, options = {}) {
        const config = {
            type: options.type || 'radar', // radar, bar, parallel
            width: options.width || container.clientWidth,
            height: options.height || 400,
            normalize: options.normalize !== false,
            ...options
        };

        if (config.type === 'radar') {
            this.createRadarChart(container, companies, metrics, config);
        } else if (config.type === 'bar') {
            this.createGroupedBarChart(container, companies, metrics, config);
        } else if (config.type === 'parallel') {
            this.createParallelCoordinates(container, companies, metrics, config);
        }
    }

    /**
     * Create radar chart
     * @private
     */
    createRadarChart(container, companies, metrics, config) {
        const canvas = document.createElement('canvas');
        canvas.width = config.width;
        canvas.height = config.height;
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const centerX = config.width / 2;
        const centerY = config.height / 2;
        const radius = Math.min(config.width, config.height) / 2 - 60;

        // Calculate angles
        const angleStep = (Math.PI * 2) / metrics.length;

        // Draw grid
        for (let i = 1; i <= 5; i++) {
            const r = (radius / 5) * i;
            ctx.beginPath();

            for (let j = 0; j < metrics.length; j++) {
                const angle = j * angleStep - Math.PI / 2;
                const x = centerX + r * Math.cos(angle);
                const y = centerY + r * Math.sin(angle);

                if (j === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.closePath();
            ctx.strokeStyle = '#e5e7eb';
            ctx.stroke();
        }

        // Draw axes and labels
        metrics.forEach((metric, index) => {
            const angle = index * angleStep - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            // Draw axis
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = '#d1d5db';
            ctx.stroke();

            // Draw label
            const labelX = centerX + (radius + 20) * Math.cos(angle);
            const labelY = centerY + (radius + 20) * Math.sin(angle);

            ctx.fillStyle = '#6b7280';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(metric.label || metric, labelX, labelY);
        });

        // Draw data
        companies.forEach((company, companyIndex) => {
            const points = [];

            metrics.forEach((metric, metricIndex) => {
                const value = this.normalizeValue(
                    company[metric.field || metric],
                    metric.min || 0,
                    metric.max || 100
                );

                const angle = metricIndex * angleStep - Math.PI / 2;
                const r = radius * value;
                const x = centerX + r * Math.cos(angle);
                const y = centerY + r * Math.sin(angle);

                points.push({ x, y });
            });

            // Draw filled area
            ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.closePath();

            const color = this.getColorForIndex(companyIndex);
            ctx.fillStyle = color + '33'; // Add transparency
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw points
            points.forEach(point => {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });
        });

        // Draw legend
        this.drawComparisonLegend(ctx, companies, config);
    }

    /**
     * Group data for heatmap
     * @private
     */
    groupDataForHeatmap(data, config) {
        const grouped = [];
        const maxItems = config.rows * config.cols;

        // Sort by metric
        const sorted = [...data].sort((a, b) => {
            const aVal = a[config.metric] || 0;
            const bVal = b[config.metric] || 0;
            return bVal - aVal;
        });

        // Take top items
        const items = sorted.slice(0, maxItems);

        // Group if specified
        if (config.groupBy) {
            const groups = {};
            items.forEach(item => {
                const group = item[config.groupBy] || 'Other';
                if (!groups[group]) {
                    groups[group] = [];
                }
                groups[group].push(item);
            });

            // Flatten groups
            Object.values(groups).forEach(group => {
                grouped.push(...group);
            });
        } else {
            grouped.push(...items);
        }

        return grouped;
    }

    /**
     * Create heatmap cell
     * @private
     */
    createHeatmapCell(item, config) {
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        const value = item[config.metric] || 0;
        const color = this.getHeatmapColor(value, config);

        cell.style.cssText = `
            background-color: ${color};
            border-radius: 4px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            position: relative;
            min-height: 60px;
        `;

        // Add content
        if (config.showLabels) {
            const label = document.createElement('div');
            label.style.cssText = `
                font-size: 10px;
                font-weight: bold;
                color: white;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            `;
            label.textContent = item.Ticker || '';
            cell.appendChild(label);

            const valueDiv = document.createElement('div');
            valueDiv.style.cssText = `
                font-size: 12px;
                color: white;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            `;
            valueDiv.textContent = value.toFixed(1);
            cell.appendChild(valueDiv);
        }

        // Add hover effect
        cell.addEventListener('mouseenter', () => {
            cell.style.transform = 'scale(1.05)';
            cell.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
        });

        cell.addEventListener('mouseleave', () => {
            cell.style.transform = 'scale(1)';
            cell.style.boxShadow = 'none';
        });

        // Add tooltip
        if (config.interactive) {
            const tooltip = document.createElement('div');
            tooltip.className = 'heatmap-tooltip';
            tooltip.style.cssText = `
                position: absolute;
                background: rgba(0,0,0,0.9);
                color: white;
                padding: 8px;
                border-radius: 4px;
                font-size: 12px;
                z-index: 1000;
                display: none;
                white-space: nowrap;
                pointer-events: none;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                margin-bottom: 5px;
            `;
            tooltip.innerHTML = `
                <strong>${item.Ticker}</strong><br>
                ${item.corpName || ''}<br>
                ${config.metric}: ${value.toFixed(2)}
            `;
            cell.appendChild(tooltip);

            cell.addEventListener('mouseenter', () => {
                tooltip.style.display = 'block';
            });

            cell.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });
        }

        return cell;
    }

    /**
     * Get heatmap color based on value
     * @private
     */
    getHeatmapColor(value, config) {
        const colors = this.currentScheme.gradient.heatmap;
        const min = config.min || 0;
        const max = config.max || 100;

        const normalized = (value - min) / (max - min);
        const index = Math.floor(normalized * (colors.length - 1));

        return colors[Math.max(0, Math.min(colors.length - 1, index))];
    }

    /**
     * Create heatmap legend
     * @private
     */
    createHeatmapLegend(config) {
        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';
        legend.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 20px;
            gap: 10px;
        `;

        // Create gradient bar
        const gradientBar = document.createElement('div');
        const colors = this.currentScheme.gradient.heatmap;
        const gradient = `linear-gradient(to right, ${colors.join(', ')})`;

        gradientBar.style.cssText = `
            width: 200px;
            height: 20px;
            background: ${gradient};
            border-radius: 4px;
        `;

        // Add labels
        const minLabel = document.createElement('span');
        minLabel.textContent = config.min || '0';
        minLabel.style.fontSize = '12px';

        const maxLabel = document.createElement('span');
        maxLabel.textContent = config.max || '100';
        maxLabel.style.fontSize = '12px';

        legend.appendChild(minLabel);
        legend.appendChild(gradientBar);
        legend.appendChild(maxLabel);

        return legend;
    }

    /**
     * Draw grid lines
     * @private
     */
    drawGrid(ctx, scales, config) {
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.5;

        // Vertical grid lines
        for (let i = 0; i <= 10; i++) {
            const x = config.padding.left + (i / 10) * scales.width;
            ctx.beginPath();
            ctx.moveTo(x, config.padding.top);
            ctx.lineTo(x, config.height - config.padding.bottom);
            ctx.stroke();
        }

        // Horizontal grid lines
        for (let i = 0; i <= 10; i++) {
            const y = config.padding.top + (i / 10) * scales.height;
            ctx.beginPath();
            ctx.moveTo(config.padding.left, y);
            ctx.lineTo(config.width - config.padding.right, y);
            ctx.stroke();
        }
    }

    /**
     * Draw axes
     * @private
     */
    drawAxes(ctx, scales, config) {
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2;

        // X-axis
        ctx.beginPath();
        ctx.moveTo(config.padding.left, config.height - config.padding.bottom);
        ctx.lineTo(config.width - config.padding.right, config.height - config.padding.bottom);
        ctx.stroke();

        // Y-axis
        ctx.beginPath();
        ctx.moveTo(config.padding.left, config.padding.top);
        ctx.lineTo(config.padding.left, config.height - config.padding.bottom);
        ctx.stroke();

        // Labels would go here
    }

    /**
     * Calculate scales for chart
     * @private
     */
    calculateScales(data, config) {
        let minY = Infinity;
        let maxY = -Infinity;

        // Find min/max values
        const processData = (d) => {
            if (Array.isArray(d)) {
                d.forEach(processData);
            } else if (typeof d === 'object' && d.value !== undefined) {
                minY = Math.min(minY, d.value);
                maxY = Math.max(maxY, d.value);
            } else if (typeof d === 'number') {
                minY = Math.min(minY, d);
                maxY = Math.max(maxY, d);
            }
        };

        processData(data);

        // Add padding to range
        const range = maxY - minY;
        minY -= range * 0.1;
        maxY += range * 0.1;

        return {
            minY,
            maxY,
            width: config.width - config.padding.left - config.padding.right,
            height: config.height - config.padding.top - config.padding.bottom
        };
    }

    /**
     * Draw line on chart
     * @private
     */
    drawLine(ctx, data, scales, config, seriesIndex) {
        const color = this.getColorForIndex(seriesIndex);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        data.forEach((point, index) => {
            const value = typeof point === 'number' ? point : point.value;
            const x = config.padding.left + (index / (data.length - 1)) * scales.width;
            const y = config.padding.top + (1 - (value - scales.minY) / (scales.maxY - scales.minY)) * scales.height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            // Draw point
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.stroke();
    }

    /**
     * Get color for series index
     * @private
     */
    getColorForIndex(index) {
        const colors = [
            this.currentScheme.primary,
            this.currentScheme.secondary,
            this.currentScheme.positive,
            this.currentScheme.warning,
            '#ec4899',
            '#14b8a6',
            '#f97316',
            '#6366f1'
        ];

        return colors[index % colors.length];
    }

    /**
     * Normalize value to 0-1 range
     * @private
     */
    normalizeValue(value, min, max) {
        if (value === null || value === undefined) return 0;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    /**
     * Clear all charts
     */
    clearCharts() {
        this.charts.clear();
        this.canvases.clear();
    }

    /**
     * Update color scheme
     * @param {string} scheme - Color scheme name
     */
    setColorScheme(scheme) {
        if (this.colorSchemes[scheme]) {
            this.config.colorScheme = scheme;
            this.currentScheme = this.colorSchemes[scheme];
        }
    }

    /**
     * Export chart as image
     * @param {string} chartId - Chart identifier
     * @returns {string} Data URL
     */
    exportChart(chartId) {
        const canvas = this.canvases.get(chartId);
        if (canvas && canvas.canvas) {
            return canvas.canvas.toDataURL('image/png');
        }
        return null;
    }

    /**
     * Destroy visualizer
     */
    destroy() {
        this.clearCharts();
        console.log('✅ MomentumVisualizer destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.MomentumVisualizer = MomentumVisualizer;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MomentumVisualizer;
}