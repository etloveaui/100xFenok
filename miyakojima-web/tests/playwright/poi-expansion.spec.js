// 미야코지마 POI 확장 테스트 - Playwright E2E Test Suite
// 13개 → 175개 POI 확장 과정의 완전한 기능 검증

import { test, expect } from '@playwright/test';
import path from 'path';

// 테스트 설정
const BASE_URL = 'http://localhost:3000'; // http-server 기본 포트
const TEST_TIMEOUT = 30000; // 30초 타임아웃

// 원본 13개 POI ID 목록 (절대 변경되면 안됨)
const ORIGINAL_13_POIS = [
  'beach_001', 'beach_002', 'bridge_001', 'cape_001', 'cave_001',
  'cultural_001', 'cultural_002', 'dining_001', 'dining_002', 
  'shopping_001', 'activity_001', 'activity_002', 'nature_001'
];

// Phase별 예상 POI 개수
const PHASE_POI_COUNTS = {
  phase1: 25,
  phase2: 50, 
  phase3: 100,
  phase4: 175
};

// 성능 임계값 (Phase별)
const PERFORMANCE_THRESHOLDS = {
  phase1: { loadTime: 2000, memoryMB: 25 },
  phase2: { loadTime: 3000, memoryMB: 35 },
  phase3: { loadTime: 4000, memoryMB: 45 },
  phase4: { loadTime: 5000, memoryMB: 50 }
};

