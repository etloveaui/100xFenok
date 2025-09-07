/**
 * Google Sheets & Services Integration for Miyakojima Travel Companion
 * Google Sheets API를 통한 실시간 데이터 동기화
 */

class GoogleIntegration {
    constructor() {
        this.sheetsAPI = null;
        this.spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'; // 실제 스프레드시트 ID로 교체
        this.apiKey = 'YOUR_GOOGLE_SHEETS_API_KEY'; // 실제 API 키로 교체
        this.isInitialized = false;
        this.syncInterval = null;
        
        // 데이터 캐시
        this.cache = {
            schedule: [],
            budget: {},
            pois: [],
            lastSync: null
        };
    }

    /**
     * Google Sheets API 초기화
     */
    async initialize() {
        try {
            // Google API 라이브러리 로드
            if (!window.gapi) {
                await this.loadGoogleAPI();
            }

            await new Promise((resolve, reject) => {
                window.gapi.load('client', resolve);
            });

            await window.gapi.client.init({
                apiKey: this.apiKey,
                discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"]
            });

            this.sheetsAPI = window.gapi.client.sheets;
            this.isInitialized = true;
            
            console.log('Google Sheets API 초기화 완료');
            
            // 초기 데이터 로드
            await this.syncAllData();
            
            // 자동 동기화 시작 (30초마다)
            this.startAutoSync();
            
            return true;
            
        } catch (error) {
            console.error('Google Sheets API 초기화 실패:', error);
            this.showToast('Google Sheets 연결에 실패했습니다', 'error');
            return false;
        }
    }

    /**
     * Google API 스크립트 동적 로드
     */
    loadGoogleAPI() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * 모든 데이터 동기화
     */
    async syncAllData() {
        if (!this.isInitialized) {
            console.warn('Google Sheets API가 초기화되지 않았습니다');
            return false;
        }

        try {
            const promises = [
                this.syncScheduleData(),
                this.syncBudgetData(),
                this.syncPOIData()
            ];

            await Promise.all(promises);
            this.cache.lastSync = new Date();
            
            this.showToast('데이터 동기화 완료', 'success');
            this.updateSyncStatus();
            
            return true;
            
        } catch (error) {
            console.error('데이터 동기화 실패:', error);
            this.showToast('데이터 동기화 실패', 'error');
            return false;
        }
    }

    /**
     * 일정 데이터 동기화
     */
    async syncScheduleData() {
        try {
            const response = await this.sheetsAPI.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Schedule!A2:F100' // 일정 시트의 데이터 범위
            });

            const rows = response.result.values || [];
            this.cache.schedule = rows.map((row, index) => ({
                id: `schedule_${index}`,
                date: row[0] || '',
                time: row[1] || '',
                title: row[2] || '',
                description: row[3] || '',
                category: row[4] || 'general',
                status: row[5] || 'planned'
            }));

