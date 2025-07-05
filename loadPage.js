import { siteVersion } from './version.js';

let currentActivePage = 'main.html';

export function loadPage(pageUrl) {
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
  document.getElementById('content-frame').src = fullUrl;

  const normalize = url => url.replace(window.baseHref, '').replace(/^\.\//, '').replace(/^\//, '');
  const target = normalize(pageUrl);
  currentActivePage = target;

  document.querySelectorAll('#nav a[data-path]').forEach(a => {
    const isActive = normalize(a.getAttribute('data-path')) === target;
    a.classList.toggle('text-blue-600', isActive);
    a.classList.toggle('font-bold', isActive);
    a.classList.toggle('text-slate-600', !isActive);
    a.classList.toggle('font-medium', !isActive);
  });  
}

// 현재 활성 페이지 가져오는 함수 내보내기
export function getCurrentActivePage() {
  return currentActivePage;
}

window.loadPage = loadPage;
window.getCurrentActivePage = getCurrentActivePage; // 전역으로도 접근 가능
