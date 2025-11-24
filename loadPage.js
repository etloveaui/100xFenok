import { siteVersion } from './version.js';

let currentActivePage = 'main.html';

// 두 번째 파라미터(updateHistory)를 추가하고 기본값은 true로 설정
export function loadPage(pageUrl, updateHistory = true) {
  console.log("--- [Debug] Page Load Triggered ---");
  console.log("1. Clicked Path (pageUrl):", pageUrl);
  console.log("2. Base Href (window.baseHref):", window.baseHref);
  currentActivePage = pageUrl;
  window.currentActivePage = pageUrl; // window 객체에도 저장
  console.log("3. 전역 변수 업데이트:", currentActivePage);


  const isExternal = /^(?:[a-z]+:)?\/\//i.test(pageUrl);

  let resolvedUrl;
  if (isExternal) {
    resolvedUrl = pageUrl;
  } else {
    // pageUrl에서 혹시 모를 앞쪽 슬래시를 제거하고, baseHref와 합칩니다.
    const relativePath = pageUrl.replace(/^\//, '');
    resolvedUrl = window.baseHref + relativePath;
  }
  const fullUrl = `${resolvedUrl}?v=${siteVersion}`;
  frame.src = fullUrl;

  // 5. 상태 업데이트
  currentActivePage = path;
  window.currentActivePage = path; // window 객체에도 저장

  // 6. 히스토리 관리
  if (path !== 'main.html') {
    const newUrl = `${window.location.pathname}?path=${path}`;
    window.history.pushState({ path }, '', newUrl);
  } else {
    window.history.pushState({ path }, '', window.location.pathname);
  }

  // 7. 네비게이션 활성 상태 업데이트
  updateActiveNav(path);
}

function updateActiveNav(path) {
  const normalize = url => url.replace(window.baseHref, '').replace(/^\.\//, '').replace(/^\//, '');
  const target = normalize(path);

  document.querySelectorAll('#nav a[data-path]').forEach(a => {
    const isActive = normalize(a.getAttribute('data-path')) === target;
    a.classList.toggle('text-blue-600', isActive);
    a.classList.toggle('font-bold', isActive);
    a.classList.toggle('text-slate-600', !isActive);
    a.classList.toggle('font-medium', !isActive);
  });
}

window.loadPage = loadPage;
window.getCurrentActivePage = getCurrentActivePage; // 전역으로도 접근 가능

// 이 코드를 loadPage.js 파일 맨 아래에 추가
window.addEventListener('popstate', function (event) {
  // 뒤로/앞으로 가기로 URL이 변경되었을 때
  if (event.state && event.state.path) {
    // 저장된 path로 페이지를 다시 로드 (단, 방문 기록은 남기지 않음)
    loadPage(event.state.path, false);
  }
});