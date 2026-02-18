/**
 * DeepCompare - 다차원 비교 분석 메인 컨트롤러
 *
 * 구성요소:
 *  - ComparisonEngine: 수치 계산 및 정규화
 *  - Components: 레이아웃/검색/드래그앤드랍
 *  - Visualizations: 4D 버블 차트, 레이더 차트
 *
 * 주 책임:
 *  - 사용자 상호작용 처리 (선택, 제거, 드래그 앤 드롭)
 *  - 데이터 소스 관리 (window.allData)
 *  - 시각화 및 요약 인사이트 갱신
 */
class DeepCompare {
    constructor() {
        const Engine = window.DeepCompareComparisonEngine;
        if (!Engine) {
            throw new Error('DeepCompareComparisonEngine이 로드되지 않았습니다.');
        }

        this.engine = new Engine();
        this.mode = 'companies';
        this.maxSelection = 4;
        this.selected = [];
        this.availableItems = [];
        this.initialized = false;
        this.modalElement = null;
        this.dropZones = [];
        this.selectionContainer = null;
    }

    initialize() {
        if (this.initialized) return;

        this.modalElement = document.getElementById('company-compare-modal');
        this.dropZones = Array.from(document.querySelectorAll('.drop-zone'));
        this.selectionContainer = document.getElementById('compare-selection-area');

        this.refreshDataSource();
        this.setupLayout();
        this.setupSearch();
        this.setupDragAndDrop();
        this.setupInteractions();

        this.initialized = true;
        console.log('✅ DeepCompare 초기화 완료');
    }

    /**
     * 외부에서 데이터가 갱신되었음을 통지할 때 사용
     */
    refreshDataSource() {
        const rawData = Array.isArray(window.allData) ? window.allData : [];
        this.availableItems = this.engine.getCandidates(rawData, this.mode).map(candidate => {
            const raw = candidate.raw || {};
            const industry = raw.industry || raw.Industry || '정보 없음';
            const exchange = raw.exchange || raw.Exchange || '';
            return {
                ...candidate,
                subtitle: candidate.type === 'company'
                    ? `${industry}${exchange ? ` · ${exchange}` : ''}`
                    : `${candidate.constituents?.length || 0}개 구성`,
                display: this.buildDisplaySummary(candidate)
            };
        });

        if (window.DeepCompareSelectionSearch) {
            window.DeepCompareSelectionSearch.updateCache(
                this.availableItems.map(item => ({
                    id: item.id,
                    name: item.name,
                    subtitle: item.subtitle,
                    metrics: {
                        profitability: item.display.profitability,
                        growth: item.display.growth,
                        valuation: item.display.valuation
                    }
                }))
            );
        }

        this.refreshVisuals();
    }

    setupLayout() {
        if (window.DeepCompareLayout) {
            window.DeepCompareLayout.ensureBaseStructure();
        }
    }

    setupSearch() {
        if (!window.DeepCompareSelectionSearch) return;
        window.DeepCompareSelectionSearch.initialize({
            onSelect: candidate => {
                this.addEntityById(candidate.id);
                this.openModal();
            }
        });
    }

    setupDragAndDrop() {
        if (!window.DeepCompareDragAndDrop) return;
        window.DeepCompareDragAndDrop.setup({
            dropZones: this.dropZones,
            container: this.selectionContainer,
            onDrop: ({ id }) => {
                if (!id) return;
                this.addEntityById(id);
            },
            onRemove: id => this.removeEntity(id)
        });
    }

