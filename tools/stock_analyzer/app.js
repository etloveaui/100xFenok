/**
 * 메인 애플리케이션 파일
 * 모듈화된 구조로 애플리케이션 초기화
 */

// 모듈 임포트 (ES6 모듈 사용)
import ModuleLoader from './modules/ModuleLoader.js';
import DataManager from './modules/DataManager.js';
import UIManager from './modules/UIManager.js';

class StockAnalyzerApp {
    constructor() {
        this.moduleLoader = new ModuleLoader();
        this.dataManager = null;
        this.uiManager = null;
        
        this.init();
    }
    
    /**
     * 애플리케이션 초기화
     */
    async init() {
        console.log("StockAnalyzerApp: Initializing...");
        
        try {
            // 모듈 등록
            this.registerModules();
            
            // 모듈 로딩
            await this.loadModules();
            
            // 데이터 로딩
            await this.loadData();
            
            console.log("StockAnalyzerApp: Initialization complete!");
            
        } catch (error) {
            console.error("StockAnalyzerApp: Initialization failed:", error);
            this.showInitializationError(error);
        }
    }
    
    /**
     * 모듈 등록
     */
    registerModules() {
        console.log("StockAnalyzerApp: Registering modules...");
        
        // DataManager 등록 (의존성 없음)
        this.moduleLoader.register('dataManager', DataManager, []);
        
        // UIManager 등록 (DataManager 의존)
        this.moduleLoader.register('uiManager', UIManager, ['dataManager']);
    }
    
    /**
     * 모듈 로딩
     */
    async loadModules() {
        console.log("StockAnalyzerApp: Loading modules...");
        
        // DataManager 로딩
        this.dataManager = await this.moduleLoader.load('dataManager');
        
        // UIManager 로딩
        this.uiManager = await this.moduleLoader.load('uiManager');
        
        // 전역 참조 설정 (기존 코드 호환성)
        window.dataManager = this.dataManager;
        window.uiManager = this.uiManager;
        
        console.log("StockAnalyzerApp: All modules loaded successfully");
    }
    
    /**
     * 데이터 로딩
     */
    async loadData() {
        console.log("StockAnalyzerApp: Loading data...");
        
        // 로딩 상태 표시
        this.uiManager.showLoadingState('강화된 데이터를 로딩 중입니다... (31개 지표)');
        
        // 데이터 및 인덱스 로딩
        await Promise.all([
            this.dataManager.loadData(),
            this.dataManager.loadScreenerIndices()
        ]);
        
        console.log("StockAnalyzerApp: Data loading complete");
    }
    
    /**
     * 초기화 오류 표시
     */
    showInitializationError(error) {
        const errorContainer = document.getElementById('results-count') || document.body;
        
        errorContainer.innerHTML = `
            <div class="bg-red-50 border border-red-200 rounded-lg p-4 m-4">
                <h3 class="text-red-800 font-bold mb-2">애플리케이션 초기화 실패</h3>
                <p class="text-red-700 mb-3">${error.message}</p>
                <button onclick="location.reload()" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
                    다시 시도
                </button>
            </div>
        `;
    }
    
    /**
     * 애플리케이션 통계
     */
    getStats() {
        if (!this.dataManager) return null;
        
        return {
            ...this.dataManager.getStats(),
            modules: {
                loaded: this.moduleLoader.loadedModules.size,
                registered: this.moduleLoader.modules.size
            }
        };
    }
}

// DOM 로딩 완료 시 애플리케이션 시작
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded, starting Stock Analyzer App...");
    window.stockAnalyzerApp = new StockAnalyzerApp();
});

export default StockAnalyzerApp;