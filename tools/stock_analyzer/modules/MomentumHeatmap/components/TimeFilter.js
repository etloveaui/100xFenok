/**
 * TimeFilter - 기간별 필터 컴포넌트
 *
 * 1주/1개월/3개월/6개월/1년 필터
 *
 * @class TimeFilter
 */

export default class TimeFilter {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark', currentPeriod = '1M' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;
        this.currentPeriod = currentPeriod;

        this.periods = [
            { id: '1W', label: '1주' },
            { id: '1M', label: '1개월' },
            { id: '3M', label: '3개월' },
            { id: '6M', label: '6개월' },
            { id: '1Y', label: '1년' }
        ];

        console.log('✅ TimeFilter 생성됨');
    }

    render() {
        const container = document.createElement('div');
        container.className = 'time-filter';

        const label = document.createElement('span');
        label.className = 'filter-label';
        label.textContent = '기간: ';
        container.appendChild(label);

        this.periods.forEach(period => {
            const button = document.createElement('button');
            button.className = `period-btn ${this.currentPeriod === period.id ? 'active' : ''}`;
            button.dataset.period = period.id;
            button.textContent = period.label;

            button.addEventListener('click', () => this.handlePeriodClick(period.id));

            container.appendChild(button);
        });

        return container;
    }

    handlePeriodClick(periodId) {
        this.currentPeriod = periodId;

        // 버튼 상태 업데이트
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.period === periodId);
        });

        // 이벤트 발행
        if (this.eventSystem) {
            this.eventSystem.emit('momentum:period:changed', { period: periodId });
        }
    }

    setTheme(newTheme) {
        this.theme = newTheme;
    }
}
