// js/app.js
import { Logger, DOMUtils } from './utils.js';

export class App {
    constructor() {
        this.isInitialized = false;
        this.modules = new Map();
    }

    async start() {
        try {
            console.log('🚀 앱 시작...');

            // 로딩 화면 표시
            this.showLoadingScreen();

            // 기본 UI 초기화
            await this.initializeUI();

            // 모듈들 로딩
            await this.loadModules();

            // 로딩 화면 숨기기
            this.hideLoadingScreen();

            this.isInitialized = true;
            console.log('✅ 앱 시작 완료');

            // 기본 대시보드 표시
            this.showDashboard();

        } catch (error) {
            console.error('❌ 앱 시작 실패:', error);
            this.showErrorMessage('앱을 시작할 수 없습니다.');
        }
    }

    showLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
            this.updateLoadingProgress(50);
        }
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            this.updateLoadingProgress(100);
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }
    }

    updateLoadingProgress(percent) {
        const progressFill = document.getElementById('progress-fill');
        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
    }

    async initializeUI() {
        // 네비게이션 버튼 이벤트 리스너 설정
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const section = e.target.closest('.nav-btn').dataset.section;
                this.showSection(section);
            });
        });

        // 빠른 액션 버튼들 설정
        this.setupQuickActions();

        console.log('✅ UI 초기화 완료');
    }

    setupQuickActions() {
        // 지출 추가 버튼
        const addExpenseBtn = document.getElementById('add-expense');
        if (addExpenseBtn) {
            addExpenseBtn.addEventListener('click', () => {
                this.showExpenseModal();
            });
        }

        // 주변 장소 버튼
        const nearbyBtn = document.getElementById('nearby-pois');
        if (nearbyBtn) {
            nearbyBtn.addEventListener('click', () => {
                this.showSection('poi');
            });
        }
    }

    async loadModules() {
        console.log('📦 모듈 로딩 중...');

        // 기본적인 더미 데이터 설정
        this.setupDummyData();

        this.updateLoadingProgress(80);
        console.log('✅ 모듈 로딩 완료');
    }

    setupDummyData() {
        // 대시보드에 기본 정보 표시
        const currentLocation = document.getElementById('current-location');
        if (currentLocation) {
            currentLocation.textContent = '미야코지마 공항';
        }

        const locationDetail = document.getElementById('location-detail');
        if (locationDetail) {
            locationDetail.textContent = '위치 확인됨';
        }

        // 예산 정보 표시
        const todaySpent = document.getElementById('today-spent');
        const todayRemaining = document.getElementById('today-remaining');
        if (todaySpent) todaySpent.textContent = '5,000 엔';
        if (todayRemaining) todayRemaining.textContent = '15,000 엔';

        // 예산 진행률 표시
        const budgetProgress = document.getElementById('budget-progress');
        if (budgetProgress) {
            budgetProgress.style.width = '25%';
        }
    }

    showSection(sectionName) {
        // 모든 섹션 숨기기
        const sections = document.querySelectorAll('.section');
        sections.forEach(section => {
            section.classList.remove('active');
        });

        // 모든 네비게이션 버튼 비활성화
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.classList.remove('active');
        });

        // 선택된 섹션 표시
        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // 선택된 네비게이션 버튼 활성화
        const targetNavBtn = document.querySelector(`[data-section="${sectionName}"]`);
        if (targetNavBtn) {
            targetNavBtn.classList.add('active');
        }

        console.log(`📱 섹션 전환: ${sectionName}`);
    }

    showDashboard() {
        this.showSection('dashboard');
    }

    showExpenseModal() {
        const modal = document.getElementById('expense-modal');
        if (modal) {
            modal.style.display = 'flex';

            // 모달 닫기 이벤트
            const closeBtn = modal.querySelector('.modal-close');
            const cancelBtn = document.getElementById('cancel-expense');

            const closeModal = () => {
                modal.style.display = 'none';
            };

            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

            // 모달 외부 클릭으로 닫기
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
        }
    }

    showErrorMessage(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #f44336;
            color: white;
            padding: 20px;
            border-radius: 8px;
            z-index: 10000;
            text-align: center;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);

        // 5초 후 자동 제거
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
}