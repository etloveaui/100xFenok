// js/modules/budget.js
import { DataService } from '../services/data.js';

class BudgetManager {
    constructor() {
        this.budgetData = null;
        this.userExpenses = [];
        this.dailyBudget = 20000; // JPY per day
        this.exchangeRate = 8.7; // JPY to KRW
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 예산 매니저 이미 초기화됨');
            return;
        }

        try {
            console.log('🔄 예산 매니저 초기화 시작...');

            // DataService에서 예산 데이터 로드
            this.budgetData = DataService.get('budget') || {};
            this.loadUserExpenses();

            // UI 초기화
            this.initializeUI();
            this.renderBudgetDashboard();

            this.initialized = true;
            console.log('✅ 예산 매니저 초기화 완료');
        } catch (error) {
            console.error('❌ 예산 매니저 초기화 실패:', error);
            this.budgetData = { confirmed_expenses: {} };
        }
    }

    initializeUI() {
        // 지출 추가 버튼 이벤트
        const addExpenseBtn = document.getElementById('add-expense-btn');
        if (addExpenseBtn) {
            addExpenseBtn.addEventListener('click', () => {
                this.showExpenseModal();
            });
        }

        // 지출 폼 이벤트
        const expenseForm = document.getElementById('expense-form');
        if (expenseForm) {
            expenseForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleExpenseSubmit();
            });
        }

        // 모달 닫기 이벤트
        const cancelBtn = document.getElementById('cancel-expense');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideExpenseModal();
            });
        }
    }

    loadUserExpenses() {
        try {
            const saved = localStorage.getItem('miyako_user_expenses');
            this.userExpenses = saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('사용자 지출 데이터 로딩 실패:', error);
            this.userExpenses = [];
        }
    }

    saveUserExpenses() {
        try {
            localStorage.setItem('miyako_user_expenses', JSON.stringify(this.userExpenses));
        } catch (error) {
            console.error('사용자 지출 데이터 저장 실패:', error);
        }
    }

    addExpense(category, amount, description = '', location = '') {
        const expense = {
            id: Date.now(),
            category,
            amount: Number(amount),
            description,
            location,
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
        };

        this.userExpenses.push(expense);
        this.saveUserExpenses();
        this.renderBudgetDashboard();

        // 성공 알림
        this.showToast(`지출이 추가되었습니다: ${amount} JPY`);

        return expense;
    }

    removeExpense(expenseId) {
        const index = this.userExpenses.findIndex(exp => exp.id === expenseId);
        if (index !== -1) {
            this.userExpenses.splice(index, 1);
            this.saveUserExpenses();
            this.renderBudgetDashboard();
            this.showToast('지출이 삭제되었습니다');
        }
    }

    getTotalSpent() {
        return this.userExpenses.reduce((total, expense) => total + expense.amount, 0);
    }

    getTodaySpent() {
        const today = new Date().toISOString().split('T')[0];
        return this.userExpenses
            .filter(expense => expense.date === today)
            .reduce((total, expense) => total + expense.amount, 0);
    }

    getBudgetStatus() {
        const totalSpent = this.getTotalSpent();
        const totalBudget = this.dailyBudget * 5; // 5일 예산
        const percentage = (totalSpent / totalBudget) * 100;

        if (percentage < 70) return 'good';
        if (percentage < 90) return 'warning';
        return 'danger';
    }

    renderBudgetDashboard() {
        this.renderBudgetOverview();
        this.renderConfirmedExpenses();
        this.renderExpensesList();
        this.renderBudgetChart();
    }

    renderBudgetOverview() {
        const totalSpent = this.getTotalSpent();
        const todaySpent = this.getTodaySpent();
        const remainingToday = this.dailyBudget - todaySpent;
        const status = this.getBudgetStatus();

        // 대시보드 카드 업데이트
        const budgetStatus = document.getElementById('budget-status');
        const todaySpentEl = document.getElementById('today-spent');
        const todayRemainingEl = document.getElementById('today-remaining');
        const budgetProgress = document.getElementById('budget-progress');

        if (budgetStatus) {
            const statusText = {
                'good': '양호',
                'warning': '주의',
                'danger': '위험'
            };
            budgetStatus.textContent = statusText[status];
            budgetStatus.className = `budget-status ${status}`;
        }

        if (todaySpentEl) {
            todaySpentEl.textContent = `${todaySpent.toLocaleString()} 엔`;
        }

        if (todayRemainingEl) {
            todayRemainingEl.textContent = `${remainingToday.toLocaleString()} 엔`;
            todayRemainingEl.className = `budget-amount remaining ${remainingToday < 0 ? 'negative' : ''}`;
        }

        if (budgetProgress) {
            const percentage = Math.min((todaySpent / this.dailyBudget) * 100, 100);
            budgetProgress.style.width = `${percentage}%`;
            budgetProgress.className = `progress-fill budget-progress-fill ${status}`;
        }
    }

    renderConfirmedExpenses() {
        const container = document.getElementById('confirmed-activities');
        if (!container) return;

        const confirmedExpenses = this.budgetData.confirmed_expenses || {};

        container.innerHTML = `
            <h3>확정된 지출</h3>
            <div class="confirmed-expenses-grid">
                <div class="expense-card">
                    <h4>✈️ 항공료</h4>
                    <div class="expense-amount">${confirmedExpenses.flights || '855,600 KRW'}</div>
                </div>
                <div class="expense-card">
                    <h4>🏨 숙박</h4>
                    <div class="expense-amount">${confirmedExpenses.accommodation?.total || '1,630,658 KRW'}</div>
                </div>
                <div class="expense-card">
                    <h4>🚗 렌터카</h4>
                    <div class="expense-amount">${confirmedExpenses.transportation?.rental_car || '25,000 JPY'}</div>
                </div>
                <div class="expense-card">
                    <h4>🎫 야비지 투어</h4>
                    <div class="expense-amount">26,000 JPY</div>
                </div>
            </div>
        `;
    }

    renderExpensesList() {
        const container = document.getElementById('expense-list');
        if (!container) return;

        if (this.userExpenses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💰</div>
                    <p>아직 지출 내역이 없습니다</p>
                    <button class="btn-primary" onclick="budgetManager.showExpenseModal()">첫 지출 추가하기</button>
                </div>
            `;
            return;
        }

        // 최근 지출부터 표시
        const recentExpenses = [...this.userExpenses]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 10);

        container.innerHTML = recentExpenses.map(expense => `
            <div class="expense-item">
                <div class="expense-info">
                    <div class="expense-category">${this.getCategoryLabel(expense.category)}</div>
                    <div class="expense-description">${expense.description || '지출'}</div>
                    <div class="expense-meta">
                        <span class="expense-date">${this.formatDate(expense.date)}</span>
                        ${expense.location ? `<span class="expense-location">${expense.location}</span>` : ''}
                    </div>
                </div>
                <div class="expense-amount">
                    <span class="amount-jpy">${expense.amount.toLocaleString()} 엔</span>
                    <span class="amount-krw">${Math.round(expense.amount * this.exchangeRate).toLocaleString()} 원</span>
                </div>
                <button class="expense-delete" onclick="budgetManager.removeExpense(${expense.id})">
                    ×
                </button>
            </div>
        `).join('');
    }

    renderBudgetChart() {
        const canvas = document.getElementById('budget-chart');
        if (!canvas) return;

        // 간단한 차트 렌더링 (Canvas API 사용)
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // 캔버스 클리어
        ctx.clearRect(0, 0, width, height);

        // 카테고리별 지출 데이터
        const categoryTotals = this.getCategoryTotals();
        const categories = Object.keys(categoryTotals);
        const total = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);

        if (total === 0) {
            ctx.fillStyle = '#ccc';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('지출 데이터가 없습니다', width / 2, height / 2);
            return;
        }

        // 파이 차트 그리기
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2 - 20;
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7'];

        let currentAngle = 0;
        categories.forEach((category, index) => {
            const amount = categoryTotals[category];
            const angle = (amount / total) * 2 * Math.PI;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + angle);
            ctx.closePath();
            ctx.fillStyle = colors[index % colors.length];
            ctx.fill();

            currentAngle += angle;
        });
    }

    getCategoryTotals() {
        const totals = {};
        this.userExpenses.forEach(expense => {
            totals[expense.category] = (totals[expense.category] || 0) + expense.amount;
        });
        return totals;
    }

    getCategoryLabel(category) {
        const labels = {
            'meals': '식비',
            'transportation': '교통',
            'activities': '액티비티',
            'shopping': '쇼핑',
            'other': '기타'
        };
        return labels[category] || category;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    showExpenseModal() {
        const modal = document.getElementById('expense-modal');
        if (modal) {
            modal.classList.add('active');

            // 현재 위치 자동 입력 (가능하면)
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((position) => {
                    const locationInput = document.getElementById('expense-location');
                    if (locationInput && !locationInput.value) {
                        locationInput.value = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
                    }
                });
            }
        }
    }

    hideExpenseModal() {
        const modal = document.getElementById('expense-modal');
        if (modal) {
            modal.classList.remove('active');
            // 폼 리셋
            const form = document.getElementById('expense-form');
            if (form) form.reset();
        }
    }

    handleExpenseSubmit() {
        const amount = document.getElementById('expense-amount').value;
        const category = document.getElementById('expense-category').value;
        const description = document.getElementById('expense-description').value;
        const location = document.getElementById('expense-location').value;

        if (!amount || !category) {
            this.showToast('금액과 카테고리를 입력해주세요', 'error');
            return;
        }

        this.addExpense(category, amount, description, location);
        this.hideExpenseModal();
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // 3초 후 자동 제거
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // 통계 정보
    getStats() {
        return {
            totalExpenses: this.userExpenses.length,
            totalAmount: this.getTotalSpent(),
            todayAmount: this.getTodaySpent(),
            categories: Object.keys(this.getCategoryTotals()).length
        };
    }
}

// 전역 인스턴스 생성
const budgetManager = new BudgetManager();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.budgetManager = budgetManager;
}

export { BudgetManager, budgetManager };
export default budgetManager;