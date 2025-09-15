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

    // 🎨 완전히 새로운 토글 방식 - 모달 팝업 방식
    toggleDetails() {
        const expandBtn = this.container.querySelector('#weather-expand-btn');

        if (this.isExpanded) {
            this.hideDetails();
        } else {
            this.showDetails();
        }

        if (expandBtn) {
            expandBtn.classList.toggle('expanded', this.isExpanded);
            expandBtn.setAttribute('aria-label', this.isExpanded ? '날씨 상세 정보 닫기' : '날씨 상세 정보 보기');
        }
    }

    showDetails() {
        // 기존 모달 제거
        this.hideDetails();

        // 모달 생성
        const modal = document.createElement('div');
        modal.id = 'weather-details-modal';
        modal.className = 'weather-details';

        const modalContent = document.createElement('div');
        modalContent.className = 'weather-details-content';

        // 닫기 버튼
        const closeBtn = document.createElement('button');
        closeBtn.className = 'weather-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = () => this.hideDetails();
        modalContent.appendChild(closeBtn);

        // 상세 날씨 내용
        const detailsHTML = this.renderDetailsContent();
        modalContent.insertAdjacentHTML('beforeend', detailsHTML);

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // 모달 배경 클릭시 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideDetails();
            }
        });

        // ESC 키로 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.hideDetails();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // 애니메이션을 위한 디레이
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });

        this.isExpanded = true;
    }

    hideDetails() {
        const modal = document.getElementById('weather-details-modal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
        this.isExpanded = false;
    }

    renderDetailsContent() {
        if (!this.weatherData) return '<p>날씨 데이터를 불러올 수 없습니다.</p>';

        return `
            <h2 style="text-align: center; margin-bottom: 20px;">🌤️ 상세 날씨 정보</h2>

            <div class="weather-details-grid">
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🌡️</span>
                    <span class="weather-detail-label">현재 온도</span>
                    <span class="weather-detail-value">${this.weatherData.temp}°C</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🎆</span>
                    <span class="weather-detail-label">체감 온도</span>
                    <span class="weather-detail-value">${this.weatherData.feelsLike}°C</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">💧</span>
                    <span class="weather-detail-label">습도</span>
                    <span class="weather-detail-value">${this.weatherData.humidity}%</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🌬️</span>
                    <span class="weather-detail-label">풍속</span>
                    <span class="weather-detail-value">${this.weatherData.windSpeed} m/s</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">☁️</span>
                    <span class="weather-detail-label">구름량</span>
                    <span class="weather-detail-value">${this.weatherData.clouds}%</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🕶️</span>
                    <span class="weather-detail-label">가시거리</span>
                    <span class="weather-detail-value">${(this.weatherData.visibility / 1000).toFixed(1)} km</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🌅</span>
                    <span class="weather-detail-label">일출</span>
                    <span class="weather-detail-value">${this.weatherData.sunrise}</span>
                </div>
                <div class="weather-detail-item">
                    <span class="weather-detail-icon">🌆</span>
                    <span class="weather-detail-label">일몰</span>
                    <span class="weather-detail-value">${this.weatherData.sunset}</span>
                </div>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                <h3 style="margin-bottom: 15px;">📅 5일 날씨 예보</h3>
                <div class="forecast-preview-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
                    ${this.forecastData ? this.forecastData.slice(0, 5).map(day => `
                        <div style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 8px;">
                            <div style="font-size: 24px;">${day.icon}</div>
                            <div style="font-size: 12px; margin: 5px 0;">${day.dateKr.split(' ')[0]}</div>
                            <div style="font-weight: bold;">${day.temp.max}°/${day.temp.min}°</div>
                        </div>
                    `).join('') : '<p>예보 데이터 없음</p>'}
                </div>
            </div>
        `;
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