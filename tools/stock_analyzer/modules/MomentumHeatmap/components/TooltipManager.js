/**
 * TooltipManager - 툴팁 관리자
 *
 * 호버 시 상세 정보 툴팁 표시
 *
 * @class TooltipManager
 */

export default class TooltipManager {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;
        this.isVisible = false;

        console.log('✅ TooltipManager 생성됨');
    }

    render() {
        const container = document.createElement('div');
        container.className = 'momentum-tooltip';
        container.id = 'momentum-tooltip';
        container.style.display = 'none';
        container.style.position = 'absolute';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '1000';

        return container;
    }

    show(item, x, y) {
        this.isVisible = true;

        const tooltip = document.getElementById('momentum-tooltip');
        if (!tooltip) return;

        tooltip.innerHTML = this.renderContent(item);
        tooltip.style.display = 'block';
        tooltip.style.left = `${x + 15}px`;
        tooltip.style.top = `${y + 15}px`;
    }

    renderContent(item) {
        const momentum = item.momentum || 0;
        const momentumClass = momentum >= 0 ? 'positive' : 'negative';
        const momentumIcon = momentum >= 0 ? '📈' : '📉';

        return `
            <div class="tooltip-header">
                <strong>${item.name}</strong>
            </div>
            <div class="tooltip-body">
                <div class="tooltip-row">
                    <span>티커:</span>
                    <span><strong>${item.ticker || 'N/A'}</strong></span>
                </div>
                ${item.price ? `
                <div class="tooltip-row">
                    <span>가격:</span>
                    <span><strong>$${item.price.toFixed(2)}</strong></span>
                </div>
                ` : ''}
                <div class="tooltip-row">
                    <span>모멘텀:</span>
                    <span class="${momentumClass}">
                        <strong>${momentumIcon} ${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%</strong>
                    </span>
                </div>
                ${item.value ? `
                <div class="tooltip-row">
                    <span>시총:</span>
                    <span><strong>$${(item.value / 1e9).toFixed(2)}B</strong></span>
                </div>
                ` : ''}
            </div>
        `;
    }

    hide() {
        this.isVisible = false;

        const tooltip = document.getElementById('momentum-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }

    setTheme(newTheme) {
        this.theme = newTheme;
    }

    destroy() {
        this.hide();
        console.log('✅ TooltipManager 파괴됨');
    }
}
