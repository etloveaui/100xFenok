/**
 * ViewSwitcher - 뷰 전환 컴포넌트
 *
 * 업종/국가/규모별 뷰 전환
 *
 * @class ViewSwitcher
 */

export default class ViewSwitcher {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark', currentView = 'sector' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;
        this.currentView = currentView;

        this.views = [
            { id: 'sector', label: '업종별', icon: '🏭' },
            { id: 'country', label: '국가별', icon: '🌍' },
            { id: 'size', label: '규모별', icon: '📊' }
        ];

        console.log('✅ ViewSwitcher 생성됨');
    }

    render() {
        const container = document.createElement('div');
        container.className = 'view-switcher';

        this.views.forEach(view => {
            const button = document.createElement('button');
            button.className = `view-btn ${this.currentView === view.id ? 'active' : ''}`;
            button.dataset.view = view.id;
            button.innerHTML = `
                <span class="view-icon">${view.icon}</span>
                <span class="view-label">${view.label}</span>
            `;

            button.addEventListener('click', () => this.handleViewClick(view.id));

            container.appendChild(button);
        });

        return container;
    }

    handleViewClick(viewId) {
        this.currentView = viewId;

        // 버튼 상태 업데이트
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewId);
        });

        // 이벤트 발행
        if (this.eventSystem) {
            this.eventSystem.emit('momentum:view:changed', { view: viewId });
        }
    }

    setTheme(newTheme) {
        this.theme = newTheme;
    }
}
