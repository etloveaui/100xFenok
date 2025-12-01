/**
 * navScript.js - 네비게이션 플로팅 메뉴 스크립트
 * nav.html에서 분리됨 (DOMParser script 파싱 이슈 해결)
 */

(function () {
  function initFloatingMenu() {
    const mainToggle = document.getElementById('main-toggle');
    const subButtons = document.getElementById('sub-buttons');
    const scrollBtn = document.getElementById('scroll-combined');
    const shareBtn = document.getElementById('share-url');

    if (!mainToggle || !subButtons) {
      setTimeout(initFloatingMenu, 500);
      return;
    }

    let isOpen = false;

    // 메인 버튼 클릭 이벤트
    mainToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      if (isOpen) {
        mainToggle.classList.add('active');
        subButtons.classList.add('active');
      } else {
        mainToggle.classList.remove('active');
        subButtons.classList.remove('active');
      }
    });

    // 공유 버튼 기능
    if (shareBtn) {
      shareBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🔗 URL 복사 시작');

        let currentPath = 'main.html';
        try {
          if (window.currentActivePage) {
            currentPath = window.currentActivePage;
            console.log('✅ 전역 변수에서 현재 경로 획득:', currentPath);
          } else if (window.parent && window.parent.currentActivePage) {
            currentPath = window.parent.currentActivePage;
            console.log('✅ 부모 창에서 현재 경로 획득:', currentPath);
          } else {
            const urlParams = new URLSearchParams(window.location.search);
            currentPath = urlParams.get('path') || 'main.html';
            console.log('📍 URL params fallback 사용:', currentPath);
          }
        } catch (error) {
          console.log('❌ 경로 획득 실패, 기본값 사용:', error);
          currentPath = 'main.html';
        }

        const baseURL = window.location.origin + window.location.pathname;
        const shareableURL = `${baseURL}?path=${currentPath}`;
        console.log('📋 공유할 완전한 URL:', shareableURL);

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareableURL)
            .then(() => {
              console.log('✅ URL 복사 완료:', shareableURL);
              showCopyNotification('URL이 복사되었습니다!');
            })
            .catch((error) => {
              console.log('❌ URL 복사 실패:', error);
              fallbackCopyURL(shareableURL);
            });
        } else {
          fallbackCopyURL(shareableURL);
        }

        isOpen = false;
        mainToggle.classList.remove('active');
        subButtons.classList.remove('active');
      });
    }

    // 위로가기 기능
    if (scrollBtn) {
      scrollBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🚀 위로가기 시작');

        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.scrollTo({ top: 0, behavior: 'smooth' });
            console.log('✅ iframe 내부 스크롤 성공');
          } catch (error) {
            console.log('iframe 내부 스크롤 실패:', error);
          }
        }

        try {
          if (window.parent && window.parent !== window) {
            window.parent.scrollTo({ top: 0, behavior: 'smooth' });
            console.log('✅ 부모 창 스크롤 성공');
          }
        } catch (error) {
          console.log('부모 창 스크롤 실패:', error);
        }

        try {
          const parentDocument = window.parent.document;
          const contentFrame = parentDocument.getElementById('content-frame');
          if (contentFrame && contentFrame.contentWindow) {
            contentFrame.contentWindow.scrollTo({ top: 0, behavior: 'smooth' });
            console.log('✅ content-frame 스크롤 성공');
          }
        } catch (error) {
          console.log('content-frame 스크롤 실패:', error);
        }

        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          if (window.parent && window.parent.document) {
            window.parent.document.documentElement.scrollTop = 0;
            window.parent.document.body.scrollTop = 0;
          }
          console.log('✅ 전체 스크롤 시도 완료');
        } catch (error) {
          console.log('전체 스크롤 시도 실패:', error);
        }

        isOpen = false;
        mainToggle.classList.remove('active');
        subButtons.classList.remove('active');
      });
    }
  }

  // URL 복사 알림 표시 함수
  function showCopyNotification(message) {
    const existingNotification = document.querySelector('.copy-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: rgba(34, 197, 94, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1001;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(-10px)';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // 구형 브라우저용 URL 복사 함수
  function fallbackCopyURL(url) {
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      console.log('✅ fallback URL 복사 성공');
      showCopyNotification('URL이 복사되었습니다!');
    } catch (error) {
      console.log('❌ fallback URL 복사 실패:', error);
      showCopyNotification('URL 복사에 실패했습니다.');
    }

    document.body.removeChild(textArea);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFloatingMenu);
  } else {
    initFloatingMenu();
  }
})();

// ========================================
// 플로팅 버튼 글리치 수정 JavaScript
// ========================================
(function() {
  'use strict';

  function correctFloatingMenuPosition() {
    const floatingMenu = document.querySelector('.combined-floating-menu');
    if (!floatingMenu) return;

    const width = window.innerWidth;
    const isProblemZone = width >= 590 && width <= 720;

    if (isProblemZone) {
      floatingMenu.style.position = 'fixed';
      floatingMenu.style.bottom = '30px';
      floatingMenu.style.right = '30px';
      floatingMenu.style.zIndex = '9999';
      floatingMenu.style.visibility = 'visible';
      floatingMenu.style.opacity = '1';
      floatingMenu.style.transform = 'none';
    } else {
      floatingMenu.style.position = '';
      floatingMenu.style.bottom = '';
      floatingMenu.style.right = '';
      floatingMenu.style.transform = '';
    }

    if (width >= 1024) {
      floatingMenu.style.display = 'none';
    } else {
      floatingMenu.style.display = '';
    }
  }

  let resizeTimeout;
  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(correctFloatingMenuPosition, 16);
  }

  function initPositionFix() {
    correctFloatingMenuPosition();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(correctFloatingMenuPosition, 500);
    });

    setInterval(() => {
      const floatingMenu = document.querySelector('.combined-floating-menu');
      if (floatingMenu) {
        const rect = floatingMenu.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;

        if (rect.right > width || rect.bottom > height || rect.left < 0 || rect.top < 0) {
          correctFloatingMenuPosition();
        }
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPositionFix);
  } else {
    initPositionFix();
  }
})();
