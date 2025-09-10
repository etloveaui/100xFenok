// 미야코지마 웹 플랫폼 - 실제 사용 시나리오 통합 테스트
// 김은태/정유민 실제 여행 시나리오 기반 E2E 테스트

import { test, expect } from '@playwright/test';

test.describe('미야코지마 실제 여행 시나리오 테스트', () => {
  
  const TRAVELER_PROFILES = {
    euntae: {
      name: '김은태',
      preferences: ['photography', 'beaches', 'sunset_spots'],
      budget: 50000, // 하루 5만원
      travelStyle: 'relaxed'
    },
    yumin: {
      name: '정유민', 
      preferences: ['activities', 'local_food', 'cultural_sites'],
      budget: 40000, // 하루 4만원
      travelStyle: 'active'
    }
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.main-container', { state: 'visible' });
  });

  test('시나리오 1: 첫날 계획 세우기 (은태 관점)', async ({ page }) => {
    console.log('📋 시나리오: 김은태가 미야코지마 첫날 계획을 세우는 과정');
    
    // 1. POI 섹션으로 이동
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    // 2. 사진 촬영 명소 검색
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('포토 스팟');
      await page.waitForTimeout(1000);
      
      // 검색 결과 확인
      const searchResults = await page.locator('.poi-card').count();
      expect(searchResults).toBeGreaterThan(0);
      console.log(`📸 포토 스팟 검색 결과: ${searchResults}개`);
    }
    
    // 3. 해변 카테고리 필터링
    const categoryFilter = page.locator('#category-filter');
    if (await categoryFilter.count() > 0) {
      await categoryFilter.selectOption('nature_views');
      await page.waitForTimeout(1000);
      
      const beachResults = await page.locator('.poi-card').count();
      expect(beachResults).toBeGreaterThan(0);
      console.log(`🏖️ 자연경관 필터 결과: ${beachResults}개`);
    }
    
    // 4. 요나하 마에하마 비치 상세 정보 확인
    const yonahaBeach = page.locator('.poi-card').filter({ hasText: '요나하 마에하마' }).first();
    if (await yonahaBeach.count() > 0) {
      await yonahaBeach.click();
      
      // 모달 열림 확인
      await page.waitForSelector('.poi-modal', { state: 'visible' });
      
      // 일몰 시간 정보 확인
      const sunsetInfo = page.locator('.poi-modal').filter({ hasText: '일몰' });
      if (await sunsetInfo.count() > 0) {
        console.log('✅ 일몰 정보 확인 - 사진 촬영 계획 가능');
      }
      
      // 모달 닫기
      await page.click('.poi-modal .close-btn');
      await page.waitForSelector('.poi-modal', { state: 'hidden' });
    }
    
    // 5. 일정에 추가 (가상의 기능)
    console.log('📝 은태의 첫날 계획: 요나하 마에하마 비치 일몰 촬영');
  });

  test('시나리오 2: 현지 맛집 찾기 (유민 관점)', async ({ page }) => {
    console.log('🍽️ 시나리오: 정유민이 현지 맛집을 찾는 과정');
    
    // 1. POI 섹션으로 이동
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    // 2. 맛집 카테고리 검색
    const categoryFilter = page.locator('#category-filter');
    if (await categoryFilter.count() > 0) {
      await categoryFilter.selectOption('dining');
      await page.waitForTimeout(1000);
      
      const diningResults = await page.locator('.poi-card').count();
      expect(diningResults).toBeGreaterThan(0);
      console.log(`🍜 맛집 검색 결과: ${diningResults}개`);
    }
    
    // 3. 첫 번째 맛집 상세 정보 확인
    const firstRestaurant = page.locator('.poi-card').first();
    await firstRestaurant.click();
    
    await page.waitForSelector('.poi-modal', { state: 'visible' });
    
    // 영업시간 확인
    const businessHours = await page.locator('.poi-modal .contact').textContent();
    expect(businessHours).toBeTruthy();
    console.log('⏰ 영업시간 정보 확인됨');
    
    // 가격대 정보 확인
    const priceLevel = await page.evaluate(() => {
      const modal = document.querySelector('.poi-modal');
      return modal ? modal.textContent.includes('price') || modal.textContent.includes('가격') || modal.textContent.includes('엔') : false;
    });
    
    if (priceLevel) {
      console.log('💰 가격 정보 확인 - 예산 계획 가능');
    }
    
    await page.click('.poi-modal .close-btn');
    
    console.log('📝 유민의 맛집 계획: 현지 전통 요리 체험');
  });

  test('시나리오 3: 커플 데이트 코스 계획', async ({ page }) => {
    console.log('💕 시나리오: 은태와 유민이 함께하는 데이트 코스 계획');
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const dateSpots = [];
    
    // 1. 로맨틱한 장소 찾기
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('로맨틱');
      await page.waitForTimeout(1000);
      
      // 검색 결과에서 첫 번째 장소 정보 수집
      const firstResult = page.locator('.poi-card').first();
      if (await firstResult.count() > 0) {
        const spotName = await firstResult.locator('.poi-title').textContent();
        dateSpots.push(spotName);
        console.log(`💖 데이트 스팟 1: ${spotName}`);
      }
    }
    
    // 2. 액티비티 장소 찾기
    await searchInput.fill('액티비티');
    await page.waitForTimeout(1000);
    
    const activitySpot = page.locator('.poi-card').first();
    if (await activitySpot.count() > 0) {
      const activityName = await activitySpot.locator('.poi-title').textContent();
      dateSpots.push(activityName);
      console.log(`🏃‍♀️ 데이트 스팟 2: ${activityName}`);
    }
    
    // 3. 맛집 추가
    const categoryFilter = page.locator('#category-filter');
    if (await categoryFilter.count() > 0) {
      await categoryFilter.selectOption('dining');
      await page.waitForTimeout(1000);
      
      const restaurant = page.locator('.poi-card').first();
      if (await restaurant.count() > 0) {
        const restaurantName = await restaurant.locator('.poi-title').textContent();
        dateSpots.push(restaurantName);
        console.log(`🍽️ 데이트 스팟 3: ${restaurantName}`);
      }
    }
    
    expect(dateSpots.length).toBeGreaterThan(2);
    console.log('✅ 완벽한 데이트 코스 계획 완성:', dateSpots);
  });

  test('시나리오 4: 예산 관리하며 여행 계획', async ({ page }) => {
    console.log('💰 시나리오: 예산을 고려한 효율적 여행 계획');
    
    // 1. 예산 섹션 확인
    await page.click('[data-section="budget"]');
    await page.waitForSelector('#budget-section.active');
    
    // 현재 예산 상태 확인
    const todayBudget = await page.locator('#today-remaining').textContent();
    console.log(`💵 오늘 남은 예산: ${todayBudget}`);
    
    // 2. 무료 명소 우선 찾기
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('무료');
      await page.waitForTimeout(1000);
      
      const freeSpots = await page.locator('.poi-card').count();
      console.log(`🆓 무료 명소: ${freeSpots}개`);
      
      // 무료 명소가 있다면 상세 정보 확인
      if (freeSpots > 0) {
        const firstFreeSpot = page.locator('.poi-card').first();
        await firstFreeSpot.click();
        
        await page.waitForSelector('.poi-modal', { state: 'visible' });
        
        // 입장료 정보 확인
        const freeAccess = await page.evaluate(() => {
          const modal = document.querySelector('.poi-modal');
          return modal ? modal.textContent.toLowerCase().includes('free') || 
                        modal.textContent.includes('무료') ||
                        modal.textContent.includes('24시간') : false;
        });
        
        if (freeAccess) {
          console.log('✅ 무료 명소 확인 - 예산 절약 가능');
        }
        
        await page.click('.poi-modal .close-btn');
      }
    }
    
    // 3. 예산 친화적 맛집 찾기
    await searchInput.fill('저렴');
    await page.waitForTimeout(1000);
    
    const budgetFriendly = await page.locator('.poi-card').count();
    console.log(`💴 예산 친화적 장소: ${budgetFriendly}개`);
    
    console.log('📊 예산 최적화 여행 계획 완료');
  });

  test('시나리오 5: 날씨에 따른 실시간 계획 변경', async ({ page }) => {
    console.log('🌦️ 시나리오: 날씨 변화에 따른 유연한 계획 조정');
    
    // 1. 날씨 위젯 확인
    const weatherWidget = page.locator('#weather-widget');
    const currentWeather = await weatherWidget.textContent();
    console.log(`🌤️ 현재 날씨: ${currentWeather}`);
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    // 2. 실내 활동 가능 장소 찾기 (비올 경우 대비)
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('실내');
      await page.waitForTimeout(1000);
      
      let indoorSpots = await page.locator('.poi-card').count();
      
      // 실내 검색 결과가 없다면 문화시설 찾기
      if (indoorSpots === 0) {
        const categoryFilter = page.locator('#category-filter');
        if (await categoryFilter.count() > 0) {
          await categoryFilter.selectOption('cultural');
          await page.waitForTimeout(1000);
          indoorSpots = await page.locator('.poi-card').count();
        }
      }
      
      console.log(`🏢 실내 활동 가능 장소: ${indoorSpots}개`);
    }
    
    // 3. 야외 활동 장소도 확인 (맑을 경우)
    await searchInput.fill('야외');
    await page.waitForTimeout(1000);
    
    const outdoorSpots = await page.locator('.poi-card').count();
    console.log(`🌳 야외 활동 장소: ${outdoorSpots}개`);
    
    console.log('🔄 날씨 대응 계획 수립 완료 - 실내/야외 옵션 확보');
  });

  test('시나리오 6: 사진 촬영 최적 시간 계획', async ({ page }) => {
    console.log('📸 시나리오: 인스타그램용 최고의 사진을 위한 시간 계획');
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const photoSpots = [];
    
    // 1. 일출 명소 찾기
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('일출');
      await page.waitForTimeout(1000);
      
      const sunriseSpots = await page.locator('.poi-card').count();
      if (sunriseSpots > 0) {
        const firstSunriseSpot = page.locator('.poi-card').first();
        const spotName = await firstSunriseSpot.locator('.poi-title').textContent();
        photoSpots.push({ name: spotName, time: '일출 (06:00-07:00)' });
        console.log(`🌅 일출 촬영 명소: ${spotName}`);
      }
    }
    
    // 2. 일몰 명소 찾기
    await searchInput.fill('일몰');
    await page.waitForTimeout(1000);
    
    const sunsetSpots = await page.locator('.poi-card').count();
    if (sunsetSpots > 0) {
      const firstSunsetSpot = page.locator('.poi-card').first();
      const spotName = await firstSunsetSpot.locator('.poi-title').textContent();
      photoSpots.push({ name: spotName, time: '일몰 (18:00-19:00)' });
      console.log(`🌇 일몰 촬영 명소: ${spotName}`);
    }
    
    // 3. 포토 스팟 태그가 있는 장소 찾기
    await searchInput.fill('photo');
    await page.waitForTimeout(1000);
    
    const photoTagSpots = await page.locator('.poi-card').count();
    if (photoTagSpots > 0) {
      const firstPhotoSpot = page.locator('.poi-card').first();
      const spotName = await firstPhotoSpot.locator('.poi-title').textContent();
      photoSpots.push({ name: spotName, time: '골든아워 (16:00-17:00)' });
      console.log(`📷 포토 스팟: ${spotName}`);
    }
    
    expect(photoSpots.length).toBeGreaterThan(0);
    console.log('📅 사진 촬영 스케줄 완성:', photoSpots);
  });

  test('시나리오 7: 오프라인 모드 여행 준비', async ({ page, context }) => {
    console.log('📶 시나리오: 인터넷이 불안정한 현지에서의 오프라인 사용');
    
    // 1. 온라인 상태에서 모든 데이터 로딩
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.main-container', { state: 'visible' });
    
    // 모든 섹션 방문하여 데이터 캐싱
    const sections = ['dashboard', 'budget', 'itinerary', 'poi'];
    
    for (const section of sections) {
      await page.click(`[data-section="${section}"]`);
      await page.waitForSelector(`#${section}-section.active`);
      await page.waitForTimeout(1000); // 데이터 로딩 대기
      console.log(`✅ ${section} 섹션 데이터 캐시됨`);
    }
    
    // POI 상세 정보도 미리 로딩
    await page.click('[data-section="poi"]');
    const poiCards = page.locator('.poi-card');
    const cardCount = await poiCards.count();
    
    if (cardCount > 0) {
      // 처음 3개 POI 상세정보 캐싱
      for (let i = 0; i < Math.min(3, cardCount); i++) {
        await poiCards.nth(i).click();
        await page.waitForSelector('.poi-modal', { state: 'visible' });
        await page.waitForTimeout(500);
        await page.click('.poi-modal .close-btn');
        await page.waitForSelector('.poi-modal', { state: 'hidden' });
        console.log(`✅ POI ${i + 1} 상세정보 캐시됨`);
      }
    }
    
    // 2. 오프라인 모드로 전환
    await context.setOffline(true);
    console.log('📴 오프라인 모드 전환');
    
    // 3. 페이지 새로고침으로 캐시 동작 확인
    await page.reload({ waitUntil: 'networkidle' });
    
    // 4. 오프라인에서 기본 기능 테스트
    await expect(page.locator('.main-header')).toBeVisible();
    await expect(page.locator('.main-container')).toBeVisible();
    
    // 네비게이션 테스트
    for (const section of sections) {
      await page.click(`[data-section="${section}"]`);
      await expect(page.locator(`#${section}-section.active`)).toBeVisible();
      console.log(`✅ 오프라인에서 ${section} 섹션 접근 가능`);
    }
    
    // POI 목록 확인
    await page.click('[data-section="poi"]');
    const offlinePoiCount = await page.locator('.poi-card').count();
    expect(offlinePoiCount).toBeGreaterThan(0);
    console.log(`📱 오프라인에서 ${offlinePoiCount}개 POI 이용 가능`);
    
    // 5. 온라인 복구
    await context.setOffline(false);
    console.log('📶 온라인 모드 복구');
    
    console.log('✅ 오프라인 여행 준비 완료 - 현지에서 안심하고 사용 가능');
  });

  test('시나리오 8: 마지막 날 추억 정리', async ({ page }) => {
    console.log('💭 시나리오: 여행 마지막 날 방문한 장소들 정리');
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const visitedSpots = [];
    const wishlistSpots = [];
    
    // 1. 방문한 장소 표시 (가상의 기능)
    const poiCards = page.locator('.poi-card');
    const totalPois = await poiCards.count();
    
    // 처음 5개 POI는 "방문함"으로 가정
    for (let i = 0; i < Math.min(5, totalPois); i++) {
      const poiName = await poiCards.nth(i).locator('.poi-title').textContent();
      visitedSpots.push(poiName);
      
      // 상세 정보 확인 (추억 떠올리기)
      await poiCards.nth(i).click();
      await page.waitForSelector('.poi-modal', { state: 'visible' });
      
      // 별점이나 메모 기능이 있다면 활용
      const hasRating = await page.evaluate(() => {
        const modal = document.querySelector('.poi-modal');
        return modal ? modal.textContent.includes('rating') || modal.textContent.includes('별점') : false;
      });
      
      if (hasRating) {
        console.log(`⭐ ${poiName} - 평가 가능`);
      }
      
      await page.click('.poi-modal .close-btn');
      await page.waitForSelector('.poi-modal', { state: 'hidden' });
    }
    
    // 2. 다음에 가고 싶은 장소 (위시리스트)
    const remainingPois = totalPois - 5;
    for (let i = 5; i < Math.min(8, totalPois); i++) {
      const poiName = await poiCards.nth(i).locator('.poi-title').textContent();
      wishlistSpots.push(poiName);
    }
    
    console.log(`✅ 방문한 장소 (${visitedSpots.length}개):`, visitedSpots);
    console.log(`💫 위시리스트 (${wishlistSpots.length}개):`, wishlistSpots);
    
    // 3. 여행 통계 확인 (가상)
    const travelStats = {
      totalDays: 5,
      visitedPois: visitedSpots.length,
      totalPoisAvailable: totalPois,
      completionRate: Math.round((visitedSpots.length / totalPois) * 100)
    };
    
    console.log('📊 여행 통계:', travelStats);
    expect(travelStats.completionRate).toBeGreaterThan(0);
    
    console.log('🎉 미야코지마 여행 완료! 소중한 추억이 되었습니다.');
  });

  test('시나리오 9: 친구에게 여행 정보 공유', async ({ page, context }) => {
    console.log('📤 시나리오: 친구들에게 미야코지마 여행 정보 공유하기');
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const recommendSpots = [];
    
    // 1. 추천할 만한 장소 3곳 선정
    const topPois = page.locator('.poi-card').limit(3);
    const topPoiCount = await topPois.count();
    
    for (let i = 0; i < topPoiCount; i++) {
      await topPois.nth(i).click();
      await page.waitForSelector('.poi-modal', { state: 'visible' });
      
      // 장소 정보 수집
      const poiInfo = await page.evaluate(() => {
        const modal = document.querySelector('.poi-modal');
        if (!modal) return null;
        
        const title = modal.querySelector('h3')?.textContent || '';
        const description = modal.querySelector('.description')?.textContent || '';
        const address = modal.querySelector('.address')?.textContent || '';
        
        return { title, description, address };
      });
      
      if (poiInfo && poiInfo.title) {
        recommendSpots.push(poiInfo);
        console.log(`✨ 추천 장소: ${poiInfo.title}`);
      }
      
      await page.click('.poi-modal .close-btn');
      await page.waitForSelector('.poi-modal', { state: 'hidden' });
    }
    
    // 2. 공유 기능 테스트 (가상의 기능)
    // 실제 앱에서는 공유 버튼이 있을 것
    const shareData = {
      title: '🏝️ 미야코지마 여행 추천',
      spots: recommendSpots,
      message: '정말 좋았던 미야코지마 여행지 추천! 꼭 가보세요 ✈️'
    };
    
    console.log('📱 공유 데이터 준비:', shareData);
    
    // 3. URL 공유 시뮬레이션
    const currentUrl = page.url();
    console.log(`🔗 공유 URL: ${currentUrl}`);
    
    // 새 탭에서 공유된 링크 테스트
    const newPage = await context.newPage();
    await newPage.goto(currentUrl);
    await newPage.waitForSelector('.main-container', { state: 'visible' });
    
    // 새 탭에서도 정상 동작 확인
    await newPage.click('[data-section="poi"]');
    const sharedPoiCount = await newPage.locator('.poi-card').count();
    expect(sharedPoiCount).toBeGreaterThan(0);
    
    await newPage.close();
    
    console.log('✅ 친구들과 여행 정보 공유 준비 완료');
  });

  test('시나리오 10: 재방문 계획 세우기', async ({ page }) => {
    console.log('🔄 시나리오: 다음 미야코지마 여행을 위한 계획');
    
    await page.click('[data-section="poi"]');
    await page.waitForSelector('#poi-section.active');
    
    const nextTripPlan = {
      mustVisit: [],
      seasonal: [],
      newDiscoveries: []
    };
    
    // 1. 이번에 못 가본 곳 중 꼭 가볼 곳
    const searchInput = page.locator('#poi-search');
    if (await searchInput.count() > 0) {
      // 특별한 액티비티 검색
      await searchInput.fill('다이빙');
      await page.waitForTimeout(1000);
      
      let activitySpots = await page.locator('.poi-card').count();
      if (activitySpots > 0) {
        const firstActivity = await page.locator('.poi-card').first().locator('.poi-title').textContent();
        nextTripPlan.mustVisit.push(firstActivity);
        console.log(`🤿 다음에 꼭: ${firstActivity}`);
      }
      
      // 계절 특화 장소 검색
      await searchInput.fill('축제');
      await page.waitForTimeout(1000);
      
      const seasonalSpots = await page.locator('.poi-card').count();
      if (seasonalSpots > 0) {
        const firstSeasonal = await page.locator('.poi-card').first().locator('.poi-title').textContent();
        nextTripPlan.seasonal.push(firstSeasonal);
        console.log(`🎪 계절 특화: ${firstSeasonal}`);
      }
    }
    
    // 2. 숨겨진 명소 탐색
    const categoryFilter = page.locator('#category-filter');
    if (await categoryFilter.count() > 0) {
      await categoryFilter.selectOption('hidden_gems'); // 가상의 카테고리
      await page.waitForTimeout(1000);
      
      const hiddenGems = await page.locator('.poi-card').count();
      if (hiddenGems > 0) {
        const firstHidden = await page.locator('.poi-card').first().locator('.poi-title').textContent();
        nextTripPlan.newDiscoveries.push(firstHidden);
        console.log(`💎 숨겨진 명소: ${firstHidden}`);
      }
    }
    
    // 3. 계절별 추천 확인
    const seasons = ['봄', '여름', '가을', '겨울'];
    for (const season of seasons) {
      if (await searchInput.count() > 0) {
        await searchInput.fill(season);
        await page.waitForTimeout(500);
        
        const seasonalCount = await page.locator('.poi-card').count();
        if (seasonalCount > 0) {
          console.log(`${season} 추천 장소: ${seasonalCount}개`);
        }
      }
    }
    
    // 4. 재방문 플랜 완성
    const totalNewSpots = nextTripPlan.mustVisit.length + 
                         nextTripPlan.seasonal.length + 
                         nextTripPlan.newDiscoveries.length;
    
    console.log('🗓️ 다음 여행 계획:', nextTripPlan);
    console.log(`📈 신규 탐색 장소: ${totalNewSpots}개`);
    
    expect(totalNewSpots).toBeGreaterThan(0);
    console.log('✈️ 재방문이 기대되는 미야코지마 여행 계획 완성!');
  });
});

// 헬퍼 함수들
async function simulateTyping(page, selector, text, delay = 100) {
  const input = page.locator(selector);
  await input.click();
  await input.fill('');
  
  for (const char of text) {
    await input.type(char);
    await page.waitForTimeout(delay);
  }
}

async function takeScreenshot(page, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({ 
    path: `tests/screenshots/${name}-${timestamp}.png`,
    fullPage: true 
  });
}