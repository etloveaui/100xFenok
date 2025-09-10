// 미야코지마 웹 플랫폼 - 긴급 복구 시스템
// POI 확장 과정에서 문제 발생시 즉시 롤백을 위한 자동화 스크립트

import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

/**
 * 긴급 복구 시스템 클래스
 * - 자동 문제 감지
 * - 즉시 롤백 실행
 * - 시스템 상태 복원
 */
class EmergencyRecovery {
  constructor() {
    this.config = {
      // 롤백 트리거 임계값
      thresholds: {
        maxLoadTime: 5000,      // 5초 이상시 롤백
        maxMemoryMB: 60,        // 60MB 이상시 롤백
        maxErrorRate: 0.01,     // 1% 이상 에러시 롤백
        minPOICount: 13         // 13개 미만시 롤백
      },
      
      // 백업 설정
      backup: {
        baseDir: './backups',
        retentionDays: 30,
        criticalFiles: [
          'data/miyakojima_pois.json',
          'js/poi.js',
          'index.html',
          'sw.js'
        ]
      },
      
      // 모니터링 설정
      monitoring: {
        url: 'http://localhost:3000',
        checkInterval: 30000,   // 30초마다 체크
        healthChecks: 5,        // 5회 연속 실패시 롤백
        timeout: 10000          // 10초 타임아웃
      }
    };
    
    this.backupPath = null;
    this.isRecovering = false;
    this.healthCheckFailures = 0;
  }

  /**
   * 긴급 복구 시스템 시작
   */
  async start() {
    console.log('🚨 긴급 복구 시스템 활성화');
    console.log('⏰ 모니터링 간격:', this.config.monitoring.checkInterval / 1000, '초');
    console.log('🎯 임계값:', this.config.thresholds);
    
    try {
      // 백업 디렉토리 초기화
      await this.initializeBackups();
      
      // 현재 시스템 백업 생성
      await this.createSystemBackup('emergency-start');
      
      // 연속 모니터링 시작
      this.startContinuousMonitoring();
      
    } catch (error) {
      console.error('❌ 긴급 복구 시스템 시작 실패:', error);
      throw error;
    }
  }

  /**
   * 시스템 상태 검증
   */
  async checkSystemHealth() {
    const browser = await chromium.launch({ headless: true });
    const healthStatus = {
      timestamp: new Date().toISOString(),
      url: this.config.monitoring.url,
      healthy: true,
      issues: [],
      metrics: {}
    };

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // 페이지 에러 수집
      const errors = [];
      page.on('pageerror', error => {
        errors.push({
          message: error.message,
          stack: error.stack,
          timestamp: Date.now()
        });
      });

      // 1. 페이지 로딩 시간 측정
      const startTime = Date.now();
      await page.goto(this.config.monitoring.url, { 
        waitUntil: 'networkidle',
        timeout: this.config.monitoring.timeout 
      });
      const loadTime = Date.now() - startTime;
      
      healthStatus.metrics.loadTime = loadTime;
      
      // 임계값 확인
      if (loadTime > this.config.thresholds.maxLoadTime) {
        healthStatus.healthy = false;
        healthStatus.issues.push({
          type: 'CRITICAL',
          metric: 'loadTime',
          value: loadTime,
          threshold: this.config.thresholds.maxLoadTime,
          message: `로딩 시간 초과: ${loadTime}ms > ${this.config.thresholds.maxLoadTime}ms`
        });
      }

      // 2. POI 데이터 검증
      await page.waitForFunction(() => {
        return window.poiManager && window.poiManager.pois;
      }, { timeout: 5000 });

      const poiData = await page.evaluate(() => {
        return {
          count: window.poiManager?.pois?.length || 0,
          hasErrors: window.console.error?.callCount > 0 || false
        };
      });
      
      healthStatus.metrics.poiCount = poiData.count;
      
      if (poiData.count < this.config.thresholds.minPOICount) {
        healthStatus.healthy = false;
        healthStatus.issues.push({
          type: 'CRITICAL',
          metric: 'poiCount',
          value: poiData.count,
          threshold: this.config.thresholds.minPOICount,
          message: `POI 개수 부족: ${poiData.count}개 < ${this.config.thresholds.minPOICount}개`
        });
      }

      // 3. 메모리 사용량 확인
      const memoryUsage = await page.evaluate(() => {
        if (performance.memory) {
          return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        }
        return null;
      });
      
      if (memoryUsage !== null) {
        healthStatus.metrics.memoryMB = memoryUsage;
        
        if (memoryUsage > this.config.thresholds.maxMemoryMB) {
          healthStatus.healthy = false;
          healthStatus.issues.push({
            type: 'CRITICAL',
            metric: 'memoryUsage',
            value: memoryUsage,
            threshold: this.config.thresholds.maxMemoryMB,
            message: `메모리 사용량 초과: ${memoryUsage}MB > ${this.config.thresholds.maxMemoryMB}MB`
          });
        }
      }

      // 4. JavaScript 에러 확인
      const errorRate = errors.length / (errors.length + 1);
      healthStatus.metrics.errorCount = errors.length;
      healthStatus.metrics.errorRate = errorRate;
      
      if (errorRate > this.config.thresholds.maxErrorRate) {
        healthStatus.healthy = false;
        healthStatus.issues.push({
          type: 'CRITICAL',
          metric: 'errorRate',
          value: errorRate,
          threshold: this.config.thresholds.maxErrorRate,
          message: `에러율 초과: ${(errorRate * 100).toFixed(2)}%`,
          errors: errors
        });
      }

      // 5. 핵심 기능 테스트
      try {
        // POI 섹션 네비게이션
        await page.click('[data-section="poi"]');
        await page.waitForSelector('#poi-section.active', { timeout: 3000 });
        
        // POI 목록 표시 확인
        const poiListVisible = await page.isVisible('.poi-list');
        if (!poiListVisible) {
          healthStatus.healthy = false;
          healthStatus.issues.push({
            type: 'CRITICAL',
            metric: 'functionality',
            message: 'POI 목록이 표시되지 않음'
          });
        }
        
        healthStatus.metrics.functionalityTest = poiListVisible ? 'PASS' : 'FAIL';
        
      } catch (funcError) {
        healthStatus.healthy = false;
        healthStatus.issues.push({
          type: 'CRITICAL',
          metric: 'functionality',
          message: `기능 테스트 실패: ${funcError.message}`
        });
      }

      await context.close();
      
    } catch (error) {
      healthStatus.healthy = false;
      healthStatus.issues.push({
        type: 'CRITICAL',
        metric: 'connectivity',
        message: `시스템 접근 불가: ${error.message}`
      });
      
    } finally {
      await browser.close();
    }

