// 미야코지마 POI 확장 성능 모니터링 시스템
// Phase별 성능 임계값 자동 모니터링 및 알람 시스템

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

// 성능 임계값 설정 (Phase별)
const PERFORMANCE_LIMITS = {
  phase1: {
    name: '13→25개 POI',
    maxLoadTime: 2000,
    maxMemoryMB: 25,
    maxErrorRate: 0.001,
    minPOICount: 25
  },
  phase2: {
    name: '25→50개 POI', 
    maxLoadTime: 3000,
    maxMemoryMB: 35,
    maxErrorRate: 0.001,
    minPOICount: 50
  },
  phase3: {
    name: '50→100개 POI',
    maxLoadTime: 4000, 
    maxMemoryMB: 45,
    maxErrorRate: 0.001,
    minPOICount: 100
  },
  phase4: {
    name: '100→175개 POI',
    maxLoadTime: 5000,
    maxMemoryMB: 50, 
    maxErrorRate: 0.001,
    minPOICount: 175
  }
};

// 테스트 설정
const TEST_CONFIG = {
  url: 'http://localhost:3000',
  iterations: 5,
  outputDir: './tests/reports',
  alertThreshold: 0.8 // 임계값의 80% 도달시 경고
};

/**
 * 성능 모니터링 메인 클래스
 */
class PerformanceMonitor {
  constructor() {
    this.browser = null;
    this.results = [];
    this.alerts = [];
  }

  /**
   * 모니터링 시작
   */
  async start() {
    console.log('🚀 미야코지마 POI 확장 성능 모니터링 시작...');
    
    try {
      // 브라우저 초기화
      this.browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      // 리포트 디렉토리 생성
      await this.ensureReportDirectory();

      // Phase별 성능 테스트 실행
      for (const [phaseKey, phaseConfig] of Object.entries(PERFORMANCE_LIMITS)) {
        console.log(`\n📊 ${phaseConfig.name} 성능 테스트 시작...`);
        
        const phaseResults = await this.runPhaseTest(phaseKey, phaseConfig);
        this.results.push(phaseResults);
        
        // 임계값 검증 및 알람
        this.checkThresholds(phaseResults, phaseConfig);
      }

      // 결과 리포트 생성
      await this.generateReport();
      
      // 알람 처리
      if (this.alerts.length > 0) {
        await this.processAlerts();
      }

    } catch (error) {
      console.error('❌ 모니터링 중 오류 발생:', error);
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  /**
   * Phase별 성능 테스트 실행
   */
  async runPhaseTest(phaseKey, phaseConfig) {
    const context = await this.browser.newContext();
    const results = {
      phase: phaseKey,
      name: phaseConfig.name,
      timestamp: new Date().toISOString(),
      iterations: [],
      summary: {}
    };

    for (let i = 0; i < TEST_CONFIG.iterations; i++) {
      console.log(`  📋 반복 ${i + 1}/${TEST_CONFIG.iterations}...`);
      
      const page = await context.newPage();
      const iterationResult = await this.runSingleIteration(page, phaseConfig);
      results.iterations.push(iterationResult);
      
      await page.close();
      
      // 반복 간 쿨다운
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 결과 요약 계산
    results.summary = this.calculateSummary(results.iterations);
    
    await context.close();
    return results;
  }

  /**
   * 단일 반복 테스트 실행
   */
  async runSingleIteration(page, phaseConfig) {
    const errors = [];
    const consoleMessages = [];
    
    // 에러 및 로그 수집
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now()
      });
    });
    
    page.on('pageerror', error => {
      errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    });

    const startTime = Date.now();
    
    try {
      // 페이지 로딩
      await page.goto(TEST_CONFIG.url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      const navigationEnd = Date.now();
      const navigationTime = navigationEnd - startTime;

      // 메인 컨테이너 로딩 대기
      await page.waitForSelector('.main-container', { 
        state: 'visible', 
        timeout: 10000 
      });
      
      const contentVisibleTime = Date.now() - startTime;

      // POI 데이터 로딩 대기
      await page.waitForFunction(() => {
        return window.poiManager && window.poiManager.pois && window.poiManager.pois.length > 0;
      }, { timeout: 20000 });
      
      const poiLoadTime = Date.now() - startTime;

      // 성능 메트릭 수집
      const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const memory = performance.memory;
        
        return {
          // Navigation Timing
          domContentLoaded: navigation?.domContentLoadedEventEnd - navigation?.domContentLoadedEventStart || 0,
          loadComplete: navigation?.loadEventEnd - navigation?.loadEventStart || 0,
          
          // Memory Usage
          memory: memory ? {
            used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
          } : null,
          
          // POI Data
          poiCount: window.poiManager?.pois?.length || 0,
          
          // Performance Entries
          resourceCount: performance.getEntriesByType('resource').length,
          
          // Web Vitals approximation
          fcp: navigation?.responseStart ? navigation.responseStart - navigation.fetchStart : 0,
          lcp: poiLoadTime // 근사치
        };
      });