    setupInteractions() {
        const openBtn = document.getElementById('add-to-compare-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                if (window.activeCompanyForComparison) {
                    this.addEntityFromCompany(window.activeCompanyForComparison);
                }
                this.openModal();
            });
        }

        const clearBtn = document.querySelector('.clear-all-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.selected = [];
                this.refreshVisuals();
            });
        }

        const addSuggestionBtn = document.querySelector('.add-comparison-btn');
        if (addSuggestionBtn) {
            addSuggestionBtn.addEventListener('click', () => this.addRecommendedEntity());
        }

        const closeBtn = document.getElementById('close-compare-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }

        if (this.modalElement) {
            this.modalElement.addEventListener('click', event => {
                if (event.target === this.modalElement) {
                    this.closeModal();
                }
            });
        }

        // 모드 전환 버튼
        const modeButtons = document.querySelectorAll('.compare-mode-selector .mode-btn');
        modeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
                if (!mode || mode === this.mode) return;

                modeButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                this.mode = mode;
                this.selected = [];
                this.refreshDataSource();
            });
        });

        // 버블 차트 선택 이벤트
        document.addEventListener('deepCompare:itemSelected', event => {
            const detail = event.detail;
            if (!detail?.id) return;
            const target = this.availableItems.find(item => item.id === detail.id);
            if (target) {
                this.highlightTableRow(target.id);
            }
        });
    }

    openModal() {
        if (!this.modalElement) return;
        this.modalElement.classList.add('active');
        const searchInput = document.getElementById('compare-search');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 120);
        }
    }

    closeModal() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
    }

    addEntityById(id) {
        const candidate = this.availableItems.find(item => item.id === id);
        if (!candidate) {
            console.warn('[DeepCompare] 후보를 찾을 수 없습니다:', id);
            return;
        }
        this.addEntity(candidate);
    }

    addEntityFromCompany(company) {
        if (!company) return;
        const id = company.Ticker || company.ticker || company.corpName;
        if (!id) return;
        const existing = this.availableItems.find(item => item.id === id);
        if (existing) {
            this.addEntity(existing);
            return;
        }

        // 데이터 소스에 없을 경우 임시 엔티티 생성
        const candidate = {
            type: 'company',
            id,
            name: `${company.Ticker || ''} ${company.corpName || ''}`.trim(),
            raw: company,
            metrics: this.engine.buildMetricSnapshot(company)
        };
        candidate.subtitle = `${company.industry || '정보 없음'}${company.Exchange ? ` · ${company.Exchange}` : ''}`;
        candidate.display = this.buildDisplaySummary(candidate);
        this.addEntity(candidate);
    }

    addEntity(candidate) {
        if (this.selected.find(item => item.id === candidate.id)) {
            this.showToast('이미 비교 목록에 추가된 대상입니다.', 'warning');
            return;
        }

        if (this.selected.length >= this.maxSelection) {
            this.showToast(`최대 ${this.maxSelection}개까지 비교할 수 있습니다.`, 'warning');
            return;
        }

        const metrics = candidate.metrics || this.engine.buildMetricSnapshot(candidate.raw || {});
        this.selected.push({
            ...candidate,
            metrics,
            display: this.buildDisplaySummary({ ...candidate, metrics })
        });

        this.refreshVisuals();
        this.showToast(`${candidate.name}이(가) 비교 목록에 추가되었습니다.`, 'success');
    }

    addRecommendedEntity() {
        const remaining = this.availableItems.filter(item => !this.selected.find(selected => selected.id === item.id));
        if (!remaining.length) {
            this.showToast('추가할 수 있는 추천 대상이 없습니다.', 'warning');
            return;
        }

        const sorted = [...remaining].sort((a, b) => (b.metrics?.score || 0) - (a.metrics?.score || 0));
        const best = sorted[0];
        this.addEntity(best);
        this.openModal();
    }

    removeEntity(id) {
        const before = this.selected.length;
        this.selected = this.selected.filter(item => item.id !== id);
        if (this.selected.length !== before) {
            this.refreshVisuals();
            this.showToast('비교 목록에서 제거했습니다.', 'info');
        }
    }

    refreshVisuals() {
        const entities = this.selected.length ? this.selected : [];

        if (window.DeepCompareLayout) {
            window.DeepCompareLayout.renderSelectedCompanies(
                entities.map(item => ({
                    id: item.id,
                    name: item.name,
                    subtitle: item.subtitle,
                    metrics: item.display
                }))
            );
            window.DeepCompareLayout.renderComparisonTable(
                this.engine.buildComparisonTable(entities)
            );
            window.DeepCompareLayout.renderInsights(
                this.engine.buildInsights(entities)
            );
        }

        const layout = window.DeepCompareLayout?.ensureBaseStructure();
        if (layout) {
            window.DeepCompareBubbleChart?.render(
                layout.bubbleCanvas,
                this.engine.buildBubbleDataset(entities)
            );
            window.DeepCompareRadarChart?.render(
                layout.radarCanvas,
                this.engine.buildRadarDataset(entities)
            );
        }
    }

    buildDisplaySummary(candidate) {
        const metrics = candidate.metrics || this.engine.buildMetricSnapshot(candidate.raw || {});
        const toPercent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'N/A';
        const toValue = value => Number.isFinite(value) ? value.toFixed(2) : 'N/A';

        return {
            profitability: toPercent(metrics.profitability?.raw),
            growth: toPercent(metrics.growth?.raw),
            momentum: toPercent(metrics.momentum?.raw),
            valuation: Number.isFinite(metrics.valuation?.raw) ? metrics.valuation.raw.toFixed(1) : 'N/A',
            dividend: toPercent(metrics.dividend?.raw),
            score: metrics.score.toFixed(2)
        };
    }

    highlightTableRow(id) {
        const row = document.querySelector(`#deep-compare-table-wrapper tbody tr[data-id="${id}"]`);
        if (!row) return;
        row.classList.add('bg-blue-100');
        setTimeout(() => row.classList.remove('bg-blue-100'), 1500);
    }

    showToast(message, type = 'info') {
        if (window.loadingManager && typeof window.loadingManager.showFeedback === 'function') {
            window.loadingManager.showFeedback(message, type, 2500);
            return;
        }

        console.log(`[DeepCompare::${type}] ${message}`);
    }
}

window.deepCompare = new DeepCompare();

console.log('✅ DeepCompare 메인 모듈 로드 완료');
