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
 * 간소화된 날씨 카드 업데이트 - GPS 현재 위치 기반
 * 현재 위치의 날씨 데이터를 가져와서 표시
 */
function updateSimpleWeather() {
  const tempElement = document.getElementById('simple-temp');
  const conditionElement = document.getElementById('simple-condition');
  const iconElement = document.getElementById('weather-icon');
  const timeElement = document.getElementById('current-time');
  const locationElement = document.getElementById('location-name');

  // GPS 기반 현재 위치 날씨 가져오기
  getCurrentLocationWeather().then(weatherData => {
    if (weatherData && tempElement && conditionElement && iconElement) {
      const temp = Math.round(weatherData.main.temp);
      const weatherMain = weatherData.weather[0].main;
      const condition = getKoreanWeatherCondition(weatherMain);

      // 현재 시간이 밤인지 확인 (일몰/일출 시간 기준)
      const now = new Date();
      const currentHour = now.getHours();
      const isNight = currentHour < 6 || currentHour > 19;

      const weatherIcon = getWeatherIcon(weatherMain, isNight);

      // 온도와 날씨 조건 업데이트
      tempElement.textContent = `${temp}°C`;
      iconElement.textContent = weatherIcon;
      conditionElement.textContent = condition;

      // 현재 위치 지명 업데이트
      updateLocationName(weatherData.coord.lat, weatherData.coord.lon);

      console.log(`🌡️ GPS 기반 날씨 업데이트: ${temp}°C, ${weatherIcon} ${condition}`);
    }
  }).catch(error => {
    console.warn('GPS 날씨 로드 실패, 기존 데이터 사용:', error);

    // GPS 실패 시 기존 날씨 데이터 사용
    if (window.currentWeatherData && tempElement && conditionElement && iconElement) {
      const temp = Math.round(window.currentWeatherData.main.temp);
      const weatherMain = window.currentWeatherData.weather[0].main;
      const condition = getKoreanWeatherCondition(weatherMain);
      const now = new Date();
      const currentHour = now.getHours();
      const isNight = currentHour < 6 || currentHour > 19;
      const weatherIcon = getWeatherIcon(weatherMain, isNight);

      tempElement.textContent = `${temp}°C`;
      iconElement.textContent = weatherIcon;
      conditionElement.textContent = condition;
    }
  });

  // 실시간 시계 업데이트
  updateCurrentTime();
}

/**
 * GPS 좌표를 지명으로 변환 (Reverse Geocoding)
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 */
async function updateLocationName(lat, lon) {
  const locationElement = document.getElementById('location-name');
  if (!locationElement) return;

  try {
    const response = await fetch(
      `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=62c85ff5eff6e712643db50c03ec5beb`
    );

    if (response.ok) {
      const locationData = await response.json();
      if (locationData && locationData.length > 0) {
        const location = locationData[0];
        const cityName = location.local_names?.ko || location.name;
        const countryName = location.country === 'KR' ? '' : ` ${location.country}`;
        locationElement.textContent = `${cityName}${countryName}`;
        console.log(`📍 위치 업데이트: ${cityName}${countryName}`);
      }
    }
  } catch (error) {
    console.warn('위치 이름 변환 실패:', error);
    locationElement.textContent = '현재 위치';
  }
}

/**
 * GPS를 사용해서 현재 위치의 날씨 가져오기
 * @returns {Promise} 현재 위치 날씨 데이터
 */
