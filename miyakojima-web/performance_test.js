import { chromium } from 'playwright';

async function testMiyakojimaApp() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // 콘솔 로그와 에러 수집
    const consoleMessages = [];
    const errors = [];
    
    page.on('console', msg => {
        consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
        errors.push(error.message);
    });
    
    console.log('🚀 Starting Miyakojima app performance test...');
    
    try {
        // 1. 페이지 로딩 시간 측정
        const startTime = Date.now();
        await page.goto('http://localhost:8001/index.html', { 
            waitUntil: 'networkidle',
            timeout: 15000 
        });
        const loadTime = Date.now() - startTime;
        
        console.log(`⏱️ Page load time: ${loadTime}ms`);
        
        // 2. 로딩 상태 확인
        const loadingIndicator = page.locator('#loadingIndicator');
        const isLoadingVisible = await loadingIndicator.isVisible().catch(() => false);
        console.log(`🔄 Loading indicator visible: ${isLoadingVisible}`);
        
        // 3. 메인 콘텐츠가 표시되는지 확인 (최대 10초 대기)
        const mainContent = page.locator('.container');
        try {
            await mainContent.waitFor({ state: 'visible', timeout: 10000 });
            console.log('✅ Main content loaded successfully');
        } catch (e) {
            console.log('❌ Main content failed to load within 10 seconds');
        }
        
        // 4. 각 섹션 요소들이 표시되는지 확인
        const sections = [
            { name: 'Hero Section', selector: '.hero' },
            { name: 'Intro Section', selector: '.intro' },
            { name: 'Activities Section', selector: '.activities' },
            { name: 'Food Section', selector: '.food' },
            { name: 'Access Section', selector: '.access' }
        ];
        
        console.log('\n📋 Section visibility check:');
        for (const section of sections) {
            const element = page.locator(section.selector);
            const isVisible = await element.isVisible().catch(() => false);
            const count = await element.count().catch(() => 0);
            console.log(`  ${isVisible ? '✅' : '❌'} ${section.name}: visible=${isVisible}, count=${count}`);
        }
        
        // 5. 네비게이션 테스트
        console.log('\n🧭 Testing navigation:');
        const navLinks = page.locator('nav a');
        const navCount = await navLinks.count();
        console.log(`  Nav links found: ${navCount}`);
        
        if (navCount > 0) {
            // 첫 번째 네비게이션 링크 클릭 테스트
            const firstNavText = await navLinks.first().textContent();
            console.log(`  Clicking first nav link: "${firstNavText}"`);
            await navLinks.first().click();
            await page.waitForTimeout(1000); // 애니메이션 대기
            console.log('  ✅ Navigation click successful');
        }
        
        // 6. 스크립트 로딩 상태 확인
        console.log('\n📜 Script loading status:');
        const scripts = await page.locator('script[src]').all();
        for (const script of scripts) {
            const src = await script.getAttribute('src');
            if (src) {
                console.log(`  Script: ${src}`);
            }
        }
        
        // 7. 최종 페이지 상태 스크린샷
        await page.screenshot({ 
            path: 'miyakojima-test-result.png', 
            fullPage: true 
        });
        console.log('📸 Screenshot saved as miyakojima-test-result.png');
        
        // 8. 콘솔 메시지 출력
        console.log('\n📝 Console messages:');
        consoleMessages.forEach(msg => {
            console.log(`  ${msg}`);
        });
        
        // 9. 에러 출력
        if (errors.length > 0) {
            console.log('\n🚨 Errors found:');
            errors.forEach(error => {
                console.log(`  ❌ ${error}`);
            });
        } else {
            console.log('\n✅ No JavaScript errors found');
        }
        
        // 10. 성능 메트릭
        const performanceMetrics = await page.evaluate(() => {
            const navigation = performance.getEntriesByType('navigation')[0];
            return {
                domContentLoaded: Math.round(navigation.domContentLoadedEventEnd - navigation.navigationStart),
                loadComplete: Math.round(navigation.loadEventEnd - navigation.navigationStart),
                firstPaint: Math.round(performance.getEntriesByName('first-paint')[0]?.startTime || 0),
                firstContentfulPaint: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0)
            };
        });
        
        console.log('\n⚡ Performance metrics:');
        console.log(`  DOM Content Loaded: ${performanceMetrics.domContentLoaded}ms`);
        console.log(`  Load Complete: ${performanceMetrics.loadComplete}ms`);
        console.log(`  First Paint: ${performanceMetrics.firstPaint}ms`);
        console.log(`  First Contentful Paint: ${performanceMetrics.firstContentfulPaint}ms`);
        
        // 테스트 결과 요약
        console.log('\n🎯 Test Summary:');
        console.log(`  ⏱️ Total load time: ${loadTime}ms`);
        console.log(`  ${loadTime <= 10000 ? '✅' : '❌'} Load time target (≤10s): ${loadTime <= 10000 ? 'PASSED' : 'FAILED'}`);
        console.log(`  ${errors.length === 0 ? '✅' : '❌'} Error count: ${errors.length}`);
        console.log(`  ${navCount > 0 ? '✅' : '❌'} Navigation elements: ${navCount} found`);
        
        // 브라우저를 5초간 열어두어 시각적으로 확인 가능하도록
        console.log('\n⏳ Keeping browser open for 5 seconds for visual inspection...');
        await page.waitForTimeout(5000);
        
    } catch (error) {
        console.error('🚨 Test failed:', error.message);
        await page.screenshot({ path: 'miyakojima-error.png' });
    } finally {
        await browser.close();
        console.log('🏁 Test completed');
    }
}

// 테스트 실행
testMiyakojimaApp().catch(console.error);