    return healthStatus;
  }

  /**
   * 연속 모니터링 시작
   */
  startContinuousMonitoring() {
    console.log('🔄 연속 모니터링 시작...');
    
    const monitor = async () => {
      if (this.isRecovering) {
        console.log('🔄 복구 진행 중... 모니터링 일시 중지');
        return;
      }

      try {
        const healthStatus = await this.checkSystemHealth();
        
        if (healthStatus.healthy) {
          this.healthCheckFailures = 0;
          console.log(`✅ 시스템 정상 (${new Date().toLocaleTimeString()})`);
          console.log(`   로딩: ${healthStatus.metrics.loadTime}ms, 메모리: ${healthStatus.metrics.memoryMB}MB, POI: ${healthStatus.metrics.poiCount}개`);
        } else {
          this.healthCheckFailures++;
          console.error(`❌ 시스템 문제 감지 (${this.healthCheckFailures}/${this.config.monitoring.healthChecks}):`, healthStatus.issues);
          
          // 연속 실패 임계값 도달시 자동 롤백
          if (this.healthCheckFailures >= this.config.monitoring.healthChecks) {
            console.error('🚨 연속 실패 임계값 도달 - 자동 롤백 시작');
            await this.executeEmergencyRollback(healthStatus);
          }
        }
        
        // 상태 로그 저장
        await this.logHealthStatus(healthStatus);
        
      } catch (error) {
        console.error('❌ 모니터링 중 오류:', error);
        this.healthCheckFailures++;
        
        if (this.healthCheckFailures >= this.config.monitoring.healthChecks) {
          await this.executeEmergencyRollback({ 
            issues: [{ type: 'CRITICAL', message: `모니터링 실패: ${error.message}` }] 
          });
        }
      }
      
      // 다음 체크 스케줄링
      setTimeout(monitor, this.config.monitoring.checkInterval);
    };
    
    // 첫 번째 체크 실행
    setTimeout(monitor, 1000);
  }

  /**
   * 긴급 롤백 실행
   */
  async executeEmergencyRollback(healthStatus) {
    if (this.isRecovering) {
      console.log('⚠️ 이미 복구 진행 중입니다.');
      return;
    }

    this.isRecovering = true;
    console.log('🚨 긴급 롤백 시작!');
    
    try {
      // 1. 현재 문제 상황 백업 (분석용)
      const errorBackupName = `error-${Date.now()}`;
      await this.createSystemBackup(errorBackupName);
      
      // 2. 최신 정상 백업 찾기
      const latestBackup = await this.findLatestHealthyBackup();
      if (!latestBackup) {
        throw new Error('사용 가능한 백업을 찾을 수 없습니다.');
      }
      
      console.log(`🔄 백업으로 복원 중: ${latestBackup}`);
      
      // 3. 시스템 복원
      await this.restoreFromBackup(latestBackup);
      
      // 4. 복원 후 검증
      console.log('✅ 복원 검증 중...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // 시스템 안정화 대기
      
      const postRestoreHealth = await this.checkSystemHealth();
      
      if (postRestoreHealth.healthy) {
        console.log('✅ 긴급 롤백 성공 - 시스템 정상 복원');
        
        // 5. 복구 완료 알림
        await this.notifyRecoveryComplete(healthStatus, latestBackup);
        
      } else {
        console.error('❌ 롤백 후에도 시스템 문제 지속');
        console.error('문제:', postRestoreHealth.issues);
        
        // 더 오래된 백업으로 재시도
        await this.tryOlderBackups();
      }
      
    } catch (error) {
      console.error('💥 긴급 롤백 실패:', error);
      
      // 최후 수단: 매뉴얼 복구 가이드 출력
      this.printManualRecoveryGuide();
      
    } finally {
      this.isRecovering = false;
      this.healthCheckFailures = 0;
    }
  }

  /**
   * 시스템 백업 생성
   */
  async createSystemBackup(backupName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.config.backup.baseDir, `${backupName}-${timestamp}`);
    
    try {
      await fs.mkdir(backupDir, { recursive: true });
      
      // 중요 파일들 백업
      for (const file of this.config.backup.criticalFiles) {
        try {
          const sourceFile = await fs.readFile(file);
          const backupFile = path.join(backupDir, path.basename(file));
          await fs.writeFile(backupFile, sourceFile);
        } catch (fileError) {
          console.warn(`⚠️ 파일 백업 실패: ${file}`, fileError.message);
        }
      }
      
      // 백업 메타데이터 저장
      const metadata = {
        timestamp: new Date().toISOString(),
        name: backupName,
        files: this.config.backup.criticalFiles,
        system: {
          platform: process.platform,
          nodeVersion: process.version
        }
      };
      
      await fs.writeFile(
        path.join(backupDir, 'backup-metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      
      console.log(`✅ 백업 생성 완료: ${backupDir}`);
      return backupDir;
      
    } catch (error) {
      console.error('❌ 백업 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 백업으로부터 시스템 복원
   */
  async restoreFromBackup(backupDir) {
    try {
      console.log(`🔄 복원 시작: ${backupDir}`);
      
      // 백업 메타데이터 확인
      const metadataPath = path.join(backupDir, 'backup-metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      
      console.log('백업 정보:', {
        name: metadata.name,
        timestamp: metadata.timestamp,
        files: metadata.files.length
      });
      
      // 파일들 복원
      for (const file of metadata.files) {
        const backupFile = path.join(backupDir, path.basename(file));
        
        try {
          // 기존 파일 백업 (만일의 경우)
          try {
            await fs.copyFile(file, `${file}.rollback-backup`);
          } catch (e) {
            // 원본 파일이 없는 경우 무시
          }
          
          // 백업 파일로 복원
          await fs.copyFile(backupFile, file);
          console.log(`✅ 복원 완료: ${file}`);
          
        } catch (fileError) {
          console.error(`❌ 파일 복원 실패: ${file}`, fileError.message);
          throw fileError;
        }
      }
      
      console.log('✅ 시스템 복원 완료');
      
    } catch (error) {
      console.error('❌ 시스템 복원 실패:', error);
      throw error;
    }
  }

  /**
   * 최신 정상 백업 찾기
   */
  async findLatestHealthyBackup() {
    try {
      const backupDirs = await fs.readdir(this.config.backup.baseDir);
      const validBackups = [];
      
      for (const dir of backupDirs) {
        const backupPath = path.join(this.config.backup.baseDir, dir);
        const metadataPath = path.join(backupPath, 'backup-metadata.json');
        
        try {
          await fs.access(metadataPath);
          validBackups.push({
            path: backupPath,
            name: dir
          });
        } catch (e) {
          // 메타데이터가 없는 백업은 무시
        }
      }
      
      // 최신 백업 반환 (이름에 타임스탬프 포함)
      if (validBackups.length > 0) {
        validBackups.sort((a, b) => b.name.localeCompare(a.name));
        return validBackups[0].path;
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ 백업 검색 실패:', error);
      return null;
    }
  }

  /**
   * 상태 로그 저장
   */
  async logHealthStatus(healthStatus) {
    const logDir = path.join(this.config.backup.baseDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    
    const logFile = path.join(logDir, `health-${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = `${healthStatus.timestamp}: ${healthStatus.healthy ? 'HEALTHY' : 'UNHEALTHY'} - ${JSON.stringify(healthStatus.metrics)}\n`;
    
    await fs.appendFile(logFile, logEntry);
  }

  /**
   * 복구 완료 알림
   */
  async notifyRecoveryComplete(originalIssues, restoredBackup) {
    const notification = {
      timestamp: new Date().toISOString(),
      type: 'EMERGENCY_RECOVERY_COMPLETE',
      originalIssues: originalIssues.issues,
      restoredBackup,
      systemStatus: 'HEALTHY'
    };
    
    console.log('📢 복구 완료 알림:');
    console.log(JSON.stringify(notification, null, 2));
    
    // 실제 운영에서는 여기서 Slack/Email 알림 발송
    // await this.sendSlackNotification(notification);
    // await this.sendEmailAlert(notification);
  }

  /**
   * 매뉴얼 복구 가이드 출력
   */
  printManualRecoveryGuide() {
    console.log('\n' + '='.repeat(80));
    console.log('🚨 자동 복구 실패 - 수동 복구 가이드');
    console.log('='.repeat(80));
    console.log('');
    console.log('1. 백업 확인:');
    console.log(`   ls -la ${this.config.backup.baseDir}`);
    console.log('');
    console.log('2. 최신 백업으로 수동 복원:');
    console.log('   - data/miyakojima_pois.json 복원');
    console.log('   - js/poi.js 복원');
    console.log('   - index.html 복원');
    console.log('   - sw.js 복원');
    console.log('');
    console.log('3. 서비스 재시작:');
    console.log('   - 로컬 서버 재시작');
    console.log('   - 브라우저 캐시 클리어');
    console.log('');
    console.log('4. 동작 확인:');
    console.log('   - http://localhost:3000 접속');
    console.log('   - POI 데이터 로딩 확인');
    console.log('   - 기본 기능 동작 확인');
    console.log('');
    console.log('5. 개발팀 연락: 즉시 알려주세요!');
    console.log('='.repeat(80));
  }

  /**
   * 백업 디렉토리 초기화
   */
  async initializeBackups() {
    await fs.mkdir(this.config.backup.baseDir, { recursive: true });
    await fs.mkdir(path.join(this.config.backup.baseDir, 'logs'), { recursive: true });
    
    // 오래된 백업 정리 (30일 이상)
    await this.cleanupOldBackups();
  }

  /**
   * 오래된 백업 정리
   */
  async cleanupOldBackups() {
    try {
      const backupDirs = await fs.readdir(this.config.backup.baseDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.backup.retentionDays);
      
      for (const dir of backupDirs) {
        if (dir === 'logs') continue; // logs 디렉토리는 제외
        
        const backupPath = path.join(this.config.backup.baseDir, dir);
        const stats = await fs.stat(backupPath);
        
        if (stats.mtime < cutoffDate) {
          await fs.rm(backupPath, { recursive: true, force: true });
          console.log(`🗑️ 오래된 백업 삭제: ${dir}`);
        }
      }
      
    } catch (error) {
      console.warn('⚠️ 백업 정리 중 오류:', error.message);
    }
  }
}

/**
 * CLI 실행 함수
 */
async function main() {
  const recovery = new EmergencyRecovery();
  
  try {
    // 명령줄 인수 처리
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
      case 'start':
        await recovery.start();
        break;
        
      case 'check':
        const health = await recovery.checkSystemHealth();
        console.log('시스템 상태:', health);
        process.exit(health.healthy ? 0 : 1);
        break;
        
      case 'backup':
        const backupName = args[1] || 'manual-backup';
        await recovery.createSystemBackup(backupName);
        break;
        
      case 'restore':
        const backupPath = args[1];
        if (!backupPath) {
          console.error('❌ 백업 경로를 지정해주세요.');
          process.exit(1);
        }
        await recovery.restoreFromBackup(backupPath);
        break;
        
      default:
        console.log('사용법:');
        console.log('  node emergency-recovery.js start    - 모니터링 시작');
        console.log('  node emergency-recovery.js check    - 시스템 상태 확인');
        console.log('  node emergency-recovery.js backup [name] - 수동 백업');
        console.log('  node emergency-recovery.js restore <path> - 백업 복원');
        process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 치명적 오류:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행시
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { EmergencyRecovery };