function getCurrentLocationWeather() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation이 지원되지 않습니다'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        try {
          // OpenWeatherMap API 호출
          const apiKey = '62c85ff5eff6e712643db50c03ec5beb';
          const response = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=kr`
          );

          if (!response.ok) {
            throw new Error(`날씨 API 호출 실패: ${response.status}`);
          }

          const weatherData = await response.json();
          resolve(weatherData);
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        reject(new Error(`GPS 위치 접근 실패: ${error.message}`));
      },
      {
        timeout: 10000,
        maximumAge: 300000, // 5분 캐시
        enableHighAccuracy: false
      }
    );
  });
}

/**
 * 실시간 시계 표시 업데이트
 */
function updateCurrentTime() {
  const timeElement = document.getElementById('current-time');
  if (timeElement) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    timeElement.textContent = timeString;
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

/**
 * 날씨 상태별 아이콘 가져오기
 * @param {string} condition - 영어 날씨 상태
 * @param {boolean} isNight - 밤인지 여부 (선택적)
 * @returns {string} 해당하는 이모지 아이콘
 */
function getWeatherIcon(condition, isNight = false) {
  const icons = {
    'Clear': isNight ? '🌙' : '☀️',
    'Clouds': isNight ? '☁️' : '☁️',
    'Rain': '🌧️',
    'Drizzle': '🌦️',
    'Snow': '❄️',
    'Thunderstorm': '⛈️',
    'Mist': '🌫️',
    'Fog': '🌫️',
    'Haze': '🌫️'
  };
  return icons[condition] || '🌤️';
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

  try {
    // D-Day 카운터 초기 설정 및 실시간 업데이트
    updateDDayCounter();
  } catch (error) {
    console.error('❌ D-Day 카운터 초기화 실패:', error);
  }

  // 매일 자정에 D-Day 카운터 업데이트
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    updateDDayCounter();
    // 매일 업데이트 설정
    setInterval(updateDDayCounter, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  // 날씨 데이터 업데이트 (GPS 기반) - 지연 실행으로 앱 초기화 후 실행
  setTimeout(() => {
    console.log('🌤️ 날씨 정보 로드 시작...');
    try {
      updateSimpleWeather();
      updateCurrentTime();
    } catch (error) {
      console.error('❌ 날씨/시간 초기화 실패:', error);
    }
  }, 1000);

  // 실시간 시계 업데이트 (1분마다)
  setInterval(updateCurrentTime, 60000);

  // 날씨 데이터 주기적 업데이트 (10분마다)
  setInterval(updateSimpleWeather, 600000);

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

/* ==========================================================================
   빠른액션 버튼 기능들
   ========================================================================== */

/**
 * 예산 현황 빠른보기
 */
function showBudgetOverview() {
  const dropdown = document.getElementById('quick-dropdown');
  const content = document.getElementById('dropdown-content');

  content.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px; color: #00bcd4;">💰 예산 현황</div>
    <div>총 예산: 500,000원</div>
    <div>사용한 금액: 120,000원</div>
    <div>남은 금액: 380,000원</div>
    <div style="margin-top: 8px; font-size: 12px; color: #64748b;">상세보기는 예산탭에서</div>
  `;

  showQuickDropdown();
  setTimeout(hideQuickDropdown, 3000);
}

/**
 * 오늘 일정 빠른보기
 */
function showTodaySchedule() {
  const dropdown = document.getElementById('quick-dropdown');
  const content = document.getElementById('dropdown-content');

  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });

  content.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px; color: #00bcd4;">📅 ${today}</div>
    <div>09:00 - 호텔 체크아웃</div>
    <div>10:30 - 이라부대교 관광</div>
    <div>14:00 - 해변 스노클링</div>
    <div style="margin-top: 8px; font-size: 12px; color: #64748b;">상세보기는 일정탭에서</div>
  `;

  showQuickDropdown();
  setTimeout(hideQuickDropdown, 3000);
}

/**
 * 주변 장소 빠른보기
 */
function showNearbyPOI() {
  const dropdown = document.getElementById('quick-dropdown');
  const content = document.getElementById('dropdown-content');

  content.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px; color: #00bcd4;">📍 주변 장소</div>
    <div>🏖️ 요나마 해변 (1.2km)</div>
    <div>🍜 현지 식당 (800m)</div>
    <div>⛽ 주유소 (2.1km)</div>
    <div style="margin-top: 8px; font-size: 12px; color: #64748b;">상세보기는 장소탭에서</div>
  `;

  showQuickDropdown();
  setTimeout(hideQuickDropdown, 3000);
}

/**
 * 빠른액션 드롭다운 표시
 */
function showQuickDropdown() {
  const dropdown = document.getElementById('quick-dropdown');
  dropdown.classList.add('show');
}

/**
 * 빠른액션 드롭다운 숨김
 */
function hideQuickDropdown() {
  const dropdown = document.getElementById('quick-dropdown');
  dropdown.classList.remove('show');
}


// 글로벌 함수로 등록 (HTML onclick에서 사용)
window.goToDashboard = goToDashboard;
window.openWeatherDetails = openWeatherDetails;
window.showToast = showToast;
window.showBudgetOverview = showBudgetOverview;
window.showTodaySchedule = showTodaySchedule;
window.showNearbyPOI = showNearbyPOI;
window.showLoveBubble = showLoveBubble;