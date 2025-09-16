// js/main.js
async function safeInitialize() {
    const updateProgress = (percent, message) => {
        const progressFill = document.getElementById('progress-fill');
        const loadingText = document.querySelector('.loading-content p');

        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
        if (loadingText) {
            loadingText.textContent = message;
        }
    };

    const hideLoadingScreen = () => {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 300);
        }
    };

    const showError = (message) => {
        console.error('앱 초기화 오류:', message);
        const loadingContent = document.querySelector('.loading-content');
        if (loadingContent) {
            loadingContent.innerHTML = `
                <div class="error-content">
                    <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                    <h3>초기화 오류</h3>
                    <p>${message}</p>
                    <button onclick="location.reload()" style="
                        margin-top: 20px;
                        padding: 10px 20px;
                        background: #f44336;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                    ">페이지 새로고침</button>
                </div>
            `;
        }
    };

    try {
        console.log('🔄 미야코지마 앱 초기화 시작...');
        updateProgress(10, '모듈 로딩 중...');

        // 1. CONFIG 초기화
        console.log('📦 CONFIG 모듈 로딩...');
        const { CONFIG } = await import('./config.js');
        await CONFIG.initialize();
        console.log('✅ CONFIG 초기화 완료');
        updateProgress(25, 'CONFIG 로딩 완료...');

        // 2. DataService 초기화 (일관된 import 방식 사용)
        console.log('📦 DataService 모듈 로딩...');
        const { DataService } = await import('./services/data.js');
        console.log('✅ DataService 모듈 로드 완료');
        updateProgress(40, 'DataService 초기화 중...');

        await DataService.initialize();
        console.log('✅ DataService 초기화 완료');
        updateProgress(60, 'App 모듈 로딩 중...');

        // 3. App 초기화
        console.log('📦 App 모듈 로딩...');
        const { App } = await import('./app-new.js');
        console.log('✅ App 모듈 로드 완료');
        updateProgress(80, 'App 초기화 중...');

        const app = new App();
        window.app = app;
        await app.start();
        console.log('✅ App 시작 완료');

        updateProgress(100, '초기화 완료!');

        // 잠시 기다린 후 로딩 스크린 숨기기
        setTimeout(() => {
            hideLoadingScreen();
        }, 500);

        console.log('🎉 미야코지마 앱 초기화 완료!');
    } catch (error) {
        console.error('❌ 초기화 실패:', error);
        console.error('스택 트레이스:', error.stack);
        showError(`앱을 시작할 수 없습니다: ${error.message}`);
    }
}

// D-Day 카운터 업데이트 함수
function updateDDayCounter() {
    const ddayElement = document.getElementById('dday-counter');
    if (!ddayElement) return;

    const parseTripDate = (dateStr, fallback) => {
        if (typeof dateStr === 'string') {
            const parts = dateStr.split('-').map(Number);
            if (parts.length === 3 && parts.every(num => !Number.isNaN(num))) {
                return new Date(parts[0], parts[1] - 1, parts[2]);
            }
        }
        return fallback;
    };

    const defaultStart = new Date(2025, 8, 27);
    const defaultEnd = new Date(2025, 9, 1);
    const tripInfo = (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.TRIP_INFO) ? window.CONFIG.TRIP_INFO : null;
    const travelStartDate = parseTripDate(tripInfo?.START_DATE, defaultStart);
    const travelEndDate = parseTripDate(tripInfo?.END_DATE, defaultEnd);

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const msPerDay = 1000 * 60 * 60 * 24;

    const diffTime = travelStartDate.getTime() - todayMidnight.getTime();
    const diffDays = Math.ceil(diffTime / msPerDay);

    let displayText = '';
    const badgeClass = 'dday-badge';

    if (diffDays > 0) {
        // 여행 전
        displayText = `D-${diffDays}`;
        ddayElement.className = `${badgeClass} dday-before`;
    } else if (diffDays === 0) {
        // 여행 당일
        displayText = 'D-DAY';
        ddayElement.className = `${badgeClass} dday-today`;
    } else {
        // 여행 중 또는 여행 후 체크
        const endDiffTime = travelEndDate.getTime() - todayMidnight.getTime();
        const endDiffDays = Math.ceil(endDiffTime / msPerDay);

        if (endDiffDays >= 0) {
            // 여행 중
            displayText = '여행 중';
            ddayElement.className = `${badgeClass} dday-during`;
        } else {
            // 여행 후
            displayText = '추억 속';
            ddayElement.className = `${badgeClass} dday-after`;
        }
    }

    ddayElement.textContent = displayText;
    console.log(`📅 D-Day 업데이트: ${displayText}`);
}

// DOM 로드 완료 후 안전하게 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        safeInitialize();
        updateDDayCounter(); // D-Day 카운터 초기화
    });
} else {
    // 이미 로드된 경우 즉시 실행
    safeInitialize();
    updateDDayCounter(); // D-Day 카운터 초기화
}