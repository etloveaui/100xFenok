/**
 * TreemapRenderer - D3.js 트리맵 렌더러
 *
 * 계층적 데이터를 트리맵으로 시각화
 *
 * 기능:
 * - D3.js treemap 레이아웃
 * - 모멘텀 기반 색상 코딩 (빨강/초록)
 * - 부드러운 애니메이션 (0.5초)
 * - 인터랙티브 호버 효과
 * - 클릭 드릴다운
 * - 반응형 크기 조정
 *
 * @class TreemapRenderer
 */

export default class TreemapRenderer {
    constructor(config = {}) {
        const {
            eventSystem,
            theme = 'dark',
            width = 1200,
            height = 600
        } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;
        this.width = width;
        this.height = height;

        // SVG 요소
        this.svg = null;
        this.g = null; // 메인 그룹

        // 데이터
        this.data = null;
        this.root = null;

        // D3 레이아웃
        this.treemap = null;

        // 색상 스케일
        this.colorScale = null;

        console.log('✅ TreemapRenderer 생성됨');
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'treemap-renderer';
        container.id = 'treemap-renderer';

        // D3.js 초기화는 DOM에 추가된 후
        setTimeout(() => this.initD3(), 0);

        return container;
    }

    /**
     * D3.js 초기화
     */
    initD3() {
        if (typeof d3 === 'undefined') {
            console.warn('⚠️ D3.js가 로드되지 않았습니다');
            return;
        }

        const container = document.getElementById('treemap-renderer');
        if (!container) return;

        // SVG 생성
        this.svg = d3.select(container)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('class', 'treemap-svg');

        // 메인 그룹
        this.g = this.svg.append('g')
            .attr('class', 'treemap-group');

        // Treemap 레이아웃 설정
        this.treemap = d3.treemap()
            .size([this.width, this.height])
            .padding(2)
            .round(true);

        // 색상 스케일 (모멘텀 기반)
        this.colorScale = d3.scaleLinear()
            .domain([-50, 0, 50]) // -50% ~ +50%
            .range([
                this.getThemeColor('negative'),
                this.getThemeColor('neutral'),
                this.getThemeColor('positive')
            ])
            .clamp(true);

        console.log('✅ D3.js Treemap 초기화 완료');
    }

    /**
     * 데이터 업데이트
     * @param {Object} hierarchyData - D3 hierarchy 형식 데이터
     */
    updateData(hierarchyData) {
        if (!hierarchyData || !this.svg) return;

        this.data = hierarchyData;

        // D3 hierarchy 생성
        this.root = d3.hierarchy(hierarchyData)
            .sum(d => d.value || 0)
            .sort((a, b) => b.value - a.value);

        // Treemap 계산
        this.treemap(this.root);

        // 렌더링
        this.renderTreemap();

        console.log(`✅ Treemap 데이터 업데이트`);
    }

    /**
     * 트리맵 렌더링
     */
    renderTreemap() {
        if (!this.root) return;

        // 리프 노드만 (실제 항목들)
        const leaves = this.root.leaves();

        // 데이터 바인딩
        const cells = this.g.selectAll('.treemap-cell')
            .data(leaves, d => d.data.name);

        // EXIT: 제거
        cells.exit()
            .transition()
            .duration(500)
            .style('opacity', 0)
            .remove();

        // ENTER: 새로운 셀 추가
        const cellsEnter = cells.enter()
            .append('g')
            .attr('class', 'treemap-cell')
            .style('opacity', 0);

        // 사각형
        cellsEnter.append('rect')
            .attr('class', 'cell-rect')
            .attr('stroke', this.getThemeColor('border'))
            .attr('stroke-width', 1)
            .style('cursor', 'pointer');

        // 텍스트 (이름)
        cellsEnter.append('text')
            .attr('class', 'cell-text-name')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .style('pointer-events', 'none')
            .style('fill', '#fff')
            .style('font-size', '12px')
            .style('font-weight', '600');

        // 텍스트 (모멘텀)
        cellsEnter.append('text')
            .attr('class', 'cell-text-momentum')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .style('pointer-events', 'none')
            .style('fill', '#fff')
            .style('font-size', '14px')
            .style('font-weight', '700');

        // UPDATE + ENTER
        const cellsMerge = cellsEnter.merge(cells);

        // 위치 및 크기 애니메이션
        cellsMerge
            .transition()
            .duration(500)
            .style('opacity', 1)
            .attr('transform', d => `translate(${d.x0},${d.y0})`);

        // 사각형 업데이트
        cellsMerge.select('.cell-rect')
            .transition()
            .duration(500)
            .attr('width', d => d.x1 - d.x0)
            .attr('height', d => d.y1 - d.y0)
            .attr('fill', d => this.getMomentumColor(d.data.momentum));

        // 텍스트 (이름) 업데이트
        cellsMerge.select('.cell-text-name')
            .attr('x', d => (d.x1 - d.x0) / 2)
            .attr('y', d => (d.y1 - d.y0) / 2 - 8)
            .text(d => {
                const width = d.x1 - d.x0;
                const name = d.data.name;
                // 너비에 따라 텍스트 줄임
                if (width < 60) return '';
                if (width < 100) return name.substring(0, 5);
                return name;
            })
            .style('font-size', d => {
                const width = d.x1 - d.x0;
                if (width < 80) return '10px';
                if (width < 120) return '11px';
                return '12px';
            });

        // 텍스트 (모멘텀) 업데이트
        cellsMerge.select('.cell-text-momentum')
            .attr('x', d => (d.x1 - d.x0) / 2)
            .attr('y', d => (d.y1 - d.y0) / 2 + 10)
            .text(d => {
                const width = d.x1 - d.x0;
                if (width < 60) return '';
                const momentum = d.data.momentum || 0;
                return momentum >= 0 ? `+${momentum.toFixed(1)}%` : `${momentum.toFixed(1)}%`;
            })
            .style('font-size', d => {
                const width = d.x1 - d.x0;
                if (width < 80) return '11px';
                if (width < 120) return '13px';
                return '14px';
            });

        // 이벤트 리스너
        this.attachEventListeners(cellsMerge);
    }

