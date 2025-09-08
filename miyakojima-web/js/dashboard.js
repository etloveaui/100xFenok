// 미야코지마 웹 플랫폼 - 동적 대시보드 시스템
// Dynamic Dashboard System for Miyakojima Web Platform

class DynamicDashboard {
    constructor() {
        this.updateInterval = null;
        this.currentData = {
            budget: { spent: 0, remaining: 50000, dailyLimit: 20000 },
            location: { lat: 24.7045, lng: 125.2772, name: '미야코 공항' },
            weather: { temp: 26, condition: 'sunny', humidity: 70 },
            recommendations: [],
            nextDestination: null
        };
        this.isRealTime = false;
    }

    async initialize() {
        Logger.info('동적 대시보드 초기화 시작');
        
        // 초기 데이터 로드
        await this.loadInitialData();
        
        // 실시간 업데이트 시작
        this.startRealTimeUpdates();
        
        // 이벤트 리스너 설정
        this.setupEventListeners();
        
        Logger.info('동적 대시보드 초기화 완료');
    }

    async loadInitialData() {
        // 저장된 예산 데이터 로드
        const budgetData = localStorage.getItem('miyakojima_budget');
        if (budgetData) {
            this.currentData.budget = JSON.parse(budgetData);
        }

        // 위치 데이터 업데이트
        await this.updateLocation();
        
        // 날씨 데이터 업데이트
        await this.updateWeather();
        
        // 추천 장소 생성
        this.generateRecommendations();
        
        // 다음 목적지 설정
        this.updateNextDestination();
        
        // UI 업데이트
        this.renderDashboard();
    }

    startRealTimeUpdates() {
        this.isRealTime = true;
        
        // 5초마다 업데이트
        this.updateInterval = setInterval(async () => {
            if (this.isRealTime) {
                await this.updateRealTimeData();
            }
        }, 5000);

        // 1분마다 전체 데이터 새로고침
        setInterval(async () => {
            if (this.isRealTime) {
                await this.fullDataRefresh();
            }
        }, 60000);
    }

    async updateRealTimeData() {
        // 예산 상태 업데이트
        this.updateBudgetProgress();
        
        // 날씨 정보 업데이트 (시뮬레이션)
        this.simulateWeatherChange();
        
        // 추천 장소 업데이트
        this.rotateRecommendations();
        
        // UI 리프레시
        this.renderDashboard();
    }

    async fullDataRefresh() {
        Logger.info('전체 데이터 새로고침');
        
        // 위치 재확인
        await this.updateLocation();
        
        // 날씨 데이터 재로드
        await this.updateWeather();
        
        // 새로운 추천 생성
        this.generateRecommendations();
        
        // UI 전체 업데이트
        this.renderDashboard();
        
        // 성공 알림
        if (window.app) {
            window.app.showToast('📊 대시보드 데이터가 업데이트되었습니다', 'success');
        }
    }

