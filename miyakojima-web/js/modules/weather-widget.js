// js/modules/weather-widget.js - 날씨 위젯 UI 컨트롤러
import { weatherService } from './weather.js';

class WeatherWidget {
    constructor() {
        this.container = document.getElementById('weather-card');
        this.isExpanded = false;
        this.weatherData = null;
        this.forecastData = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 날씨 위젯 이미 초기화됨');
            return;
        }

        try {
            console.log('🎨 날씨 위젯 초기화 시작...');

            if (!this.container) {
                console.warn('⚠️ 날씨 위젯 컨테이너를 찾을 수 없습니다');
                return;
            }

            // 날씨 서비스에서 데이터 가져오기
            const weatherData = await weatherService.initialize();
            this.weatherData = weatherData.current;
            this.forecastData = weatherData.forecast;

            // 이벤트 리스너 설정
            this.setupEventListeners();

            // 초기 UI 렌더링
            this.render();

            // 주기적 업데이트 시작 (5분마다)
            this.startPeriodicUpdate();

            this.initialized = true;
            console.log('✅ 날씨 위젯 초기화 완료');
        } catch (error) {
            console.error('❌ 날씨 위젯 초기화 실패:', error);
            this.renderError();
        }
    }

    setupEventListeners() {
        // 날씨 카드 클릭으로 상세 정보 토글
        const currentWeather = this.container.querySelector('#weather-current');
        const expandBtn = this.container.querySelector('#weather-expand-btn');

        if (currentWeather) {
            currentWeather.addEventListener('click', (e) => {
                if (e.target !== expandBtn && !expandBtn.contains(e.target)) {
                    this.toggleDetails();
                }
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDetails();
            });
        }

        // 전체 예보 보기 버튼
        const fullForecastBtn = this.container.querySelector('#forecast-full-btn');
        if (fullForecastBtn) {
            fullForecastBtn.addEventListener('click', () => {
                this.showFullForecast();
            });
        }

        // 키보드 접근성
        if (currentWeather) {
            currentWeather.setAttribute('tabindex', '0');
            currentWeather.setAttribute('role', 'button');
            currentWeather.setAttribute('aria-label', '날씨 상세 정보 보기');

            currentWeather.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleDetails();
                }
            });
        }
    }

    render() {
        if (!this.weatherData || !this.container) return;

        this.renderCurrentWeather();
        this.renderWeatherDetails();
        this.renderTravelAdvice();
        this.renderForecastPreview();
    }

    renderCurrentWeather() {
        const tempEl = this.container.querySelector('#current-temp');
        const feelsLikeEl = this.container.querySelector('#feels-like');
        const iconEl = this.container.querySelector('#weather-icon');
        const conditionEl = this.container.querySelector('#weather-condition');

        if (tempEl) tempEl.textContent = `${this.weatherData.temp}°C`;
        if (feelsLikeEl) feelsLikeEl.textContent = `체감 ${this.weatherData.feelsLike}°C`;
        if (iconEl) iconEl.textContent = this.weatherData.icon;
        if (conditionEl) conditionEl.textContent = this.weatherData.condition;
    }

    renderWeatherDetails() {
        const windSpeedEl = this.container.querySelector('#wind-speed');
        const humidityEl = this.container.querySelector('#humidity');
        const visibilityEl = this.container.querySelector('#visibility');
        const sunriseEl = this.container.querySelector('#sunrise');
        const sunsetEl = this.container.querySelector('#sunset');
        const pressureEl = this.container.querySelector('#pressure');

        if (windSpeedEl) windSpeedEl.textContent = `${this.weatherData.windSpeed} m/s`;
        if (humidityEl) humidityEl.textContent = `${this.weatherData.humidity}%`;
        if (visibilityEl) visibilityEl.textContent = `${this.weatherData.visibility}km`;
        if (sunriseEl) sunriseEl.textContent = this.weatherData.sunrise;
        if (sunsetEl) sunsetEl.textContent = this.weatherData.sunset;
        if (pressureEl) pressureEl.textContent = `${this.weatherData.pressure} hPa`;
    }

    renderTravelAdvice() {
        const adviceItemsEl = this.container.querySelector('#advice-items');
        if (!adviceItemsEl) return;

        const advice = weatherService.getTravelAdvice(this.weatherData, this.forecastData);

        adviceItemsEl.innerHTML = advice.map(item =>
            `<span class="advice-item ${item.priority}">${item.icon} ${item.text}</span>`
        ).join('');
    }

    renderForecastPreview() {
        const forecastItemsEl = this.container.querySelector('#forecast-items');
        if (!forecastItemsEl || !this.forecastData) return;

        // 5일 예보 중 첫 3일만 프리뷰로 표시
        const previewData = this.forecastData.slice(0, 3);

        forecastItemsEl.innerHTML = previewData.map(day => `
            <div class="forecast-item">
                <div class="forecast-date">${this.getShortDate(day.dateKr)}</div>
                <div class="forecast-icon">${day.icon}</div>
                <div class="forecast-temps">
                    <div class="forecast-high">${day.temp.max}°</div>
                    <div class="forecast-low">${day.temp.min}°</div>
                </div>
            </div>
        `).join('');
    }

    getShortDate(dateStr) {
        // "9월 27일 (금)" -> "금"
        const match = dateStr.match(/\((.)\)/);
        return match ? match[1] : dateStr.slice(-1);
    }

    // 🎨 완전히 새로운 토글 방식 - 오버레이 방식으로 변환
    toggleDetails() {
        const weatherCard = this.container.closest('.weather-card');
        const detailsEl = this.container.querySelector('#weather-details');
        const expandBtn = this.container.querySelector('#weather-expand-btn');

        if (!weatherCard || !detailsEl || !expandBtn) return;

        this.isExpanded = !this.isExpanded;

        // 🔧 inline display: none 스타일 제거 (CSS 오버레이가 작동하도록)
        detailsEl.style.removeProperty('display');

        if (this.isExpanded) {
            // 카드에 expanded 클래스 추가하여 오버레이 활성화
            weatherCard.classList.add('expanded');
            expandBtn.classList.add('expanded');
            expandBtn.setAttribute('aria-label', '날씨 상세 정보 닫기');

            // 닫기 버튼이 없으면 추가
            if (!detailsEl.querySelector('.weather-close-btn')) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'weather-close-btn';
                closeBtn.innerHTML = '✕';
                closeBtn.setAttribute('aria-label', '닫기');
                closeBtn.onclick = () => this.closeDetails();
                detailsEl.insertBefore(closeBtn, detailsEl.firstChild);
            }
        } else {
            this.closeDetails();
        }

        // 상태 변경 이벤트 발생
        this.container.dispatchEvent(new CustomEvent('weatherToggle', {
            detail: { expanded: this.isExpanded }
        }));
    }

    // 🚪 새로운 닫기 기능
    closeDetails() {
        const weatherCard = this.container.closest('.weather-card');
        const expandBtn = this.container.querySelector('#weather-expand-btn');

        if (!weatherCard || !expandBtn) return;

        this.isExpanded = false;
        weatherCard.classList.remove('expanded');
        expandBtn.classList.remove('expanded');
        expandBtn.setAttribute('aria-label', '날씨 상세 정보 보기');
    }

    showFullForecast() {
        // 전체 예보를 보여주는 모달 또는 새로운 섹션 표시
        const modal = this.createForecastModal();
        document.body.appendChild(modal);

        // 모달 표시
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });
    }

    createForecastModal() {
        const modal = document.createElement('div');
        modal.className = 'forecast-modal';
        modal.innerHTML = `
            <div class="forecast-modal-content">
                <div class="forecast-modal-header">
                    <h3>📅 5일 날씨 예보</h3>
                    <button class="forecast-modal-close" aria-label="예보 닫기">✕</button>
                </div>
                <div class="forecast-modal-body">
                    ${this.renderFullForecastHTML()}
                </div>
            </div>
            <div class="forecast-modal-backdrop"></div>
        `;

        // 모달 닫기 이벤트
        const closeBtn = modal.querySelector('.forecast-modal-close');
        const backdrop = modal.querySelector('.forecast-modal-backdrop');

        const closeModal = () => {
            modal.classList.remove('show');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            }, 300);
        };

        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);

        // ESC 키로 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        return modal;
    }

    renderFullForecastHTML() {
        if (!this.forecastData) return '<p>예보 데이터를 불러올 수 없습니다.</p>';

        return this.forecastData.map(day => `
            <div class="forecast-day-card">
                <div class="forecast-day-header">
                    <div class="forecast-day-info">
                        <h4>${day.dateKr}</h4>
                        <p>${day.condition}</p>
                    </div>
                    <div class="forecast-day-icon">${day.icon}</div>
                </div>
                <div class="forecast-day-details">
                    <div class="temp-range">
                        <span class="temp-high">${day.temp.max}°C</span>
                        <span class="temp-separator">~</span>
                        <span class="temp-low">${day.temp.min}°C</span>
                    </div>
                    <div class="forecast-day-stats">
                        <div class="stat-item">
                            <span class="stat-icon">💧</span>
                            <span class="stat-value">${day.humidity}%</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-icon">💨</span>
                            <span class="stat-value">${day.windSpeed} m/s</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-icon">🌧️</span>
                            <span class="stat-value">${day.precipitationChance}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderError() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="weather-error">
                <span class="weather-icon">⚠️</span>
                <span class="weather-temp">날씨 정보 로딩 실패</span>
                <button class="weather-retry" id="weather-retry">다시 시도</button>
            </div>
        `;

        const retryBtn = this.container.querySelector('#weather-retry');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                this.initialize();
            });
        }
    }

    async refresh() {
        console.log('🔄 날씨 위젯 새로고침...');

        try {
            const weatherData = await weatherService.refresh();
            this.weatherData = weatherData.current;
            this.forecastData = weatherData.forecast;
            this.render();
            console.log('✅ 날씨 위젯 새로고침 완료');
        } catch (error) {
            console.error('❌ 날씨 위젯 새로고침 실패:', error);
        }
    }

    startPeriodicUpdate() {
        // 5분마다 날씨 데이터 업데이트
        setInterval(() => {
            this.refresh();
        }, 5 * 60 * 1000);
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.initialized = false;
    }
}

// 전역 인스턴스 생성
const weatherWidget = new WeatherWidget();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.weatherWidget = weatherWidget;
}

export { WeatherWidget, weatherWidget };
export default weatherWidget;