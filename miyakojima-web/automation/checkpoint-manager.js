// 🔄 자동 체크포인트 시스템
// 작업 진행 상황을 자동으로 저장하고 복원하는 스마트 체크포인트 매니저

class CheckpointManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.checkpointDir = `${projectPath}/checkpoints`;
    this.maxCheckpoints = 10; // 최대 체크포인트 보존 개수
    this.autoSaveInterval = 30 * 60 * 1000; // 30분마다 자동 저장
    this.contextThreshold = 80; // 컨텍스트 80% 사용 시 긴급 저장

    this.initCheckpointSystem();
  }

  /**
   * 체크포인트 시스템 초기화
   */
  initCheckpointSystem() {
    this.createCheckpointDirectory();
    this.startAutoSaveTimer();
    this.monitorContextUsage();
  }

  /**
   * 체크포인트 디렉토리 생성
   */
  createCheckpointDirectory() {
    try {
      if (typeof require !== 'undefined') {
        const fs = require('fs');
        const path = require('path');

        if (!fs.existsSync(this.checkpointDir)) {
          fs.mkdirSync(this.checkpointDir, { recursive: true });
        }
      }
    } catch (error) {
      console.warn('체크포인트 디렉토리 생성 실패:', error);
    }
  }

  /**
   * 현재 세션 상태 저장
   * @param {Object} state - 저장할 상태 정보
   * @param {string} trigger - 저장 트리거 (auto, manual, emergency, error)
   * @returns {Promise<string>} 체크포인트 ID
   */
  async saveCheckpoint(state, trigger = 'manual') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointId = `checkpoint_${timestamp}_${trigger}`;

    const checkpoint = {
      id: checkpointId,
      timestamp: new Date().toISOString(),
      trigger,
      projectInfo: this.extractProjectInfo(),
      sessionState: state.sessionState || {},
      todoList: state.todoList || [],
      workProgress: state.workProgress || {},
      contextUsage: state.contextUsage || 0,
      activeFiles: state.activeFiles || [],
      recentCommands: state.recentCommands || [],
      errorLog: state.errorLog || [],
      notes: state.notes || ''
    };

    try {
      await this.writeCheckpointFile(checkpointId, checkpoint);
      await this.updateSessionState(checkpoint);
      await this.cleanupOldCheckpoints();

      console.log(`✅ 체크포인트 저장 완료: ${checkpointId} (${trigger})`);
      return checkpointId;
    } catch (error) {
      console.error('❌ 체크포인트 저장 실패:', error);
      throw error;
    }
  }

  /**
   * 체크포인트 복원
   * @param {string} checkpointId - 복원할 체크포인트 ID (생략 시 최신)
   * @returns {Promise<Object>} 복원된 상태
   */
  async restoreCheckpoint(checkpointId = null) {
    try {
      if (!checkpointId) {
        checkpointId = await this.getLatestCheckpointId();
      }

      const checkpoint = await this.readCheckpointFile(checkpointId);

      // SESSION_STATE.md 업데이트
      await this.updateSessionStateFromCheckpoint(checkpoint);

      // TodoWrite 상태 복원
      if (checkpoint.todoList && checkpoint.todoList.length > 0) {
        await this.restoreTodoList(checkpoint.todoList);
      }

      console.log(`✅ 체크포인트 복원 완료: ${checkpointId}`);
      return checkpoint;
    } catch (error) {
      console.error('❌ 체크포인트 복원 실패:', error);
      throw error;
    }
  }

  /**
   * 프로젝트 정보 추출
   * @returns {Object} 프로젝트 기본 정보
   */
  extractProjectInfo() {
    return {
      projectName: 'miyakojima-web',
      version: 'v2.2.0-UI',
      currentBranch: 'main',
      lastCommit: this.getLastCommitInfo(),
      workingDirectory: this.projectPath
    };
  }

  /**
   * 마지막 커밋 정보 가져오기
   * @returns {Object} 커밋 정보
   */
  getLastCommitInfo() {
    try {
      if (typeof require !== 'undefined') {
        const { execSync } = require('child_process');
        const hash = execSync('git rev-parse HEAD', { cwd: this.projectPath, encoding: 'utf8' }).trim();
        const message = execSync('git log -1 --pretty=%B', { cwd: this.projectPath, encoding: 'utf8' }).trim();
        return { hash, message };
      }
    } catch (error) {
      return { hash: 'unknown', message: 'Git info unavailable' };
    }
  }

  /**
   * 체크포인트 파일 작성
   * @param {string} checkpointId - 체크포인트 ID
   * @param {Object} checkpoint - 체크포인트 데이터
   */
  async writeCheckpointFile(checkpointId, checkpoint) {
    const filePath = `${this.checkpointDir}/${checkpointId}.json`;
    const content = JSON.stringify(checkpoint, null, 2);

    if (typeof require !== 'undefined') {
      const fs = require('fs').promises;
      await fs.writeFile(filePath, content, 'utf8');
    } else {
      // 브라우저 환경에서는 localStorage 사용
      localStorage.setItem(`checkpoint_${checkpointId}`, content);
    }
  }

  /**
   * 체크포인트 파일 읽기
   * @param {string} checkpointId - 체크포인트 ID
   * @returns {Promise<Object>} 체크포인트 데이터
   */
  async readCheckpointFile(checkpointId) {
    const filePath = `${this.checkpointDir}/${checkpointId}.json`;

    if (typeof require !== 'undefined') {
      const fs = require('fs').promises;
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } else {
      // 브라우저 환경에서는 localStorage 사용
      const content = localStorage.getItem(`checkpoint_${checkpointId}`);
      return content ? JSON.parse(content) : null;
    }
  }

  /**
   * 최신 체크포인트 ID 가져오기
   * @returns {Promise<string>} 최신 체크포인트 ID
   */
  async getLatestCheckpointId() {
    try {
      if (typeof require !== 'undefined') {
        const fs = require('fs').promises;
        const files = await fs.readdir(this.checkpointDir);
        const checkpointFiles = files
          .filter(file => file.startsWith('checkpoint_') && file.endsWith('.json'))
          .sort()
          .reverse();

        if (checkpointFiles.length === 0) {
          throw new Error('저장된 체크포인트가 없습니다');
        }

        return checkpointFiles[0].replace('.json', '');
      } else {
        // 브라우저 환경
        const keys = Object.keys(localStorage).filter(key => key.startsWith('checkpoint_'));
        if (keys.length === 0) {
          throw new Error('저장된 체크포인트가 없습니다');
        }
        return keys.sort().reverse()[0].replace('checkpoint_', '');
      }
    } catch (error) {
      console.error('최신 체크포인트 찾기 실패:', error);
      throw error;
    }
  }

  /**
   * SESSION_STATE.md 업데이트
   * @param {Object} checkpoint - 체크포인트 데이터
   */
  async updateSessionState(checkpoint) {
    const sessionContent = this.generateSessionStateContent(checkpoint);
    const sessionPath = `${this.projectPath}/SESSION_STATE.md`;

    try {
      if (typeof require !== 'undefined') {
        const fs = require('fs').promises;
        await fs.writeFile(sessionPath, sessionContent, 'utf8');
      }
    } catch (error) {
      console.warn('SESSION_STATE.md 업데이트 실패:', error);
    }
  }

  /**
   * 체크포인트에서 SESSION_STATE.md 내용 생성
   * @param {Object} checkpoint - 체크포인트 데이터
   * @returns {string} SESSION_STATE.md 내용
   */
  generateSessionStateContent(checkpoint) {
    const now = new Date();
    const progress = checkpoint.workProgress || {};

    return `# 🧠 SESSION STATE - 자동 복원용

## 📍 현재 위치 (${now.toISOString().split('T')[0]})
- **프로젝트**: miyakojima-web
- **단계**: ${progress.currentStage || '1단계'} ${progress.completion || '67%'} 완료
- **체크포인트**: ${checkpoint.id}
- **트리거**: ${checkpoint.trigger}

## ✅ 완료된 작업
${this.formatCompletedTasks(progress.completedTasks || [])}

## 🔄 현재 진행 중
${this.formatInProgressTasks(progress.inProgressTasks || [])}

## 🚨 남은 작업 - 즉시 실행 필요
${this.formatPendingTasks(progress.pendingTasks || [])}

## 📋 핵심 사용자 규칙 (절대 준수)
1. **문서 필수** → 테스트 필수 → push 필수 → 버전 업데이트 필수
2. **SPEC-KIT 방법론** 적용 필수 (constitution.md, spec-template.md 등)
3. **MCP agent mode opus** 계획작업 필수
4. **작업 후 정리/삭제** 시 사용자 승인 필수
5. **시스템 구축이 우선**

## 🎯 다음 세션 즉시 할 일 (우선순위 순)
1. **SESSION_STATE.md + CORE_DNA.md 읽기** (필수)
2. **TodoWrite 확인** - 이전 작업 상태 파악
3. **체크포인트 ${checkpoint.id} 복원**
4. **작업 계속 진행**

## 💡 컨텍스트 정보
- **컨텍스트 사용량**: ${checkpoint.contextUsage}%
- **활성 파일**: ${checkpoint.activeFiles.length}개
- **최근 명령어**: ${checkpoint.recentCommands.length}개 저장됨
- **오류 로그**: ${checkpoint.errorLog.length}개 이슈

## 📝 작업 노트
${checkpoint.notes || '추가 노트 없음'}

---
*자동 생성됨 - ${checkpoint.timestamp}*`;
  }

  /**
   * 완료된 작업 포맷팅
   * @param {Array} tasks - 완료된 작업 목록
   * @returns {string} 포맷팅된 문자열
   */
  formatCompletedTasks(tasks) {
    if (tasks.length === 0) return '- 체크포인트 시점 기준 완료 작업 없음';
    return tasks.map(task => `- ✅ ${task}`).join('\n');
  }

  /**
   * 진행 중인 작업 포맷팅
   * @param {Array} tasks - 진행 중인 작업 목록
   * @returns {string} 포맷팅된 문자열
   */
  formatInProgressTasks(tasks) {
    if (tasks.length === 0) return '- 진행 중인 작업 없음';
    return tasks.map(task => `- 🔄 ${task}`).join('\n');
  }

  /**
   * 대기 중인 작업 포맷팅
   * @param {Array} tasks - 대기 중인 작업 목록
   * @returns {string} 포맷팅된 문자열
   */
  formatPendingTasks(tasks) {
    if (tasks.length === 0) return '- 대기 중인 작업 없음';
    return tasks.map(task => `- ⏳ ${task}`).join('\n');
  }

  /**
   * 오래된 체크포인트 정리
   */
  async cleanupOldCheckpoints() {
    try {
      if (typeof require !== 'undefined') {
        const fs = require('fs').promises;
        const files = await fs.readdir(this.checkpointDir);
        const checkpointFiles = files
          .filter(file => file.startsWith('checkpoint_') && file.endsWith('.json'))
          .sort()
          .reverse();

        // 최대 개수를 초과하는 체크포인트 삭제
        if (checkpointFiles.length > this.maxCheckpoints) {
          const filesToDelete = checkpointFiles.slice(this.maxCheckpoints);
          for (const file of filesToDelete) {
            await fs.unlink(`${this.checkpointDir}/${file}`);
          }
          console.log(`🧹 ${filesToDelete.length}개의 오래된 체크포인트 정리 완료`);
        }
      } else {
        // 브라우저 환경에서 localStorage 정리
        const keys = Object.keys(localStorage)
          .filter(key => key.startsWith('checkpoint_'))
          .sort()
          .reverse();

        if (keys.length > this.maxCheckpoints) {
          const keysToDelete = keys.slice(this.maxCheckpoints);
          keysToDelete.forEach(key => localStorage.removeItem(key));
        }
      }
    } catch (error) {
      console.warn('체크포인트 정리 실패:', error);
    }
  }

  /**
   * 자동 저장 타이머 시작
   */
  startAutoSaveTimer() {
    if (typeof setInterval !== 'undefined') {
      setInterval(async () => {
        try {
          const currentState = await this.getCurrentState();
          await this.saveCheckpoint(currentState, 'auto');
        } catch (error) {
          console.warn('자동 저장 실패:', error);
        }
      }, this.autoSaveInterval);
    }
  }

  /**
   * 컨텍스트 사용량 모니터링
   */
  monitorContextUsage() {
    // 실제 구현에서는 컨텍스트 API를 통해 사용량을 확인
    // 여기서는 시뮬레이션
    if (typeof setInterval !== 'undefined') {
      setInterval(async () => {
        const contextUsage = this.estimateContextUsage();

        if (contextUsage >= this.contextThreshold) {
          try {
            const emergencyState = await this.getCurrentState();
            emergencyState.contextUsage = contextUsage;
            await this.saveCheckpoint(emergencyState, 'emergency');
            console.log(`🚨 긴급 체크포인트 저장: 컨텍스트 ${contextUsage}% 사용`);
          } catch (error) {
            console.error('긴급 체크포인트 저장 실패:', error);
          }
        }
      }, 5000); // 5초마다 체크
    }
  }

  /**
   * 현재 상태 수집
   * @returns {Promise<Object>} 현재 상태
   */
  async getCurrentState() {
    return {
      sessionState: {
        timestamp: new Date().toISOString(),
        activeSession: true
      },
      todoList: [], // 실제로는 TodoWrite API에서 가져와야 함
      workProgress: {
        currentStage: '1단계 시스템 구축',
        completion: '75%',
        completedTasks: ['SESSION_STATE.md', 'CORE_DNA.md', 'PROJECT_DNA.md'],
        inProgressTasks: ['automation/ 폴더 구축'],
        pendingTasks: ['expansion/ 템플릿', 'universal-system/ 아키텍처']
      },
      contextUsage: this.estimateContextUsage(),
      activeFiles: [],
      recentCommands: [],
      errorLog: [],
      notes: '시스템 구축 60% 남음 - 자동화 및 확장 구조 구축 중'
    };
  }

  /**
   * 컨텍스트 사용량 추정 (실제로는 API에서 가져와야 함)
   * @returns {number} 추정 사용량 (0-100)
   */
  estimateContextUsage() {
    // 실제 구현에서는 컨텍스트 API 사용
    return Math.floor(Math.random() * 100);
  }
}

// 전역 체크포인트 매니저 인스턴스
const checkpointManager = new CheckpointManager('C:\\Users\\etlov\\agents-workspace\\projects\\100xFenok\\miyakojima-web');

// 모듈 내보내기
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CheckpointManager,
    checkpointManager
  };
}

// 브라우저 환경에서 전역 객체로 노출
if (typeof window !== 'undefined') {
  window.CheckpointSystem = {
    CheckpointManager,
    checkpointManager
  };
}