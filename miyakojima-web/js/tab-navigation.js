/**
 * 🏝️ Miyako Tab Navigation System
 * 탭 전환 및 active 상태 관리
 * Created: 2025-09-16
 */

/* ==========================================================================
   탭 네비게이션 시스템
   ========================================================================== */

/**
 * 탭 네비게이션 시스템 초기화
 */
function initializeTabNavigation() {
  console.log('🔗 탭 네비게이션 시스템 초기화 중...');

  const navButtons = document.querySelectorAll('.nav-btn');

  if (navButtons.length === 0) {
    console.warn('❌ 탭 버튼을 찾을 수 없습니다.');
    return;
  }

  // 각 탭 버튼에 클릭 이벤트 추가
  navButtons.forEach(button => {
    button.addEventListener('click', handleTabClick);
  });

  // URL 해시에 따른 초기 탭 설정
  setInitialTab();

  // 브라우저 뒤로가기/앞으로가기 대응
  window.addEventListener('hashchange', handleHashChange);

  console.log(`✅ 탭 네비게이션 초기화 완료 (${navButtons.length}개 탭)`);
}

/**
 * 탭 클릭 이벤트 처리
 * @param {Event} event - 클릭 이벤트
 */
function handleTabClick(event) {
  const button = event.currentTarget;
  const targetSection = button.dataset.section;

  if (!targetSection) {
    console.warn('❌ 탭 버튼에 data-section이 없습니다:', button);
    return;
  }

  console.log(`🔄 탭 전환: ${targetSection}`);

  // active 상태 업데이트
  updateActiveTab(button);

  // 섹션 표시 업데이트
  showSection(targetSection);

  // URL 해시 업데이트
  updateUrlHash(targetSection);

  // 커스텀 이벤트 발생
  dispatchTabChangeEvent(targetSection);
}

/**
 * Active 탭 상태 업데이트
 * @param {HTMLElement} activeButton - 활성화할 버튼
 */
function updateActiveTab(activeButton) {
  // 모든 탭에서 active 클래스 제거
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    // 기존 btn-primary 클래스도 제거 (이전 시스템 호환)
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  });

  // 선택된 탭에 active 클래스 추가
  activeButton.classList.add('active');
  activeButton.classList.remove('btn-secondary');
  activeButton.classList.add('btn-primary');

  console.log(`✅ Active 탭 업데이트: ${activeButton.dataset.section}`);
}

/**
 * 해당 섹션 표시
 * @param {string} sectionName - 표시할 섹션 이름
 */
function showSection(sectionName) {
  // 모든 섹션 숨기기
  const sections = document.querySelectorAll('.section');
  sections.forEach(section => {
    section.classList.remove('active');
    section.style.display = 'none';
  });

  // 해당 섹션 표시
  const targetSection = document.getElementById(`${sectionName}-section`);
  if (targetSection) {
    targetSection.style.display = 'block';
    targetSection.classList.add('active');
    console.log(`👁️ 섹션 표시: ${sectionName}-section`);
  } else {
    console.warn(`❌ 섹션을 찾을 수 없습니다: ${sectionName}-section`);
  }
}

/**
 * URL 해시 업데이트
 * @param {string} sectionName - 섹션 이름
 */
function updateUrlHash(sectionName) {
  const newHash = sectionName === 'dashboard' ? '' : `#${sectionName}`;

  // 해시 변경 (뒤로가기 히스토리에 추가)
  if (window.location.hash !== newHash) {
    window.location.hash = newHash;
  }
}

/**
 * 해시 변경 이벤트 처리
 */
function handleHashChange() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  console.log(`🔗 해시 변경 감지: ${hash}`);

  // 해당 탭 활성화
  const targetButton = document.querySelector(`[data-section="${hash}"]`);
  if (targetButton) {
    updateActiveTab(targetButton);
    showSection(hash);
    dispatchTabChangeEvent(hash);
  }
}

/**
 * 초기 탭 설정
 */
function setInitialTab() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const initialButton = document.querySelector(`[data-section="${hash}"]`);

  if (initialButton) {
    updateActiveTab(initialButton);
    showSection(hash);
    console.log(`🏠 초기 탭 설정: ${hash}`);
  } else {
    // 기본값: 대시보드
    const dashboardButton = document.querySelector('[data-section="dashboard"]');
    if (dashboardButton) {
      updateActiveTab(dashboardButton);
      showSection('dashboard');
      console.log('🏠 기본 대시보드 탭 설정');
    }
  }
}

/**
 * 탭 변경 커스텀 이벤트 발생
 * @param {string} sectionName - 변경된 섹션 이름
 */
function dispatchTabChangeEvent(sectionName) {
  const event = new CustomEvent('tabChanged', {
    detail: { section: sectionName },
    bubbles: true
  });
  document.dispatchEvent(event);
}

/* ==========================================================================
   유틸리티 함수들
   ========================================================================== */

/**
 * 프로그래밍 방식으로 탭 전환
 * @param {string} sectionName - 전환할 섹션 이름
 */
function switchToTab(sectionName) {
  const targetButton = document.querySelector(`[data-section="${sectionName}"]`);
  if (targetButton) {
    handleTabClick({ currentTarget: targetButton });
  } else {
    console.warn(`❌ 탭을 찾을 수 없습니다: ${sectionName}`);
  }
}

/**
 * 현재 활성 탭 가져오기
 * @returns {string} 현재 활성 탭의 섹션 이름
 */
function getCurrentActiveTab() {
  const activeButton = document.querySelector('.nav-btn.active');
  return activeButton ? activeButton.dataset.section : 'dashboard';
}

/**
 * 탭 비활성화/활성화
 * @param {string} sectionName - 대상 섹션
 * @param {boolean} disabled - 비활성화 여부
 */
function setTabDisabled(sectionName, disabled = true) {
  const targetButton = document.querySelector(`[data-section="${sectionName}"]`);
  if (targetButton) {
    targetButton.disabled = disabled;
    if (disabled) {
      targetButton.style.opacity = '0.5';
      targetButton.style.cursor = 'not-allowed';
    } else {
      targetButton.style.opacity = '1';
      targetButton.style.cursor = 'pointer';
    }
  }
}

/* ==========================================================================
   초기화 및 전역 함수 등록
   ========================================================================== */

// DOM 로드 후 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTabNavigation);
} else {
  initializeTabNavigation();
}

// 전역 함수로 등록
window.switchToTab = switchToTab;
window.getCurrentActiveTab = getCurrentActiveTab;
window.setTabDisabled = setTabDisabled;

// 탭 변경 이벤트 리스너 예제
document.addEventListener('tabChanged', (event) => {
  console.log(`📋 탭 변경됨: ${event.detail.section}`);

  // 각 탭별 추가 로직 실행 가능
  switch (event.detail.section) {
    case 'dashboard':
      // 대시보드 데이터 갱신 등
      break;
    case 'budget':
      // 예산 데이터 로드 등
      break;
    case 'itinerary':
      // 일정 데이터 갱신 등
      break;
    case 'poi':
      // POI 데이터 로드 등
      break;
  }
});