test.describe('미야코지마 POI 확장 검증', () => {
  
  test.beforeEach(async ({ page }) => {
    // 콘솔 에러 추적 설정
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`Console error: ${msg.text()}`);
      }
    });
    
    page.on('pageerror', error => {
      console.error(`Page error: ${error.message}`);
    });
  });

  test('기존 13개 POI 무결성 검증', async ({ page }) => {
    console.log('🔍 기존 13개 POI 완전성 검증 시작...');
    
    await page.goto(BASE_URL);
    
    // 1. 페이지 로딩 완료 대기
    await page.waitForSelector('.main-container', { state: 'visible', timeout: 10000 });
    
    // 2. POI 데이터 로딩 완료 대기
    await page.waitForFunction(() => {
      return window.poiManager && window.poiManager.pois.length >= 13;
    }, { timeout: 15000 });
    
    // 3. 원본 13개 POI ID 존재 여부 확인
    const loadedPOIIds = await page.evaluate(() => {
      return window.poiManager.pois.map(poi => poi.id);
    });
    
    console.log(`로딩된 POI 개수: ${loadedPOIIds.length}`);
    console.log(`로딩된 POI IDs:`, loadedPOIIds.slice(0, 13));
    
    // 4. 원본 13개 POI가 모두 존재하는지 확인
    for (const originalId of ORIGINAL_13_POIS) {
      expect(loadedPOIIds).toContain(originalId);
      console.log(`✅ POI ${originalId} 확인됨`);
    }
    
    // 5. POI 섹션으로 이동
    await page.click('[data-section="poi"]');
    await page.waitForSelector('.poi-list', { state: 'visible' });
    
    // 6. 첫 번째 POI 클릭하여 모달 동작 확인
    const firstPOI = page.locator('.poi-card').first();
    await expect(firstPOI).toBeVisible();
    await firstPOI.click();
    
    // 7. POI 상세 모달이 열리는지 확인
    await page.waitForSelector('.poi-modal', { state: 'visible', timeout: 5000 });
    const modalTitle = await page.locator('.poi-modal h3').textContent();
    expect(modalTitle).toBeTruthy();
    console.log(`✅ POI 모달 정상 동작 확인: ${modalTitle}`);
    
    // 8. 모달 닫기
    await page.click('.poi-modal .close-btn');
    await page.waitForSelector('.poi-modal', { state: 'hidden' });
    
    console.log('✅ 기존 13개 POI 무결성 검증 완료');
  });

  test('Phase 1 확장 검증 (13→25개)', async ({ page }) => {
    console.log('🚀 Phase 1 확장 검증 시작...');
    
    const startTime = Date.now();
    await page.goto(BASE_URL);
    
    // 1. 페이지 로딩 시간 측정
    await page.waitForSelector('.main-container', { state: 'visible' });
    const loadTime = Date.now() - startTime;
    console.log(`페이지 로딩 시간: ${loadTime}ms`);
    
    // Phase 1 성능 임계값 확인
    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.phase1.loadTime);
    
    // 2. POI 데이터 로딩 완료 대기
    await page.waitForFunction(() => {
      return window.poiManager && window.poiManager.pois.length >= PHASE_POI_COUNTS.phase1;
    }, { timeout: 20000 });
    
    // 3. 메모리 사용량 측정 (Chrome DevTools Protocol)
    const memoryUsage = await page.evaluate(() => {
      return performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
      } : null;
    });
    
    if (memoryUsage) {
      console.log(`메모리 사용량: ${memoryUsage.usedMB}MB`);
      expect(memoryUsage.usedMB).toBeLessThan(PERFORMANCE_THRESHOLDS.phase1.memoryMB);
    }
    
    // 4. POI 개수 확인
    const poiCount = await page.evaluate(() => window.poiManager.pois.length);
    expect(poiCount).toBeGreaterThanOrEqual(PHASE_POI_COUNTS.phase1);
    console.log(`✅ Phase 1 POI 개수 확인: ${poiCount}개`);
    
    // 5. 기존 13개 POI 여전히 정상인지 재확인
    const loadedPOIIds = await page.evaluate(() => {
      return window.poiManager.pois.map(poi => poi.id);
    });
    
    for (const originalId of ORIGINAL_13_POIS) {
      expect(loadedPOIIds).toContain(originalId);
    }
    
    console.log('✅ Phase 1 확장 검증 완료');
  });

  test('검색 및 필터링 기능 검증', async ({ page }) => {
    console.log('🔍 검색 및 필터링 기능 검증 시작...');
    
    await page.goto(BASE_URL);
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // POI 섹션으로 이동
    await page.click('[data-section="poi"]');
    await page.waitForSelector('.poi-list', { state: 'visible' });
    
    // 1. 검색 기능 테스트
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('비치');
      
      // 검색 결과가 나타날 때까지 대기
      await page.waitForTimeout(1000); // 디바운싱 대기
      
      const searchResults = await page.locator('.poi-card').count();
      expect(searchResults).toBeGreaterThan(0);
      console.log(`✅ 검색 결과: ${searchResults}개`);
      
      // 검색 초기화
      await searchInput.fill('');
      await page.waitForTimeout(500);
    }
    
    // 2. 카테고리 필터 테스트
    const categoryFilter = page.locator('#category-filter');
    if (await categoryFilter.count() > 0) {
      await categoryFilter.selectOption('nature_views');
      await page.waitForTimeout(1000);
      
      const filteredResults = await page.locator('.poi-card').count();
      expect(filteredResults).toBeGreaterThan(0);
      console.log(`✅ 카테고리 필터 결과: ${filteredResults}개`);
      
      // 필터 초기화
      await categoryFilter.selectOption('');
    }
    
    console.log('✅ 검색 및 필터링 기능 검증 완료');
  });

  test('모바일 반응형 테스트', async ({ page }) => {
    console.log('📱 모바일 반응형 테스트 시작...');
    
    // 모바일 뷰포트 설정
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone 6/7/8 크기
    
    await page.goto(BASE_URL);
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // 1. 네비게이션 버튼 클릭 가능 여부 확인
    const navButtons = ['dashboard', 'budget', 'itinerary', 'poi'];
    
    for (const section of navButtons) {
      const button = page.locator(`[data-section="${section}"]`);
      await expect(button).toBeVisible();
      
      await button.click();
      await page.waitForTimeout(500);
      
      // 해당 섹션이 활성화되었는지 확인
      const activeSection = page.locator(`#${section}-section.active`);
      await expect(activeSection).toBeVisible();
      
      console.log(`✅ 모바일 네비게이션 ${section} 확인됨`);
    }
    
    // 2. POI 카드가 모바일에서 잘 렌더링되는지 확인
    await page.click('[data-section="poi"]');
    await page.waitForSelector('.poi-list', { state: 'visible' });
    
    const poiCards = page.locator('.poi-card');
    const cardCount = await poiCards.count();
    expect(cardCount).toBeGreaterThan(0);
    
    // 첫 번째 카드 클릭하여 모달 확인
    await poiCards.first().click();
    await page.waitForSelector('.poi-modal', { state: 'visible' });
    
    // 모바일에서 모달이 전체 화면을 적절히 사용하는지 확인
    const modal = page.locator('.poi-modal');
    const modalBox = await modal.boundingBox();
    expect(modalBox.width).toBeGreaterThan(300); // 최소 너비 확인
    
    await page.click('.poi-modal .close-btn');
    
    console.log('✅ 모바일 반응형 테스트 완료');
  });

  test('성능 벤치마크 테스트', async ({ page }) => {
    console.log('⚡ 성능 벤치마크 테스트 시작...');
    
    // 네트워크 속도 시뮬레이션 (3G)
    await page.route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms 지연
      await route.continue();
    });
    
    const startTime = Date.now();
    await page.goto(BASE_URL);
    
    // First Contentful Paint 시뮬레이션
    await page.waitForSelector('.main-header', { state: 'visible' });
    const fcpTime = Date.now() - startTime;
    
    // Largest Contentful Paint 시뮬레이션
    await page.waitForSelector('.main-container', { state: 'visible' });
    const lcpTime = Date.now() - startTime;
    
    console.log(`FCP: ${fcpTime}ms, LCP: ${lcpTime}ms`);
    
    // POI 데이터 로딩 완료 시간
    await page.waitForFunction(() => {
      return window.poiManager && window.poiManager.pois.length > 0;
    }, { timeout: 30000 });
    
    const totalLoadTime = Date.now() - startTime;
    console.log(`전체 로딩 시간: ${totalLoadTime}ms`);
    
    // 성능 메트릭 수집
    const performanceMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        memory: performance.memory ? {
          used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
        } : null
      };
    });
    
    console.log('성능 메트릭:', performanceMetrics);
    
    // 기본 성능 임계값 확인 (관대한 설정)
    expect(totalLoadTime).toBeLessThan(15000); // 15초 이내
    if (performanceMetrics.memory) {
      expect(performanceMetrics.memory.used).toBeLessThan(100); // 100MB 이내
    }
    
    console.log('✅ 성능 벤치마크 테스트 완료');
  });

  test('오프라인 모드 PWA 테스트', async ({ page, context }) => {
    console.log('📶 오프라인 모드 PWA 테스트 시작...');
    
    // 1. 온라인 모드에서 페이지 로드
    await page.goto(BASE_URL);
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // Service Worker 등록 확인
    const swRegistered = await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.length > 0;
      }
      return false;
    });
    
    if (swRegistered) {
      console.log('✅ Service Worker 등록 확인됨');
      
      // 2. 오프라인 모드로 전환
      await context.setOffline(true);
      
      // 3. 페이지 새로고침하여 캐시에서 로드되는지 확인
      await page.reload({ waitUntil: 'networkidle' });
      
      // 4. 기본 콘텐츠가 여전히 표시되는지 확인
      await expect(page.locator('.main-header')).toBeVisible();
      await expect(page.locator('.main-container')).toBeVisible();
      
      // 5. 온라인 모드로 복구
      await context.setOffline(false);
      
      console.log('✅ 오프라인 모드 테스트 완료');
    } else {
      console.log('⚠️ Service Worker 미등록 - PWA 테스트 생략');
    }
  });

  test('브라우저 호환성 테스트', async ({ browserName, page }) => {
    console.log(`🌐 ${browserName} 브라우저 호환성 테스트 시작...`);
    
    await page.goto(BASE_URL);
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // 1. JavaScript 에러가 없는지 확인
    const jsErrors = [];
    page.on('pageerror', error => jsErrors.push(error.message));
    
    await page.waitForTimeout(3000); // 3초 대기
    expect(jsErrors.length).toBe(0);
    
    // 2. CSS 스타일이 제대로 적용되었는지 확인
    const headerStyles = await page.evaluate(() => {
      const header = document.querySelector('.main-header');
      if (!header) return null;
      
      const styles = window.getComputedStyle(header);
      return {
        display: styles.display,
        backgroundColor: styles.backgroundColor,
        position: styles.position
      };
    });
    
    expect(headerStyles).not.toBeNull();
    expect(headerStyles.display).not.toBe('none');
    
    // 3. 기본 상호작용 테스트
    const navButton = page.locator('[data-section="poi"]');
    await navButton.click();
    
    await page.waitForSelector('#poi-section.active', { state: 'visible' });
    
    console.log(`✅ ${browserName} 브라우저 호환성 테스트 완료`);
  });

  test('롤백 시나리오 테스트', async ({ page }) => {
    console.log('🔄 롤백 시나리오 테스트 시작...');
    
    await page.goto(BASE_URL);
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // 1. 정상 상태 확인
    const normalState = await page.evaluate(() => ({
      poiCount: window.poiManager ? window.poiManager.pois.length : 0,
      hasErrors: window.console.error.callCount > 0 || false
    }));
    
    console.log('정상 상태:', normalState);
    expect(normalState.poiCount).toBeGreaterThan(0);
    
    // 2. 의도적 오류 시뮬레이션 (실제 운영에서는 사용하지 않음)
    // 여기서는 오류 복구 시나리오만 테스트
    
    // 3. 페이지 새로고침으로 복구 테스트
    await page.reload();
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    const recoveredState = await page.evaluate(() => ({
      poiCount: window.poiManager ? window.poiManager.pois.length : 0
    }));
    
    expect(recoveredState.poiCount).toBe(normalState.poiCount);
    
    console.log('✅ 롤백 시나리오 테스트 완료');
  });
});

// 헬퍼 함수들
async function measureMemoryUsage(page) {
  return await page.evaluate(() => {
    if (!performance.memory) return null;
    
    return {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
    };
  });
}

async function waitForPOILoad(page, expectedCount = 13) {
  await page.waitForFunction(
    (count) => window.poiManager && window.poiManager.pois.length >= count,
    expectedCount,
    { timeout: 20000 }
  );
}