    async updateLocation() {
        if (navigator.geolocation) {
            return new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        this.currentData.location = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                            name: '현재 위치'
                        };
                        resolve();
                    },
                    () => {
                        // GPS 실패 시 기본 위치 사용
                        resolve();
                    }
                );
            });
        }
    }

    async updateWeather() {
        // 실제 날씨 API 대신 시뮬레이션
        const weatherConditions = [
            { temp: 26, condition: 'sunny', icon: '☀️', humidity: 65 },
            { temp: 24, condition: 'cloudy', icon: '⛅', humidity: 75 },
            { temp: 22, condition: 'rainy', icon: '🌧️', humidity: 85 },
            { temp: 28, condition: 'hot', icon: '🌞', humidity: 60 }
        ];
        
        const randomWeather = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
        this.currentData.weather = randomWeather;
    }

    simulateWeatherChange() {
        // 온도 ±1도 변화 시뮬레이션
        const tempChange = (Math.random() - 0.5) * 2;
        this.currentData.weather.temp = Math.round(this.currentData.weather.temp + tempChange);
        
        // 습도 ±5% 변화
        const humidityChange = (Math.random() - 0.5) * 10;
        this.currentData.weather.humidity = Math.max(30, Math.min(90, 
            this.currentData.weather.humidity + humidityChange));
    }

    generateRecommendations() {
        const allRecommendations = [
            {
                icon: '🌅',
                title: '일출 감상',
                description: '이라부 대교에서 6:30 일출',
                distance: '2.3km',
                category: 'nature',
                rating: 4.8
            },
            {
                icon: '🏖️',
                title: '요나하 마에하마 비치',
                description: '세계적으로 유명한 해변',
                distance: '5.1km',
                category: 'beach',
                rating: 4.9
            },
            {
                icon: '🐠',
                title: '스노클링 투어',
                description: '청어꽝 동굴 스노클링',
                distance: '8.7km',
                category: 'activity',
                rating: 4.7
            },
            {
                icon: '🍜',
                title: '미야코 소바',
                description: '현지 전통 소바 맛집',
                distance: '1.2km',
                category: 'food',
                rating: 4.6
            },
            {
                icon: '🏛️',
                title: '미야코 신사',
                description: '역사적인 전통 신사',
                distance: '3.4km',
                category: 'culture',
                rating: 4.5
            },
            {
                icon: '🌺',
                title: '열대식물원',
                description: '미야코 식물원 관람',
                distance: '6.8km',
                category: 'nature',
                rating: 4.3
            }
        ];

        // 시간대별 추천 로직
        const hour = new Date().getHours();
        let filteredRecommendations = allRecommendations;

        if (hour >= 5 && hour <= 7) {
            // 새벽: 일출 관련
            filteredRecommendations = allRecommendations.filter(r => r.category === 'nature');
        } else if (hour >= 8 && hour <= 11) {
            // 오전: 액티비티
            filteredRecommendations = allRecommendations.filter(r => 
                ['activity', 'culture'].includes(r.category));
        } else if (hour >= 12 && hour <= 14) {
            // 점심: 음식
            filteredRecommendations = allRecommendations.filter(r => r.category === 'food');
        } else if (hour >= 15 && hour <= 18) {
            // 오후: 해변, 자연
            filteredRecommendations = allRecommendations.filter(r => 
                ['beach', 'nature'].includes(r.category));
        } else {
            // 저녁: 문화, 음식
            filteredRecommendations = allRecommendations.filter(r => 
                ['culture', 'food'].includes(r.category));
        }

        // 상위 3개 추천
        this.currentData.recommendations = filteredRecommendations
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 3);
    }

    rotateRecommendations() {
        // 추천 목록을 회전시켜 다양성 제공
        if (this.currentData.recommendations.length > 0) {
            const first = this.currentData.recommendations.shift();
            this.currentData.recommendations.push(first);
        }
    }

    updateNextDestination() {
        const destinations = [
            {
                name: '요나하 마에하마 비치',
                description: '동양 최고의 해변, 일몰 명소',
                eta: '15분',
                category: 'beach'
            },
            {
                name: '이라부 대교',
                description: '미야코지마 대표 랜드마크',
                eta: '12분',
                category: 'landmark'
            },
            {
                name: '시기라 베이',
                description: '스노클링과 해양 스포츠',
                eta: '20분',
                category: 'activity'
            }
        ];

        const hour = new Date().getHours();
        if (hour >= 16 && hour <= 19) {
            // 일몰 시간대에는 해변 우선
            this.currentData.nextDestination = destinations.find(d => d.category === 'beach');
        } else {
            this.currentData.nextDestination = destinations[Math.floor(Math.random() * destinations.length)];
        }
    }

    updateBudgetProgress() {
        // 실시간 예산 시뮬레이션 (실제로는 사용자 입력 기반)
        const dailyProgress = (Date.now() % 86400000) / 86400000; // 하루 진행률
        const expectedSpending = this.currentData.budget.dailyLimit * dailyProgress;
        
        // 약간의 변동성 추가
        const variance = (Math.random() - 0.5) * 0.1;
        this.currentData.budget.spent = Math.round(expectedSpending * (1 + variance));
        this.currentData.budget.remaining = this.currentData.budget.dailyLimit - this.currentData.budget.spent;
    }

    renderDashboard() {
        this.renderBudgetOverview();
        this.renderLocationInfo();
        this.renderWeatherWidget();
        this.renderRecommendations();
        this.renderNextDestination();
    }

    renderBudgetOverview() {
        const spentEl = document.getElementById('today-spent');
        const remainingEl = document.getElementById('today-remaining');
        const progressEl = document.getElementById('budget-progress');
        const statusEl = document.getElementById('budget-status');

        if (spentEl) spentEl.textContent = `${this.currentData.budget.spent.toLocaleString()} 엔`;
        if (remainingEl) remainingEl.textContent = `${this.currentData.budget.remaining.toLocaleString()} 엔`;
        
        if (progressEl) {
            const percentage = (this.currentData.budget.spent / this.currentData.budget.dailyLimit) * 100;
            progressEl.style.width = `${Math.min(percentage, 100)}%`;
            
            // 색상 변경
            if (percentage > 80) {
                progressEl.style.backgroundColor = '#f44336';
            } else if (percentage > 60) {
                progressEl.style.backgroundColor = '#ff9800';
            } else {
                progressEl.style.backgroundColor = '#4caf50';
            }
        }

        if (statusEl) {
            const percentage = (this.currentData.budget.spent / this.currentData.budget.dailyLimit) * 100;
            if (percentage > 90) {
                statusEl.textContent = '주의';
                statusEl.className = 'budget-status danger';
            } else if (percentage > 70) {
                statusEl.textContent = '보통';
                statusEl.className = 'budget-status warning';
            } else {
                statusEl.textContent = '양호';
                statusEl.className = 'budget-status good';
            }
        }
    }

    renderLocationInfo() {
        const locationEl = document.getElementById('current-location');
        const detailEl = document.getElementById('location-detail');

        if (locationEl) {
            locationEl.textContent = this.currentData.location.name;
        }
        
        if (detailEl) {
            detailEl.textContent = `위도: ${this.currentData.location.lat.toFixed(4)}, 경도: ${this.currentData.location.lng.toFixed(4)}`;
        }
    }

    renderWeatherWidget() {
        const weatherEl = document.getElementById('weather-widget');
        if (weatherEl) {
            weatherEl.innerHTML = `
                <span class="weather-icon">${this.currentData.weather.icon || '☀️'}</span>
                <span class="weather-temp">${this.currentData.weather.temp}°C</span>
                <span class="weather-humidity">${Math.round(this.currentData.weather.humidity)}%</span>
            `;
        }
    }

    renderRecommendations() {
        const listEl = document.getElementById('recommendations-list');
        if (!listEl) return;

        listEl.innerHTML = this.currentData.recommendations.map(rec => `
            <div class="recommendation-item">
                <div class="rec-icon">${rec.icon}</div>
                <div class="rec-content">
                    <h5>${rec.title}</h5>
                    <p>${rec.description}</p>
                    <div class="rec-meta">
                        <span class="rec-rating">⭐ ${rec.rating}</span>
                        <span class="rec-distance">${rec.distance}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderNextDestination() {
        const nameEl = document.getElementById('next-destination-name');
        const descEl = document.getElementById('next-destination-desc');
        const etaEl = document.getElementById('next-eta');

        if (nameEl && this.currentData.nextDestination) {
            nameEl.textContent = this.currentData.nextDestination.name;
        }
        
        if (descEl && this.currentData.nextDestination) {
            descEl.textContent = this.currentData.nextDestination.description;
        }
        
        if (etaEl && this.currentData.nextDestination) {
            etaEl.textContent = this.currentData.nextDestination.eta;
        }
    }

    setupEventListeners() {
        // 새로고침 버튼들
        const refreshLocation = document.getElementById('refresh-location');
        const refreshRecommendations = document.getElementById('refresh-recommendations');

        if (refreshLocation) {
            refreshLocation.addEventListener('click', async () => {
                refreshLocation.classList.add('loading');
                await this.updateLocation();
                this.renderLocationInfo();
                refreshLocation.classList.remove('loading');
                
                if (window.app) {
                    window.app.showToast('📍 위치 정보가 업데이트되었습니다', 'success');
                }
            });
        }

        if (refreshRecommendations) {
            refreshRecommendations.addEventListener('click', () => {
                refreshRecommendations.classList.add('loading');
                this.generateRecommendations();
                this.renderRecommendations();
                refreshRecommendations.classList.remove('loading');
                
                if (window.app) {
                    window.app.showToast('✨ 새로운 추천을 생성했습니다', 'success');
                }
            });
        }
    }

    // 예산 업데이트 메서드
    updateBudget(spent, category = 'other') {
        this.currentData.budget.spent += spent;
        this.currentData.budget.remaining -= spent;
        
        // 로컬 스토리지에 저장
        localStorage.setItem('miyakojima_budget', JSON.stringify(this.currentData.budget));
        
        // 즉시 UI 업데이트
        this.renderBudgetOverview();
        
        Logger.info(`예산 업데이트: +${spent}엔 (${category})`);
    }

    // 실시간 모드 토글
    toggleRealTime() {
        this.isRealTime = !this.isRealTime;
        const status = this.isRealTime ? '활성화' : '비활성화';
        
        if (window.app) {
            window.app.showToast(`🔄 실시간 업데이트가 ${status}되었습니다`, 'info');
        }
        
        Logger.info(`실시간 모드: ${status}`);
    }

    // 정리
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.isRealTime = false;
    }
}

// 전역 인스턴스 생성
window.dynamicDashboard = new DynamicDashboard();

// 모듈 상태 관리
window.DashboardStatus = {
    isReady: false,
    init: async () => {
        try {
            await window.dynamicDashboard.initialize();
            window.DashboardStatus.isReady = true;
            
            window.dispatchEvent(new CustomEvent('moduleReady', { 
                detail: { moduleName: 'dashboard' }
            }));
            
            Logger.info('동적 대시보드 모듈 초기화 완료');
        } catch (error) {
            Logger.error('동적 대시보드 초기화 실패:', error);
            throw error;
        }
    }
};