    /**
     * 이벤트 리스너 설정
     */
    attachEventListeners(cells) {
        // 호버
        cells.on('mouseenter', (event, d) => {
            // 셀 강조
            d3.select(event.currentTarget).select('.cell-rect')
                .transition()
                .duration(150)
                .attr('stroke-width', 3)
                .attr('stroke', this.getThemeColor('highlight'));

            // 툴팁 표시 이벤트
            if (this.eventSystem) {
                this.eventSystem.emit('momentum:item:selected', {
                    item: d.data,
                    x: event.pageX,
                    y: event.pageY
                });
            }
        });

        cells.on('mouseleave', (event, d) => {
            // 강조 제거
            d3.select(event.currentTarget).select('.cell-rect')
                .transition()
                .duration(150)
                .attr('stroke-width', 1)
                .attr('stroke', this.getThemeColor('border'));
        });

        // 클릭 - 드릴다운
        cells.on('click', (event, d) => {
            if (this.eventSystem) {
                this.eventSystem.emit('momentum:drilldown', {
                    item: d.data
                });
            }
        });
    }

    /**
     * 모멘텀 색상 계산
     */
    getMomentumColor(momentum) {
        if (!momentum && momentum !== 0) return this.getThemeColor('neutral');
        return this.colorScale(momentum);
    }

    /**
     * 테마 색상 가져오기
     */
    getThemeColor(type) {
        const colors = {
            light: {
                positive: '#10b981',
                neutral: '#6b7280',
                negative: '#ef4444',
                border: '#d1d5db',
                highlight: '#3b82f6',
                background: '#ffffff',
                text: '#1f2937'
            },
            dark: {
                positive: '#34d399',
                neutral: '#4b5563',
                negative: '#f87171',
                border: '#4b5563',
                highlight: '#60a5fa',
                background: '#1f2937',
                text: '#f3f4f6'
            }
        };

        return colors[this.theme]?.[type] || colors.dark[type];
    }

    /**
     * 크기 조정
     */
    resize(width, height) {
        this.width = width;
        this.height = height;

        if (this.svg) {
            this.svg
                .attr('width', width)
                .attr('height', height);
        }

        if (this.treemap) {
            this.treemap.size([width, height]);
        }

        // 데이터 다시 렌더링
        if (this.data) {
            this.updateData(this.data);
        }
    }

    /**
     * 테마 변경
     */
    setTheme(newTheme) {
        this.theme = newTheme;

        // 색상 스케일 업데이트
        if (this.colorScale) {
            this.colorScale.range([
                this.getThemeColor('negative'),
                this.getThemeColor('neutral'),
                this.getThemeColor('positive')
            ]);
        }

        // 다시 렌더링
        if (this.data) {
            this.updateData(this.data);
        }
    }

    /**
     * 컴포넌트 파괴
     */
    destroy() {
        if (this.svg) {
            this.svg.remove();
            this.svg = null;
        }
        console.log('✅ TreemapRenderer 파괴됨');
    }
}
