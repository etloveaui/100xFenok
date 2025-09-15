// 미야코지마 웹 플랫폼 - 예산 추적 모듈
// Miyakojima Web Platform - Budget Tracking Module

/**
 * 예산 관리 클래스
 */
class BudgetManager {
    constructor() {
        this.realBudgetData = null;
        this.dailyBudget = 20000; // JPY 기본값, 실제 데이터 로드 후 업데이트
        this.categories = CONFIG.BUDGET.CATEGORIES;
        this.currentDate = DateUtils.formatDate(new Date());
        this.expenses = [];
        this.alerts = CONFIG.BUDGET.ALERTS;

        this.init();
    }
    
    async init() {
        Logger.info('예산 관리자 초기화 중...');

        // 실제 예산 데이터 로드
        await this.loadRealBudgetData();

        // 로컬 저장소에서 지출 데이터 로드
        await this.loadBudgetData();

        // UI 이벤트 리스너 설정
        this.setupEventListeners();

        // 초기 UI 업데이트
        await this.updateUI();

        // 정기 동기화 설정 (5분마다)
        setInterval(() => this.syncWithBackend(), 5 * 60 * 1000);

        Logger.info('예산 관리자 초기화 완료');
    }
    
    /**
     * 실제 예산 데이터 로드
     */
    async loadRealBudgetData() {
        try {
            const response = await fetch('./data/budget_data.json');
            if (response.ok) {
                this.realBudgetData = await response.json();

                // 실제 예산으로 업데이트
                if (this.realBudgetData.financial_info?.daily_budget) {
                    this.dailyBudget = this.realBudgetData.financial_info.daily_budget;
                }

                Logger.info('실제 예산 데이터 로드 완료:', this.realBudgetData.grand_total || '데이터 확인됨');
            }
        } catch (error) {
            Logger.warn('실제 예산 데이터 로드 실패, 기본값 사용:', error);
        }
    }

