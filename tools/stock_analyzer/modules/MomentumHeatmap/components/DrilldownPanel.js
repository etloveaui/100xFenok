/**
 * DrilldownPanel - 드릴다운 패널 컴포넌트
 *
 * 클릭한 항목의 상세 정보 표시
 *
 * @class DrilldownPanel
 */

export default class DrilldownPanel {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;
        this.isVisible = false;
        this.currentItem = null;

        console.log('✅ DrilldownPanel 생성됨');
    }

    render() {
        const container = document.createElement('div');
        container.className = 'drilldown-panel';
        container.id = 'drilldown-panel';
        container.style.display = 'none';

        return container;
    }

    show(item) {
        this.currentItem = item;
        this.isVisible = true;

        const panel = document.getElementById('drilldown-panel');
        if (!panel) return;

        panel.innerHTML = this.renderContent(item);
        panel.style.display = 'block';

        // 닫기 버튼 이벤트
        const closeBtn = panel.querySelector('.drilldown-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }
    }

    renderContent(item) {
        const momentum = item.momentum || 0;
        const momentumClass = momentum >= 0 ? 'positive' : 'negative';
        const momentumIcon = momentum >= 0 ? '📈' : '📉';

        return `
            <div class="drilldown-header">
                <h3>${item.name}</h3>
                <button class="drilldown-close">✕</button>
            </div>
            <div class="drilldown-body">
                <div class="drilldown-row">
                    <span class="row-label">티커:</span>
                    <span class="row-value">${item.ticker || 'N/A'}</span>
                </div>
                ${item.sector ? `
                <div class="drilldown-row">
                    <span class="row-label">업종:</span>
                    <span class="row-value">${item.sector}</span>
                </div>
                ` : ''}
                ${item.country ? `
                <div class="drilldown-row">
                    <span class="row-label">국가:</span>
                    <span class="row-value">${item.country}</span>
                </div>
                ` : ''}
                ${item.price ? `
                <div class="drilldown-row">
                    <span class="row-label">가격:</span>
                    <span class="row-value">$${item.price.toFixed(2)}</span>
                </div>
                ` : ''}
                <div class="drilldown-row">
                    <span class="row-label">모멘텀:</span>
                    <span class="row-value ${momentumClass}">
                        ${momentumIcon} ${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%
                    </span>
                </div>
                ${item.value ? `
                <div class="drilldown-row">
                    <span class="row-label">시가총액:</span>
                    <span class="row-value">$${(item.value / 1e9).toFixed(2)}B</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    hide() {
        this.isVisible = false;
        this.currentItem = null;

        const panel = document.getElementById('drilldown-panel');
        if (panel) {
            panel.style.display = 'none';
        }

        // 드릴업 이벤트
        if (this.eventSystem) {
            this.eventSystem.emit('momentum:drillup', {});
        }
    }

    setTheme(newTheme) {
        this.theme = newTheme;
    }

    destroy() {
        this.hide();
        console.log('✅ DrilldownPanel 파괴됨');
    }
}
