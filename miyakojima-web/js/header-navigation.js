/**
 * 🏝️ Miyako Header Navigation Functions
 * 헤더 네비게이션 및 인터랙션 기능
 * Created: 2025-09-16
 */

/* ==========================================================================
   네비게이션 및 인터랙션 함수들
   ========================================================================== */

/**
 * 대시보드로 돌아가기
 * 로고 클릭 시 호출되는 함수
 */
function goToDashboard() {
  // 현재 탭이 대시보드가 아닐 때만 이동
  if (window.location.hash !== '#dashboard' && window.location.hash !== '') {
    console.log('🏠 대시보드로 이동 중...');

    // 부드러운 전환 효과
    document.body.style.opacity = '0.9';

    // 해시 변경으로 라우팅
    window.location.hash = '#dashboard';

    setTimeout(() => {
      document.body.style.opacity = '1';
      showToast('대시보드로 돌아왔습니다! 🏝️', 'success');
    }, 200);
  } else {
    // 이미 대시보드에 있을 때
    showToast('이미 대시보드에 있습니다! 🏠', 'info');
  }
}

/**
 * 날씨 상세 정보 보기 (향후 구현 준비)
 * 날씨 카드 클릭 시 호출되는 함수
 */
function openWeatherDetails() {
  console.log('🌤️ 날씨 상세 정보 요청됨');

  // 임시: 토스트 메시지로 안내
  showToast('날씨 상세 탭은 곧 추가될 예정입니다! 🌤️', 'info');

  // 향후 구현을 위한 주석
  // window.location.hash = '#weather';

  // 임시로 날씨 정보를 모달로 표시할 수도 있음
  // showWeatherModal();
}

/**
 * 토스트 메시지 표시 함수
 * @param {string} message - 표시할 메시지
 * @param {string} type - 메시지 타입 (success, error, warning, info)
 * @param {number} duration - 표시 시간 (ms, 기본값: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
  // 기존 토스트가 있다면 제거
  const existingToast = document.querySelector('.header-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `header-toast toast-${type}`;

  // 타입별 아이콘
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
    </div>
  `;

  // 토스트 스타일
  toast.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    z-index: 1000;
    transform: translateX(120%);
    transition: transform 0.3s ease-out;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    font-weight: 500;
    max-width: 300px;
    word-wrap: break-word;
  `;

  document.body.appendChild(toast);

  // 슬라이드 인 애니메이션
  setTimeout(() => toast.style.transform = 'translateX(0)', 100);

  // 슬라이드 아웃 및 제거
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, duration);
}

/* ==========================================================================
   날씨 데이터 연동 및 업데이트
   ========================================================================== */

/**
 * 간소화된 날씨 카드 업데이트
 * 기존 날씨 API 데이터를 간단한 형태로 표시
 */
function updateSimpleWeather() {
  const tempElement = document.getElementById('simple-temp');
  const conditionElement = document.getElementById('simple-condition');

  // 기존 날씨 데이터가 있는 경우 사용
  if (window.currentWeatherData && tempElement && conditionElement) {
    const temp = Math.round(window.currentWeatherData.main.temp);
    const condition = getKoreanWeatherCondition(window.currentWeatherData.weather[0].main);

    tempElement.textContent = `${temp}°C`;
    conditionElement.textContent = condition;

    console.log(`🌡️ 날씨 업데이트: ${temp}°C, ${condition}`);
  }
}

/**
 * 영어 날씨 상태를 한국어로 변환
 * @param {string} condition - 영어 날씨 상태
 * @returns {string} 한국어 날씨 상태
 */
function getKoreanWeatherCondition(condition) {
  const conditions = {
    'Clear': '맑음',
    'Clouds': '흐림',
    'Rain': '비',
    'Snow': '눈',
    'Thunderstorm': '뇌우',
    'Drizzle': '이슬비',
    'Mist': '안개',
    'Fog': '안개',
    'Haze': '연무'
  };
  return conditions[condition] || '날씨';
}

/* ==========================================================================
   D-Day 카운터 업데이트
   ========================================================================== */

/**
 * D-Day 카운터 실시간 업데이트
 * 2025년 9월 27일까지의 남은 일수 계산
 */
function updateDDayCounter() {
  const ddayElement = document.getElementById('dday-number');
  if (!ddayElement) return;

  // 여행 시작일: 2025년 9월 27일
  const travelDate = new Date('2025-09-27');
  const today = new Date();

  // 시간 차이 계산 (밀리초)
  const timeDiff = travelDate.getTime() - today.getTime();

  // 일수로 변환
  const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

  // D-Day 표시 업데이트
  if (daysDiff > 0) {
    ddayElement.textContent = `-${daysDiff}`;
  } else if (daysDiff === 0) {
    ddayElement.textContent = '-DAY';
  } else {
    ddayElement.textContent = `+${Math.abs(daysDiff)}`;
  }

  console.log(`📅 D-Day 업데이트: ${daysDiff > 0 ? 'D-' + daysDiff : daysDiff === 0 ? 'D-DAY' : 'D+' + Math.abs(daysDiff)}`);
}

/* ==========================================================================
   초기화 및 이벤트 리스너
   ========================================================================== */

/**
 * 헤더 네비게이션 시스템 초기화
 */
function initializeHeaderNavigation() {
  console.log('🏝️ 헤더 네비게이션 시스템 초기화 중...');

  // D-Day 카운터 초기 설정 및 실시간 업데이트
  updateDDayCounter();

  // 매일 자정에 D-Day 카운터 업데이트
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    updateDDayCounter();
    // 매일 업데이트 설정
    setInterval(updateDDayCounter, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  // 날씨 데이터 업데이트 (기존 API와 연동)
  if (window.currentWeatherData) {
    updateSimpleWeather();
  }

  // 날씨 데이터 변경 감지를 위한 이벤트 리스너
  if (window.addEventListener) {
    window.addEventListener('weatherDataUpdated', updateSimpleWeather);
  }

  console.log('✅ 헤더 네비게이션 시스템 초기화 완료');
}

/* ==========================================================================
   글로벌 함수 등록 및 DOM 로드 이벤트
   ========================================================================== */

// DOM이 로드되면 초기화 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHeaderNavigation);
} else {
  // 이미 로드된 경우 즉시 실행
  initializeHeaderNavigation();
}

// 글로벌 함수로 등록 (HTML onclick에서 사용)
window.goToDashboard = goToDashboard;
window.openWeatherDetails = openWeatherDetails;
window.showToast = showToast;