    /**
     * 로컬 저장소에서 지출 데이터 로드
     */
    async loadBudgetData() {
        try {
            const budgetData = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.BUDGET_DATA);
            
            if (budgetData) {
                this.expenses = budgetData.expenses || [];
                Logger.info('로컬 예산 데이터 로드됨:', this.expenses.length + '개 지출');
            }
            
            // 백엔드에서 최신 데이터 가져오기 시도 (백엔드 API가 준비된 경우만)
            if (NetworkUtils.isOnline() && window.backendAPI) {
                await this.syncWithBackend();
            }
            
        } catch (error) {
            Logger.error('예산 데이터 로드 실패:', error);
            this.expenses = [];
        }
    }
    
    /**
     * 백엔드와 동기화
     */
    async syncWithBackend() {
        if (!window.backendAPI) {
            Logger.warn('백엔드 API가 아직 준비되지 않았습니다.');
            return;
        }
        
        try {
            const response = await window.backendAPI.getBudgetStatus(this.currentDate);
            
            if (response && response.success) {
                this.expenses = response.data.expenses || [];
                this.saveBudgetData();
                await this.updateUI();
                Logger.info('백엔드와 예산 동기화 완료');
            }
            
        } catch (error) {
            Logger.warn('백엔드 동기화 실패, 오프라인 모드:', error);
        }
    }
    
    /**
     * 로컬 저장소에 예산 데이터 저장
     */
    saveBudgetData() {
        const budgetData = {
            expenses: this.expenses,
            lastUpdated: Date.now(),
            date: this.currentDate
        };
        
        StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.BUDGET_DATA, budgetData);
    }
    
    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 지출 추가 버튼들
        const addExpenseButtons = DOMUtils.$$('.action-btn[data-action="expense"], #add-expense, #add-expense-btn');
        addExpenseButtons.forEach(button => {
            button.addEventListener('click', () => this.showExpenseModal());
        });
        
        // 영수증 스캔 버튼
        const scanReceiptButtons = DOMUtils.$$('.action-btn[id="scan-receipt"], .fab-item[data-action="camera"]');
        scanReceiptButtons.forEach(button => {
            button.addEventListener('click', () => this.startReceiptScan());
        });
        
        // 예산 내보내기 버튼
        const exportButton = DOMUtils.$('#export-budget');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.exportBudgetData());
        }
        
        // 모달 관련 이벤트
        this.setupModalListeners();
        
        Logger.log('예산 이벤트 리스너 설정 완료');
    }
    
    /**
     * 모달 이벤트 리스너 설정
     */
    setupModalListeners() {
        const modal = DOMUtils.$('#expense-modal');
        const form = DOMUtils.$('#expense-form');
        const closeButton = DOMUtils.$('#expense-modal .modal-close');
        const cancelButton = DOMUtils.$('#cancel-expense');
        
        if (!modal || !form) return;
        
        // 폼 제출
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleExpenseSubmit(form);
        });
        
        // 모달 닫기
        [closeButton, cancelButton].forEach(button => {
            if (button) {
                button.addEventListener('click', () => this.hideExpenseModal());
            }
        });
        
        // 모달 배경 클릭으로 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideExpenseModal();
            }
        });
    }
    
    /**
     * 지출 추가 모달 표시
     */
    async showExpenseModal() {
        const modal = DOMUtils.$('#expense-modal');
        if (!modal) return;
        
        // 현재 위치 정보 가져오기
        try {
            const location = await this.getCurrentLocation();
            const locationInput = DOMUtils.$('#expense-location');
            if (locationInput && location) {
                locationInput.value = location.address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
            }
        } catch (error) {
            Logger.warn('위치 정보 가져오기 실패:', error);
        }
        
        // 폼 초기화
        const form = DOMUtils.$('#expense-form');
        if (form) {
            form.reset();
        }
        
        // 모달 표시
        modal.classList.add('open');
        
        // 첫 번째 입력 필드에 포커스
        const amountInput = DOMUtils.$('#expense-amount');
        if (amountInput) {
            setTimeout(() => amountInput.focus(), 300);
        }
    }
    
    /**
     * 지출 추가 모달 숨김
     */
    hideExpenseModal() {
        const modal = DOMUtils.$('#expense-modal');
        if (modal) {
            modal.classList.remove('open');
        }
    }
    
    /**
     * 지출 폼 제출 처리
     */
    async handleExpenseSubmit(form) {
        try {
            // 폼 유효성 검사
            const validation = FormUtils.validate(form, {
                'expense-amount': {
                    required: true,
                    min: 1,
                    max: 100000,
                    requiredMessage: '금액을 입력하세요.',
                    minMessage: '금액은 1원 이상이어야 합니다.',
                    maxMessage: '금액은 100,000원 이하여야 합니다.'
                },
                'expense-category': {
                    required: true,
                    requiredMessage: '카테고리를 선택하세요.'
                }
            });
            
            if (!validation.isValid) {
                const firstError = Object.values(validation.errors)[0];
                this.showToast(firstError, 'error');
                return;
            }
            
            // 폼 데이터 수집
            const formData = FormUtils.serialize(form);
            const expenseData = {
                amount: parseFloat(formData['expense-amount']),
                category: formData['expense-category'],
                description: formData['expense-description'] || '',
                location: formData['expense-location'] || '',
                date: this.currentDate,
                timestamp: Date.now(),
                id: 'expense_' + Date.now()
            };
            
            // 환율 변환 (환율 API가 준비된 경우만)
            if (window.exchangeAPI) {
                const exchangeRate = await window.exchangeAPI.getRate('JPY', 'KRW');
                expenseData.amount_krw = NumberUtils.convertJPYToKRW(expenseData.amount, exchangeRate);
            } else {
                expenseData.amount_krw = NumberUtils.convertJPYToKRW(expenseData.amount);
            }
            
            // 로컬에 추가
            await this.addExpense(expenseData);
            
            // 모달 닫기
            this.hideExpenseModal();
            
            // 성공 메시지
            this.showToast(`지출이 추가되었습니다: ${NumberUtils.formatCurrency(expenseData.amount)}`, 'success');
            
        } catch (error) {
            Logger.error('지출 추가 실패:', error);
            this.showToast('지출 추가에 실패했습니다.', 'error');
        }
    }
    
    /**
     * 지출 추가
     */
    async addExpense(expenseData) {
        // 로컬 배열에 추가
        this.expenses.push(expenseData);
        
        // 로컬 저장소에 저장
        this.saveBudgetData();
        
        // UI 업데이트
        await this.updateUI();
        
        // 백엔드에 전송 시도 (백엔드 API가 준비된 경우만)
        try {
            if (NetworkUtils.isOnline() && window.backendAPI) {
                await window.backendAPI.addExpense(expenseData);
                Logger.info('백엔드에 지출 데이터 전송 완료');
            } else if (window.OfflineQueue) {
                // 오프라인 큐에 추가
                window.OfflineQueue.add('add_expense', expenseData);
                Logger.info('오프라인 큐에 지출 데이터 추가됨');
            }
        } catch (error) {
            Logger.warn('백엔드 전송 실패, 오프라인 큐에 추가:', error);
            if (window.OfflineQueue) {
                window.OfflineQueue.add('add_expense', expenseData);
            }
        }
        
        // 예산 초과 확인
        this.checkBudgetAlerts();
    }
    
    /**
     * 영수증 스캔 시작
     */
    async startReceiptScan() {
        try {
            if (!('mediaDevices' in navigator)) {
                throw new Error('카메라를 지원하지 않는 기기입니다.');
            }
            
            this.showToast('카메라를 준비 중입니다...', 'info');
            
            // 카메라 스트림 가져오기
            const stream = await navigator.mediaDevices.getUserMedia({
                video: CONFIG.BROWSER_APIS.CAMERA.video
            });
            
            // 임시 비디오 요소 생성
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            
            // 캡처 모달 표시 (구현 필요)
            this.showCaptureModal(video, stream);
            
        } catch (error) {
            Logger.error('카메라 접근 실패:', error);
            this.showToast('카메라에 접근할 수 없습니다.', 'error');
        }
    }
    
    /**
     * 캡처 모달 표시 (간단한 구현)
     */
    showCaptureModal(video, stream) {
        // 임시 모달 생성 (실제로는 별도 모달 컴포넌트 구현 필요)
        const modal = document.createElement('div');
        modal.className = 'modal open';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>영수증 촬영</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div style="text-align: center;">
                    <div style="margin-bottom: 16px;"></div>
                    <button id="capture-btn" class="btn-primary">촬영</button>
                    <button id="cancel-capture" class="btn-secondary">취소</button>
                </div>
            </div>
        `;
        
        // 비디오 요소 추가
        const videoContainer = modal.querySelector('.modal-content div');
        videoContainer.insertBefore(video, videoContainer.firstChild);
        
        document.body.appendChild(modal);
        
        // 이벤트 리스너
        const captureBtn = modal.querySelector('#capture-btn');
        const cancelBtn = modal.querySelector('#cancel-capture');
        const closeBtn = modal.querySelector('.modal-close');
        
        const closeModal = () => {
            stream.getTracks().forEach(track => track.stop());
            document.body.removeChild(modal);
        };
        
        captureBtn.addEventListener('click', () => {
            this.captureReceipt(video);
            closeModal();
        });
        
        [cancelBtn, closeBtn].forEach(btn => {
            btn.addEventListener('click', closeModal);
        });
    }
    
    /**
     * 영수증 캡처 및 OCR 처리
     */
    async captureReceipt(video) {
        try {
            // Canvas에 비디오 프레임 캡처
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0);
            
            const imageData = canvas.toDataURL('image/jpeg', 0.8);
            
            this.showToast('영수증을 분석 중입니다...', 'info');
            
            // OCR 처리 (Tesseract.js 사용 - 실제로는 CDN에서 로드해야 함)
            if (window.Tesseract) {
                const result = await Tesseract.recognize(imageData, 'jpn+eng');
                const extractedText = result.data.text;
                
                // 금액 추출 시도
                const amount = this.extractAmountFromText(extractedText);
                
                if (amount > 0) {
                    // 지출 추가 모달을 미리 채워서 표시
                    this.showExpenseModal();
                    setTimeout(() => {
                        const amountInput = DOMUtils.$('#expense-amount');
                        if (amountInput) {
                            amountInput.value = amount;
                        }
                    }, 300);
                    
                    this.showToast(`금액 ${NumberUtils.formatCurrency(amount)}을 감지했습니다.`, 'success');
                } else {
                    this.showToast('금액을 인식할 수 없습니다. 수동으로 입력해주세요.', 'warning');
                    this.showExpenseModal();
                }
                
            } else {
                // Tesseract.js가 로드되지 않은 경우
                this.showToast('OCR 라이브러리가 로드되지 않았습니다. 수동으로 입력해주세요.', 'warning');
                this.showExpenseModal();
            }
            
        } catch (error) {
            Logger.error('영수증 OCR 처리 실패:', error);
            this.showToast('영수증 분석에 실패했습니다. 수동으로 입력해주세요.', 'error');
            this.showExpenseModal();
        }
    }
    
    /**
     * 텍스트에서 금액 추출
     */
    extractAmountFromText(text) {
        // 일본어 금액 패턴들
        const patterns = [
            /¥(\d{1,3}(?:,\d{3})*)/g,           // ¥1,000
            /(\d{1,3}(?:,\d{3})*)\s*円/g,       // 1,000 円
            /(\d{1,3}(?:,\d{3})*)\s*엔/g,       // 1,000 엔
            /金額\s*[:：]\s*(\d{1,3}(?:,\d{3})*)/g,  // 金額: 1,000
            /合計\s*[:：]\s*(\d{1,3}(?:,\d{3})*)/g,  // 合計: 1,000
            /小計\s*[:：]\s*(\d{1,3}(?:,\d{3})*)/g,  // 小計: 1,000
            /(\d{1,3}(?:,\d{3})*)/g             // 단순 숫자 패턴
        ];
        
        const amounts = [];
        
        patterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const numberStr = match.replace(/[^0-9,]/g, '').replace(/,/g, '');
                    const amount = parseInt(numberStr);
                    if (amount >= 10 && amount <= 50000) { // 합리적인 범위
                        amounts.push(amount);
                    }
                });
            }
        });
        
        if (amounts.length === 0) return 0;
        
        // 가장 큰 금액을 총액으로 가정
        return Math.max(...amounts);
    }
    
    /**
     * UI 업데이트
     */
    async updateUI() {
        await this.updateDashboardBudget();
        await this.updateBudgetSection();
    }
    
    /**
     * 대시보드 예산 카드 업데이트
     */
    async updateDashboardBudget() {
        const todayExpenses = this.getTodayExpenses();
        const totalSpent = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const remaining = this.dailyBudget - totalSpent;
        const percentage = NumberUtils.calculatePercentage(totalSpent, this.dailyBudget);

        // 실제 예산 정보 표시
        if (this.realBudgetData) {
            this.updateRealBudgetInfo();
        }

        // 요소 업데이트
        const spentElement = DOMUtils.$('#today-spent');
        const remainingElement = DOMUtils.$('#today-remaining');
        const progressElement = DOMUtils.$('#budget-progress');
        const statusElement = DOMUtils.$('#budget-status');
        
        if (spentElement) {
            spentElement.textContent = NumberUtils.formatCurrency(totalSpent);
        }
        
        if (remainingElement) {
            remainingElement.textContent = NumberUtils.formatCurrency(remaining);
            remainingElement.className = 'budget-amount ' + (remaining >= 0 ? 'remaining' : 'spent');
        }
        
        if (progressElement) {
            progressElement.style.width = Math.min(percentage, 100) + '%';
        }
        
        if (statusElement) {
            let status, className;
            if (percentage < this.alerts.WARNING_THRESHOLD * 100) {
                status = '양호';
                className = 'bg-success';
            } else if (percentage < this.alerts.DANGER_THRESHOLD * 100) {
                status = '주의';
                className = 'bg-warning';
            } else {
                status = '초과';
                className = 'bg-error';
            }
            
            statusElement.textContent = status;
            statusElement.className = 'budget-status ' + className;
        }
    }
    
    /**
     * 예산 섹션 업데이트
     */
    async updateBudgetSection() {
        const categoriesContainer = DOMUtils.$('#budget-categories');
        const expenseList = DOMUtils.$('#expense-list');
        
        if (categoriesContainer) {
            await this.updateBudgetCategories(categoriesContainer);
        }
        
        if (expenseList) {
            this.updateExpenseList(expenseList);
        }
    }
    
    /**
     * 카테고리별 예산 업데이트
     */
    async updateBudgetCategories(container) {
        const todayExpenses = this.getTodayExpenses();
        
        container.innerHTML = '';
        
        Object.entries(this.categories).forEach(([categoryKey, category]) => {
            const categoryExpenses = todayExpenses.filter(exp => exp.category === categoryKey);
            const spent = categoryExpenses.reduce((sum, exp) => sum + exp.amount, 0);
            const percentage = NumberUtils.calculatePercentage(spent, category.limit);
            
            const categoryElement = DOMUtils.createElement('div', 'budget-category-item', `
                <div class="category-header">
                    <span class="category-icon">${category.icon}</span>
                    <span class="category-name">${category.name}</span>
                    <span class="category-amount">${NumberUtils.formatCurrency(spent)} / ${NumberUtils.formatCurrency(category.limit)}</span>
                </div>
                <div class="category-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <span class="category-percentage">${percentage}%</span>
                </div>
            `);
            
            container.appendChild(categoryElement);
        });
    }
    
    /**
     * 지출 내역 리스트 업데이트
     */
    updateExpenseList(container) {
        const recentExpenses = this.getTodayExpenses()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 10); // 최근 10개만
        
        container.innerHTML = '';
        
        if (recentExpenses.length === 0) {
            container.innerHTML = '<p class="text-center text-secondary">오늘 지출 내역이 없습니다.</p>';
            return;
        }
        
        recentExpenses.forEach(expense => {
            const category = this.categories[expense.category];
            const expenseElement = DOMUtils.createElement('div', 'expense-item', `
                <div class="expense-info">
                    <span class="expense-icon">${category ? category.icon : '💳'}</span>
                    <div class="expense-details">
                        <div class="expense-description">${expense.description || category?.name || '기타'}</div>
                        <div class="expense-meta">
                            ${expense.location ? `📍 ${expense.location}` : ''}
                            <span class="expense-time">${DateUtils.getRelativeTime(expense.timestamp)}</span>
                        </div>
                    </div>
                </div>
                <div class="expense-amount">${NumberUtils.formatCurrency(expense.amount)}</div>
            `);
            
            container.appendChild(expenseElement);
        });
    }
    
    /**
     * 오늘 지출 내역 가져오기
     */
    getTodayExpenses() {
        return this.expenses.filter(expense => expense.date === this.currentDate);
    }
    
    /**
     * 예산 알림 확인
     */
    checkBudgetAlerts() {
        const todayExpenses = this.getTodayExpenses();
        const totalSpent = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const percentage = totalSpent / this.dailyBudget;
        
        if (percentage >= this.alerts.DANGER_THRESHOLD) {
            this.showToast(`⚠️ 일일 예산을 ${NumberUtils.calculatePercentage(totalSpent, this.dailyBudget)}% 사용했습니다!`, 'error');
            DeviceUtils.vibrate([200, 100, 200]);
        } else if (percentage >= this.alerts.WARNING_THRESHOLD) {
            this.showToast(`💰 일일 예산의 ${NumberUtils.calculatePercentage(totalSpent, this.dailyBudget)}%를 사용했습니다.`, 'warning');
        }
        
        // 카테고리별 알림 확인
        Object.entries(this.categories).forEach(([categoryKey, category]) => {
            const categoryExpenses = todayExpenses.filter(exp => exp.category === categoryKey);
            const categorySpent = categoryExpenses.reduce((sum, exp) => sum + exp.amount, 0);
            const categoryPercentage = categorySpent / category.limit;
            
            if (categoryPercentage >= 1.0) {
                this.showToast(`${category.icon} ${category.name} 예산을 초과했습니다!`, 'error');
            } else if (categoryPercentage >= 0.9) {
                this.showToast(`${category.icon} ${category.name} 예산의 90%를 사용했습니다.`, 'warning');
            }
        });
    }
    
    /**
     * 예산 데이터 내보내기
     */
    exportBudgetData() {
        const todayExpenses = this.getTodayExpenses();
        
        if (todayExpenses.length === 0) {
            this.showToast('내보낼 지출 데이터가 없습니다.', 'info');
            return;
        }
        
        // CSV 형식으로 변환
        const csvHeader = '날짜,시간,카테고리,금액(JPY),금액(KRW),설명,위치\n';
        const csvData = todayExpenses.map(expense => {
            return [
                expense.date,
                DateUtils.formatTime(new Date(expense.timestamp)),
                this.categories[expense.category]?.name || expense.category,
                expense.amount,
                expense.amount_krw || NumberUtils.convertJPYToKRW(expense.amount),
                expense.description || '',
                expense.location || ''
            ].join(',');
        }).join('\n');
        
        const csvContent = csvHeader + csvData;
        
        // 다운로드
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `miyakojima_budget_${this.currentDate}.csv`;
        link.click();
        
        this.showToast('예산 데이터가 다운로드되었습니다.', 'success');
    }
    
    /**
     * 현재 위치 가져오기
     */
    async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const coords = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    
                    try {
                        // 주소 변환 시도 (지오코딩 API가 준비된 경우만)
                        if (window.geocodingAPI) {
                            const address = await window.geocodingAPI.getAddressFromCoords(coords.lat, coords.lng);
                            resolve({
                                ...coords,
                                address: address.formatted
                            });
                        } else {
                            resolve(coords);
                        }
                    } catch (error) {
                        resolve(coords);
                    }
                },
                reject,
                CONFIG.BROWSER_APIS.GEOLOCATION
            );
        });
    }
    
    /**
     * 대시보드 요약 반환 (다른 모듈에서 사용)
     */
    getDashboardSummary() {
        const todayExpenses = this.getTodayExpenses();
        const totalSpent = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const remaining = this.dailyBudget - totalSpent;
        
        return Promise.resolve({
            spent: totalSpent,
            remaining: remaining,
            percentage: NumberUtils.calculatePercentage(totalSpent, this.dailyBudget)
        });
    }
    
    /**
     * 실제 예산 정보 업데이트
     */
    updateRealBudgetInfo() {
        if (!this.realBudgetData) return;

        const budgetInfoElement = DOMUtils.$('#real-budget-info');
        if (budgetInfoElement && this.realBudgetData.payment_split_summary) {
            const summary = this.realBudgetData.payment_split_summary;
            budgetInfoElement.innerHTML = `
                <div class="real-budget-summary">
                    <h4>실제 예산 현황</h4>
                    <div class="budget-split">
                        <div class="person-budget">
                            <strong>김은태 (페노메노)</strong>
                            <p>지불: ${summary.kim_euntai?.total_paid || 'N/A'}</p>
                            <p>현금: ${summary.kim_euntai?.cash_available || 'N/A'} JPY</p>
                            <p>카드: ${summary.kim_euntai?.card || 'N/A'}</p>
                        </div>
                        <div class="person-budget">
                            <strong>정유민 (모나)</strong>
                            <p>지불: ${summary.jeong_yumin?.total_paid || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="total-budget">
                        <strong>총 지출: ${summary.grand_total?.total_krw_paid || 'N/A'}</strong>
                        <p>남은 결제: ${summary.grand_total?.pending_jpy_payments || 'N/A'}</p>
                    </div>
                </div>
            `;
        }

        // 확정된 활동 정보 표시
        const activitiesElement = DOMUtils.$('#confirmed-activities');
        if (activitiesElement && this.realBudgetData.expense_categories?.activities?.yabiji_tour) {
            const tour = this.realBudgetData.expense_categories.activities.yabiji_tour;
            activitiesElement.innerHTML = `
                <div class="confirmed-activity">
                    <h5>확정 활동</h5>
                    <div class="activity-item">
                        <strong>야비지 투어</strong>
                        <p>날짜: ${tour.date}</p>
                        <p>금액: ${tour.amount}</p>
                        <p>상태: ${tour.status}</p>
                        <p>세부사항: ${tour.details}</p>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 토스트 알림 표시
     */
    showToast(message, type = 'info') {
        const container = DOMUtils.$('#toast-container');
        if (!container) return;

        const toast = DOMUtils.createElement('div', `toast ${type}`, `
            <span>${message}</span>
        `);

        container.appendChild(toast);

        // 애니메이션
        setTimeout(() => toast.classList.add('show'), 100);

        // 자동 제거
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, CONFIG.UI.TOAST_DURATION);
    }
}

// 전역 접근을 위한 인스턴스 생성
window.budgetManager = null;
window.BudgetTracker = BudgetManager; // 별칭

// 모듈 상태 관리
window.BudgetStatus = {
    isReady: false,
    init: async () => {
        window.budgetManager = new BudgetManager();
        window.BudgetStatus.isReady = true;
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'budget' }
        }));
        
        Logger.info('예산 관리자 초기화 완료');
    }
};

// 중앙 초기화 시스템에 의해 호출됨 (DOMContentLoaded 제거)
// document.addEventListener('DOMContentLoaded', () => {
//     window.budgetManager = new BudgetManager();
// });

Logger.info('예산 추적 모듈 로드 완료');