      // 상호작용 테스트
      const interactionTime = await this.testInteractions(page);

      return {
        success: true,
        timestamp: new Date().toISOString(),
        timing: {
          navigation: navigationTime,
          contentVisible: contentVisibleTime,
          poiLoad: poiLoadTime,
          interaction: interactionTime
        },
        metrics,
        errors,
        consoleMessages: consoleMessages.filter(msg => msg.type === 'error'),
        errorRate: errors.length / (errors.length + 1) // 간단한 에러율 계산
      };

    } catch (error) {
      return {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        errors,
        consoleMessages
      };
    }
  }

  /**
   * 사용자 상호작용 테스트
   */
  async testInteractions(page) {
    const startTime = Date.now();
    
    try {
      // POI 섹션으로 이동
      await page.click('[data-section="poi"]', { timeout: 5000 });
      await page.waitForSelector('#poi-section.active', { state: 'visible', timeout: 5000 });
      
      // POI 목록 로딩 대기
      await page.waitForSelector('.poi-list', { state: 'visible', timeout: 5000 });
      
      // 첫 번째 POI 클릭
      const firstPOI = page.locator('.poi-card').first();
      if (await firstPOI.count() > 0) {
        await firstPOI.click();
        await page.waitForSelector('.poi-modal', { state: 'visible', timeout: 5000 });
        
        // 모달 닫기
        await page.click('.poi-modal .close-btn');
        await page.waitForSelector('.poi-modal', { state: 'hidden', timeout: 5000 });
      }
      
      return Date.now() - startTime;
      
    } catch (error) {
      console.warn('상호작용 테스트 실패:', error.message);
      return Date.now() - startTime;
    }
  }

  /**
   * 결과 요약 계산
   */
  calculateSummary(iterations) {
    const successful = iterations.filter(i => i.success);
    
    if (successful.length === 0) {
      return { 
        successRate: 0, 
        error: '모든 반복이 실패했습니다.' 
      };
    }

    const timings = successful.map(i => i.timing);
    const memories = successful.map(i => i.metrics?.memory?.used).filter(Boolean);
    const poiCounts = successful.map(i => i.metrics?.poiCount).filter(Boolean);
    const errorRates = successful.map(i => i.errorRate || 0);

    return {
      successRate: successful.length / iterations.length,
      
      // 타이밍 통계
      timing: {
        avgNavigation: this.average(timings.map(t => t.navigation)),
        avgContentVisible: this.average(timings.map(t => t.contentVisible)),
        avgPoiLoad: this.average(timings.map(t => t.poiLoad)),
        maxPoiLoad: Math.max(...timings.map(t => t.poiLoad)),
        minPoiLoad: Math.min(...timings.map(t => t.poiLoad))
      },
      
      // 메모리 통계
      memory: memories.length > 0 ? {
        avg: this.average(memories),
        max: Math.max(...memories),
        min: Math.min(...memories)
      } : null,
      
      // POI 개수 통계
      poiCount: {
        avg: this.average(poiCounts),
        max: Math.max(...poiCounts),
        min: Math.min(...poiCounts)
      },
      
      // 에러율 통계
      errorRate: {
        avg: this.average(errorRates),
        max: Math.max(...errorRates)
      }
    };
  }

  /**
   * 임계값 검증 및 알람 생성
   */
  checkThresholds(results, phaseConfig) {
    const { summary } = results;
    const alerts = [];

    // 로딩 시간 검증
    if (summary.timing?.maxPoiLoad > phaseConfig.maxLoadTime) {
      alerts.push({
        type: 'CRITICAL',
        metric: 'Load Time',
        value: summary.timing.maxPoiLoad,
        threshold: phaseConfig.maxLoadTime,
        message: `로딩 시간이 임계값을 초과했습니다: ${summary.timing.maxPoiLoad}ms > ${phaseConfig.maxLoadTime}ms`
      });
    } else if (summary.timing?.maxPoiLoad > phaseConfig.maxLoadTime * TEST_CONFIG.alertThreshold) {
      alerts.push({
        type: 'WARNING',
        metric: 'Load Time',
        value: summary.timing.maxPoiLoad,
        threshold: phaseConfig.maxLoadTime * TEST_CONFIG.alertThreshold,
        message: `로딩 시간이 경고 수준에 도달했습니다: ${summary.timing.maxPoiLoad}ms`
      });
    }

    // 메모리 사용량 검증
    if (summary.memory?.max > phaseConfig.maxMemoryMB) {
      alerts.push({
        type: 'CRITICAL',
        metric: 'Memory Usage',
        value: summary.memory.max,
        threshold: phaseConfig.maxMemoryMB,
        message: `메모리 사용량이 임계값을 초과했습니다: ${summary.memory.max}MB > ${phaseConfig.maxMemoryMB}MB`
      });
    }

    // 에러율 검증
    if (summary.errorRate?.max > phaseConfig.maxErrorRate) {
      alerts.push({
        type: 'CRITICAL',
        metric: 'Error Rate',
        value: summary.errorRate.max,
        threshold: phaseConfig.maxErrorRate,
        message: `에러율이 임계값을 초과했습니다: ${(summary.errorRate.max * 100).toFixed(2)}%`
      });
    }

    // POI 개수 검증
    if (summary.poiCount?.min < phaseConfig.minPOICount) {
      alerts.push({
        type: 'CRITICAL',
        metric: 'POI Count',
        value: summary.poiCount.min,
        threshold: phaseConfig.minPOICount,
        message: `POI 개수가 예상보다 적습니다: ${summary.poiCount.min}개 < ${phaseConfig.minPOICount}개`
      });
    }

    // 성공률 검증
    if (summary.successRate < 0.9) {
      alerts.push({
        type: 'CRITICAL',
        metric: 'Success Rate',
        value: summary.successRate,
        threshold: 0.9,
        message: `테스트 성공률이 낮습니다: ${(summary.successRate * 100).toFixed(1)}%`
      });
    }

    // 알람 추가
    this.alerts.push(...alerts.map(alert => ({
      ...alert,
      phase: results.phase,
      phaseName: results.name,
      timestamp: new Date().toISOString()
    })));

    // 즉시 출력
    if (alerts.length > 0) {
      console.log(`\n🚨 ${results.name} 알람 발생:`);
      alerts.forEach(alert => {
        const icon = alert.type === 'CRITICAL' ? '🔴' : '🟡';
        console.log(`  ${icon} ${alert.message}`);
      });
    } else {
      console.log(`✅ ${results.name} 모든 임계값 통과`);
    }
  }

  /**
   * 리포트 생성
   */
  async generateReport() {
    const reportData = {
      timestamp: new Date().toISOString(),
      config: TEST_CONFIG,
      limits: PERFORMANCE_LIMITS,
      results: this.results,
      alerts: this.alerts,
      summary: this.generateOverallSummary()
    };

    // JSON 리포트
    const jsonPath = path.join(TEST_CONFIG.outputDir, `performance-report-${Date.now()}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(reportData, null, 2));

    // HTML 리포트
    const htmlPath = path.join(TEST_CONFIG.outputDir, `performance-report-${Date.now()}.html`);
    await fs.writeFile(htmlPath, this.generateHTMLReport(reportData));

    console.log(`\n📊 리포트 생성 완료:`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  HTML: ${htmlPath}`);
  }

  /**
   * 전체 요약 생성
   */
  generateOverallSummary() {
    const criticalAlerts = this.alerts.filter(a => a.type === 'CRITICAL');
    const warningAlerts = this.alerts.filter(a => a.type === 'WARNING');

    return {
      totalPhases: this.results.length,
      passedPhases: this.results.filter(r => {
        const phaseAlerts = this.alerts.filter(a => a.phase === r.phase && a.type === 'CRITICAL');
        return phaseAlerts.length === 0;
      }).length,
      criticalAlerts: criticalAlerts.length,
      warningAlerts: warningAlerts.length,
      overallHealth: criticalAlerts.length === 0 ? 'HEALTHY' : 'CRITICAL'
    };
  }

  /**
   * HTML 리포트 생성
   */
  generateHTMLReport(data) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>미야코지마 POI 확장 성능 리포트</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .card.critical { border-left-color: #dc3545; background: #fff5f5; }
        .card.warning { border-left-color: #ffc107; background: #fffbf0; }
        .card.success { border-left-color: #28a745; background: #f8fff8; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .metric-value { font-weight: bold; }
        .good { color: #28a745; }
        .warning { color: #ffc107; }
        .critical { color: #dc3545; }
        .alert { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert.critical { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .alert.warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏝️ 미야코지마 POI 확장 성능 리포트</h1>
        <p><strong>생성 시간:</strong> ${new Date(data.timestamp).toLocaleString('ko-KR')}</p>
        
        <div class="summary">
            <div class="card ${data.summary.overallHealth === 'HEALTHY' ? 'success' : 'critical'}">
                <h3>전체 상태</h3>
                <p class="metric-value">${data.summary.overallHealth}</p>
            </div>
            <div class="card">
                <h3>테스트된 Phase</h3>
                <p class="metric-value">${data.summary.totalPhases}</p>
            </div>
            <div class="card ${data.summary.criticalAlerts === 0 ? 'success' : 'critical'}">
                <h3>심각한 알람</h3>
                <p class="metric-value">${data.summary.criticalAlerts}</p>
            </div>
            <div class="card ${data.summary.warningAlerts === 0 ? 'success' : 'warning'}">
                <h3>경고 알람</h3>
                <p class="metric-value">${data.summary.warningAlerts}</p>
            </div>
        </div>

        <h2>Phase별 성능 결과</h2>
        <table>
            <thead>
                <tr>
                    <th>Phase</th>
                    <th>성공률</th>
                    <th>평균 로딩 시간</th>
                    <th>최대 메모리</th>
                    <th>POI 개수</th>
                    <th>상태</th>
                </tr>
            </thead>
            <tbody>
                ${data.results.map(result => {
                  const phaseAlerts = data.alerts.filter(a => a.phase === result.phase && a.type === 'CRITICAL');
                  const status = phaseAlerts.length === 0 ? '✅ 통과' : '❌ 실패';
                  const statusClass = phaseAlerts.length === 0 ? 'good' : 'critical';
                  
                  return `
                    <tr>
                        <td>${result.name}</td>
                        <td>${(result.summary.successRate * 100).toFixed(1)}%</td>
                        <td>${result.summary.timing?.avgPoiLoad?.toFixed(0) || 'N/A'}ms</td>
                        <td>${result.summary.memory?.max || 'N/A'}MB</td>
                        <td>${result.summary.poiCount?.avg?.toFixed(0) || 'N/A'}개</td>
                        <td class="${statusClass}">${status}</td>
                    </tr>
                  `;
                }).join('')}
            </tbody>
        </table>

        ${data.alerts.length > 0 ? `
        <h2>발생한 알람</h2>
        ${data.alerts.map(alert => `
            <div class="alert ${alert.type.toLowerCase()}">
                <strong>${alert.type === 'CRITICAL' ? '🔴' : '🟡'} ${alert.phaseName}</strong><br>
                ${alert.message}
                <br><small>${new Date(alert.timestamp).toLocaleString('ko-KR')}</small>
            </div>
        `).join('')}
        ` : '<h2>✅ 알람 없음</h2>'}
        
        <h2>상세 데이터</h2>
        <details>
            <summary>원시 데이터 보기</summary>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        </details>
    </div>
</body>
</html>
    `;
  }

  /**
   * 알람 처리
   */
  async processAlerts() {
    console.log('\n🚨 알람 처리 중...');
    
    const criticalAlerts = this.alerts.filter(a => a.type === 'CRITICAL');
    
    if (criticalAlerts.length > 0) {
      console.log('❌ 심각한 문제 감지 - 즉시 개발팀에 알려야 합니다:');
      criticalAlerts.forEach(alert => {
        console.log(`  🔴 ${alert.phaseName}: ${alert.message}`);
      });
      
      // 실제 환경에서는 여기서 Slack/Email 알람을 보낼 수 있음
      // await this.sendSlackAlert(criticalAlerts);
      
      return false; // 실패 상태
    }
    
    return true; // 성공 상태
  }

  /**
   * 유틸리티 함수들
   */
  average(numbers) {
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  async ensureReportDirectory() {
    try {
      await fs.mkdir(TEST_CONFIG.outputDir, { recursive: true });
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  const monitor = new PerformanceMonitor();
  
  try {
    const success = await monitor.start();
    
    if (success === false) {
      process.exit(1); // CI/CD에서 실패로 처리
    }
    
    console.log('\n✅ 성능 모니터링 완료');
    
  } catch (error) {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행시
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PerformanceMonitor, PERFORMANCE_LIMITS };