            // UI 업데이트
            this.updateScheduleUI();
            
        } catch (error) {
            console.error('일정 동기화 실패:', error);
            throw error;
        }
    }

    /**
     * 예산 데이터 동기화
     */
    async syncBudgetData() {
        try {
            // 예산 현황 가져오기
            const budgetResponse = await this.sheetsAPI.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Budget!A2:E100' // 예산 시트의 데이터 범위
            });

            const budgetRows = budgetResponse.result.values || [];
            let totalSpent = 0;
            const categorySpent = {};

            const expenses = budgetRows.map((row, index) => {
                const amount = parseFloat(row[2]) || 0;
                const category = row[3] || 'other';
                
                totalSpent += amount;
                categorySpent[category] = (categorySpent[category] || 0) + amount;

                return {
                    id: `expense_${index}`,
                    date: row[0] || '',
                    description: row[1] || '',
                    amount: amount,
                    category: category,
                    currency: row[4] || 'JPY'
                };
            });

            this.cache.budget = {
                total: 278000, // 총 예산 (고정값 또는 시트에서 가져오기)
                spent: totalSpent,
                remaining: 278000 - totalSpent,
                categorySpent: categorySpent,
                expenses: expenses
            };

            // UI 업데이트
            this.updateBudgetUI();
            
        } catch (error) {
            console.error('예산 동기화 실패:', error);
            throw error;
        }
    }

    /**
     * POI 데이터 동기화
     */
    async syncPOIData() {
        try {
            const response = await this.sheetsAPI.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'POIs!A2:H200' // POI 시트의 데이터 범위
            });

            const rows = response.result.values || [];
            this.cache.pois = rows.map((row, index) => ({
                id: `poi_${index}`,
                name: row[0] || '',
                category: row[1] || '',
                lat: parseFloat(row[2]) || 0,
                lng: parseFloat(row[3]) || 0,
                address: row[4] || '',
                phone: row[5] || '',
                hours: row[6] || '',
                notes: row[7] || ''
            }));

            // 지도 업데이트
            if (window.googleMap) {
                this.updateMapPOIs();
            }
            
        } catch (error) {
            console.error('POI 동기화 실패:', error);
            throw error;
        }
    }

    /**
     * 새로운 일정 추가 (Google Sheets에 저장)
     */
    async addScheduleItem(scheduleData) {
        if (!this.isInitialized) return false;

        try {
            const values = [[
                scheduleData.date,
                scheduleData.time,
                scheduleData.title,
                scheduleData.description,
                scheduleData.category,
                'planned'
            ]];

            await this.sheetsAPI.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Schedule!A:F',
                valueInputOption: 'USER_ENTERED',
                resource: { values }
            });

            // 로컬 캐시 업데이트
            this.cache.schedule.push({
                id: `schedule_${Date.now()}`,
                ...scheduleData,
                status: 'planned'
            });

            this.updateScheduleUI();
            this.showToast('일정이 추가되었습니다', 'success');
            
            return true;
            
        } catch (error) {
            console.error('일정 추가 실패:', error);
            this.showToast('일정 추가에 실패했습니다', 'error');
            return false;
        }
    }

    /**
     * 일정 수정
     */
    async updateScheduleItem(id, updatedData) {
        if (!this.isInitialized) return false;

        try {
            const index = this.cache.schedule.findIndex(item => item.id === id);
            if (index === -1) return false;

            // Google Sheets 업데이트 (행 번호는 인덱스 + 2, 헤더 행 고려)
            const rowIndex = index + 2;
            const values = [[
                updatedData.date,
                updatedData.time,
                updatedData.title,
                updatedData.description,
                updatedData.category,
                updatedData.status || 'planned'
            ]];

            await this.sheetsAPI.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Schedule!A${rowIndex}:F${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values }
            });

            // 로컬 캐시 업데이트
            this.cache.schedule[index] = { ...this.cache.schedule[index], ...updatedData };
            
            this.updateScheduleUI();
            this.showToast('일정이 수정되었습니다', 'success');
            
            return true;
            
        } catch (error) {
            console.error('일정 수정 실패:', error);
            this.showToast('일정 수정에 실패했습니다', 'error');
            return false;
        }
    }

    /**
     * 일정 삭제
     */
    async deleteScheduleItem(id) {
        if (!this.isInitialized) return false;

        try {
            const index = this.cache.schedule.findIndex(item => item.id === id);
            if (index === -1) return false;

            // Google Sheets에서 행 삭제
            const rowIndex = index + 2;
            await this.sheetsAPI.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: 0, // Schedule 시트의 ID
                                dimension: 'ROWS',
                                startIndex: rowIndex - 1,
                                endIndex: rowIndex
                            }
                        }
                    }]
                }
            });

            // 로컬 캐시에서 제거
            this.cache.schedule.splice(index, 1);
            
            this.updateScheduleUI();
            this.showToast('일정이 삭제되었습니다', 'success');
            
            return true;
            
        } catch (error) {
            console.error('일정 삭제 실패:', error);
            this.showToast('일정 삭제에 실패했습니다', 'error');
            return false;
        }
    }

    /**
     * 새로운 지출 추가
     */
    async addExpense(expenseData) {
        if (!this.isInitialized) return false;

        try {
            const values = [[
                expenseData.date || new Date().toLocaleDateString('ko-KR'),
                expenseData.description,
                expenseData.amount,
                expenseData.category,
                expenseData.currency || 'JPY'
            ]];

            await this.sheetsAPI.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Budget!A:E',
                valueInputOption: 'USER_ENTERED',
                resource: { values }
            });

            // 예산 데이터 재동기화
            await this.syncBudgetData();
            
            return true;
            
        } catch (error) {
            console.error('지출 추가 실패:', error);
            this.showToast('지출 추가에 실패했습니다', 'error');
            return false;
        }
    }

    /**
     * UI 업데이트 메서드들
     */
    updateScheduleUI() {
        const container = document.getElementById('today-schedule');
        if (!container) return;

        const today = new Date().toLocaleDateString('ko-KR');
        const todaySchedule = this.cache.schedule.filter(item => 
            item.date === today || item.date.includes(today.split('.')[2])
        );

        if (todaySchedule.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">오늘 예정된 일정이 없습니다.</div>';
            return;
        }

        container.innerHTML = todaySchedule.map(item => `
            <div class="schedule-item" data-id="${item.id}">
                <div class="schedule-time">${item.time}</div>
                <div class="schedule-content">
                    <div class="schedule-title">${item.title}</div>
                    ${item.description ? `<div class="schedule-desc">${item.description}</div>` : ''}
                </div>
                <div class="schedule-actions">
                    <button class="edit-btn" onclick="editScheduleItem('${item.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-btn" onclick="deleteScheduleItem('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    updateBudgetUI() {
        const budget = this.cache.budget;
        
        // 메인 예산 표시 업데이트
        const totalEl = document.getElementById('total-budget');
        const remainingEl = document.getElementById('budget-remaining');
        
        if (totalEl) {
            totalEl.textContent = `¥${budget.total.toLocaleString()}`;
        }
        
        if (remainingEl) {
            const remainingK = Math.round(budget.remaining / 1000);
            remainingEl.textContent = `${remainingK}`;
        }

        // 상세 예산 섹션 업데이트
        const budgetSection = document.querySelector('#budget-section .dashboard-grid');
        if (budgetSection && currentSection === 'budget') {
            this.updateDetailedBudgetUI();
        }

        // 헤더 상태바 업데이트
        const budgetStatusEl = document.getElementById('budget-remaining');
        if (budgetStatusEl) {
            budgetStatusEl.textContent = Math.round(budget.remaining / 1000);
        }
    }

    updateDetailedBudgetUI() {
        const budget = this.cache.budget;
        const spentPercentage = (budget.spent / budget.total) * 100;
        
        // 예산 상세 정보 업데이트
        const budgetDetails = document.querySelector('#budget-section .card:first-child .card-body');
        if (budgetDetails) {
            budgetDetails.innerHTML = `
                <div style="text-align: center; margin-bottom: 2rem;">
                    <div style="font-size: 2rem; font-weight: bold; color: var(--primary);">
                        ¥${budget.total.toLocaleString()}
                    </div>
                    <div style="color: var(--text-secondary);">총 예산</div>
                </div>
                
                <div style="margin-bottom: 2rem;">
                    <div style="background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 0.5rem;">
                        <div style="height: 8px; background: ${spentPercentage > 80 ? 'var(--error)' : spentPercentage > 60 ? 'var(--warning)' : 'var(--success)'}; width: ${spentPercentage}%; transition: width 0.3s ease;"></div>
                    </div>
                    <div style="text-align: center; color: var(--text-secondary); font-size: 0.875rem;">
                        ${spentPercentage.toFixed(1)}% 사용
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem;">
                    <div style="text-align: center; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--error);">¥${budget.spent.toLocaleString()}</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">사용</div>
                    </div>
                    
                    <div style="text-align: center; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--success);">¥${budget.remaining.toLocaleString()}</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">잔액</div>
                    </div>
                    
                    <div style="text-align: center; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--primary);">¥${Math.round(budget.total / 5).toLocaleString()}</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">일평균</div>
                    </div>
                </div>
            `;
        }

        // 최근 지출 내역 표시
        this.updateExpenseHistory();
    }

    updateExpenseHistory() {
        const expenseContainer = document.getElementById('expense-history');
        if (!expenseContainer || !this.cache.budget.expenses) return;

        const recentExpenses = this.cache.budget.expenses
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10);

        if (recentExpenses.length === 0) {
            expenseContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">지출 내역이 없습니다.</div>';
            return;
        }

        expenseContainer.innerHTML = recentExpenses.map(expense => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid rgba(0,0,0,0.06);">
                <div>
                    <div style="font-weight: 500;">${expense.description}</div>
                    <div style="font-size: 0.875rem; color: var(--text-secondary);">${expense.date} • ${expense.category}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: var(--error);">-¥${expense.amount.toLocaleString()}</div>
                </div>
            </div>
        `).join('');
    }

    updateMapPOIs() {
        if (!window.googleMap || !this.cache.pois) return;

        // 기존 POI 마커들 제거
        if (window.poiMarkers) {
            window.poiMarkers.forEach(marker => marker.setMap(null));
            window.poiMarkers = [];
        } else {
            window.poiMarkers = [];
        }

        // 새로운 POI 마커들 추가
        this.cache.pois.forEach(poi => {
            if (!poi.lat || !poi.lng) return;

            const marker = new google.maps.Marker({
                position: { lat: poi.lat, lng: poi.lng },
                map: window.googleMap,
                title: poi.name
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding: 15px; max-width: 300px;">
                        <h3 style="margin: 0 0 10px 0; color: var(--primary);">${poi.name}</h3>
                        <div style="margin-bottom: 8px;"><strong>카테고리:</strong> ${poi.category}</div>
                        ${poi.address ? `<div style="margin-bottom: 8px;"><strong>주소:</strong> ${poi.address}</div>` : ''}
                        ${poi.phone ? `<div style="margin-bottom: 8px;"><strong>전화:</strong> ${poi.phone}</div>` : ''}
                        ${poi.hours ? `<div style="margin-bottom: 8px;"><strong>운영시간:</strong> ${poi.hours}</div>` : ''}
                        ${poi.notes ? `<div style="margin-bottom: 12px; padding: 8px; background: #f5f5f5; border-radius: 4px;">${poi.notes}</div>` : ''}
                        <button onclick="getDirections(${poi.lat}, ${poi.lng})" 
                                style="padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 8px;">
                            길찾기
                        </button>
                        <button onclick="addToSchedule('${poi.name}', ${poi.lat}, ${poi.lng})" 
                                style="padding: 8px 16px; background: var(--success); color: white; border: none; border-radius: 4px; cursor: pointer;">
                            일정 추가
                        </button>
                    </div>
                `
            });

            marker.addListener('click', () => {
                infoWindow.open(window.googleMap, marker);
            });

            window.poiMarkers.push(marker);
        });
    }

    updateSyncStatus() {
        const syncStatus = document.getElementById('sync-status');
        if (syncStatus && this.cache.lastSync) {
            const timeAgo = this.getTimeAgo(this.cache.lastSync);
            syncStatus.textContent = `${timeAgo} 동기화`;
            syncStatus.title = `마지막 동기화: ${this.cache.lastSync.toLocaleString('ko-KR')}`;
        }
    }

    /**
     * 자동 동기화 시작
     */
    startAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(async () => {
            if (this.isInitialized && navigator.onLine) {
                console.log('자동 동기화 실행...');
                await this.syncAllData();
            }
        }, 30000); // 30초마다
    }

    /**
     * 자동 동기화 중지
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * 유틸리티 메서드들
     */
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return '방금 전';
        if (diffMins < 60) return `${diffMins}분 전`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}시간 전`;
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}일 전`;
    }

    showToast(message, type = 'info') {
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * 오프라인 모드 처리
     */
    handleOfflineMode() {
        window.addEventListener('online', () => {
            console.log('온라인 상태로 변경됨');
            this.showToast('인터넷 연결이 복원되었습니다', 'success');
            if (this.isInitialized) {
                this.syncAllData();
            }
        });

        window.addEventListener('offline', () => {
            console.log('오프라인 상태로 변경됨');
            this.showToast('오프라인 모드입니다. 연결이 복원되면 자동 동기화됩니다', 'warning');
        });
    }

    /**
     * 데이터 백업 및 복원
     */
    exportData() {
        const data = {
            schedule: this.cache.schedule,
            budget: this.cache.budget,
            pois: this.cache.pois,
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `miyakojima-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('데이터가 내보내졌습니다', 'success');
    }

    async importData(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (data.schedule) this.cache.schedule = data.schedule;
            if (data.budget) this.cache.budget = data.budget;
            if (data.pois) this.cache.pois = data.pois;

            // UI 업데이트
            this.updateScheduleUI();
            this.updateBudgetUI();
            if (window.googleMap) {
                this.updateMapPOIs();
            }

            this.showToast('데이터가 가져와졌습니다', 'success');

        } catch (error) {
            console.error('데이터 가져오기 실패:', error);
            this.showToast('데이터 가져오기에 실패했습니다', 'error');
        }
    }
}

// 전역 인스턴스 생성
window.googleIntegration = new GoogleIntegration();

// 전역 함수들 (HTML에서 호출용)
window.editScheduleItem = function(id) {
    const item = window.googleIntegration.cache.schedule.find(s => s.id === id);
    if (!item) return;

    // 간단한 편집 다이얼로그 (실제로는 더 정교한 UI 필요)
    const newTitle = prompt('일정 제목:', item.title);
    const newTime = prompt('시간 (HH:MM):', item.time);
    const newDescription = prompt('설명:', item.description);

    if (newTitle !== null) {
        window.googleIntegration.updateScheduleItem(id, {
            ...item,
            title: newTitle || item.title,
            time: newTime || item.time,
            description: newDescription || item.description
        });
    }
};

window.deleteScheduleItem = function(id) {
    if (confirm('이 일정을 삭제하시겠습니까?')) {
        window.googleIntegration.deleteScheduleItem(id);
    }
};

window.addToSchedule = function(name, lat, lng) {
    const date = prompt('날짜 (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    const time = prompt('시간 (HH:MM):', '10:00');
    
    if (date && time) {
        window.googleIntegration.addScheduleItem({
            date: date,
            time: time,
            title: `${name} 방문`,
            description: `위치: ${lat}, ${lng}`,
            category: 'sightseeing'
        });
    }
};

// 앱 시작시 Google 연동 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        window.googleIntegration.initialize();
        window.googleIntegration.handleOfflineMode();
    }, 2000);
});