/**
 * PortfolioManager - 드래그 앤 드롭 포트폴리오 빌더
 */

class PortfolioManager {
    constructor() {
        this.portfolio = new Map();
        this.totalValue = 0;
        this.isDragging = false;
        this.draggedCompany = null;
        
        console.log('💼 PortfolioManager 초기화');
    }

    /**
     * 포트폴리오 시스템 초기화
     */
    initialize() {
        this.createPortfolioUI();
        this.setupDragAndDrop();
        this.loadSavedPortfolio();
        
        console.log('✅ 포트폴리오 시스템 초기화 완료');
    }

    /**
     * 포트폴리오 UI 생성
     */
    createPortfolioUI() {
        // 포트폴리오 탭 내용 업데이트
        const portfolioContent = document.getElementById('portfolio-content');
        if (!portfolioContent) return;

        portfolioContent.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- 포트폴리오 빌더 -->
                <div class="lg:col-span-2">
                    <div class="dashboard-card">
                        <h3 class="text-xl font-bold mb-4 text-gray-900">
                            <i class="fas fa-briefcase text-blue-600 mr-2"></i>
                            내 포트폴리오
                            <span class="text-sm font-normal text-gray-600 ml-2" id="portfolio-count">0개 종목</span>
                        </h3>
                        
                        <!-- 드롭 존 -->
                        <div id="portfolio-drop-zone" class="min-h-64 border-2 border-dashed border-gray-300 rounded-lg p-6 mb-4 transition-colors">
                            <div id="empty-portfolio" class="text-center text-gray-500">
                                <i class="fas fa-plus-circle text-4xl mb-4 text-gray-300"></i>
                                <p class="text-lg font-medium mb-2">포트폴리오를 구성해보세요</p>
                                <p class="text-sm">테이블에서 종목을 드래그하여 여기에 놓으세요</p>
                            </div>
                            
                            <div id="portfolio-items" class="grid grid-cols-1 md:grid-cols-2 gap-4" style="display: none;">
                                <!-- 포트폴리오 아이템들이 여기에 추가됩니다 -->
                            </div>
                        </div>
                        
                        <!-- 포트폴리오 액션 -->
                        <div class="flex gap-3">
                            <button id="rebalance-btn" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors" disabled>
                                <i class="fas fa-balance-scale mr-2"></i>리밸런싱
                            </button>
                            <button id="analyze-btn" class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors" disabled>
                                <i class="fas fa-chart-line mr-2"></i>분석
                            </button>
                            <button id="save-portfolio-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors" disabled>
                                <i class="fas fa-save mr-2"></i>저장
                            </button>
                            <button id="clear-portfolio-btn" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors" disabled>
                                <i class="fas fa-trash mr-2"></i>초기화
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- 포트폴리오 통계 -->
                <div class="space-y-6">
                    <!-- 요약 통계 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-4 text-gray-900">
                            <i class="fas fa-chart-pie text-green-600 mr-2"></i>포트폴리오 요약
                        </h4>
                        <div class="space-y-3">
                            <div class="flex justify-between">
                                <span class="text-gray-600">총 종목 수</span>
                                <span id="total-stocks" class="font-bold">0</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">총 시가총액</span>
                                <span id="total-market-cap" class="font-bold">$0</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">평균 PER</span>
                                <span id="avg-per" class="font-bold">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">평균 ROE</span>
                                <span id="avg-roe" class="font-bold">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">리스크 점수</span>
                                <span id="risk-score" class="font-bold text-yellow-600">-</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 섹터 분산 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-4 text-gray-900">
                            <i class="fas fa-chart-donut text-purple-600 mr-2"></i>섹터 분산
                        </h4>
                        <div id="sector-distribution">
                            <div class="text-center text-gray-500 py-8">
                                <i class="fas fa-chart-pie text-2xl mb-2"></i>
                                <p class="text-sm">종목을 추가하면 섹터 분산을 확인할 수 있습니다</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 추천 종목 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-4 text-gray-900">
                            <i class="fas fa-lightbulb text-yellow-600 mr-2"></i>추천 종목
                        </h4>
                        <div id="recommended-stocks">
                            <div class="text-center text-gray-500 py-8">
                                <i class="fas fa-magic text-2xl mb-2"></i>
                                <p class="text-sm">포트폴리오 분석 후 추천 종목을 제안합니다</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setupPortfolioEvents();
    }   
 /**
     * 포트폴리오 이벤트 설정
     */
    setupPortfolioEvents() {
        // 리밸런싱 버튼
        document.getElementById('rebalance-btn')?.addEventListener('click', () => {
            this.rebalancePortfolio();
        });

        // 분석 버튼
        document.getElementById('analyze-btn')?.addEventListener('click', () => {
            this.analyzePortfolio();
        });

        // 저장 버튼
        document.getElementById('save-portfolio-btn')?.addEventListener('click', () => {
            this.savePortfolio();
        });

        // 초기화 버튼
        document.getElementById('clear-portfolio-btn')?.addEventListener('click', () => {
            this.clearPortfolio();
        });
    }

    /**
     * 드래그 앤 드롭 설정
     */
    setupDragAndDrop() {
        // 테이블 행에 드래그 가능 속성 추가
        this.makeTableRowsDraggable();
        
        // 드롭 존 설정
        this.setupDropZone();
        
        console.log('🖱️ 드래그 앤 드롭 시스템 설정 완료');
    }

    /**
     * 테이블 행을 드래그 가능하게 만들기
     */
    makeTableRowsDraggable() {
        const observer = new MutationObserver(() => {
            const tableRows = document.querySelectorAll('#results-table tbody tr');
            tableRows.forEach(row => {
                if (!row.hasAttribute('draggable')) {
                    row.setAttribute('draggable', 'true');
                    row.classList.add('cursor-move');
                    
                    row.addEventListener('dragstart', (e) => {
                        this.handleDragStart(e);
                    });
                    
                    row.addEventListener('dragend', (e) => {
                        this.handleDragEnd(e);
                    });
                }
            });
        });

        // 테이블 변경 감지
        const tableContainer = document.getElementById('results-table');
        if (tableContainer) {
            observer.observe(tableContainer, { childList: true, subtree: true });
        }
    }

    /**
     * 드롭 존 설정
     */
    setupDropZone() {
        const dropZone = document.getElementById('portfolio-drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-blue-500', 'bg-blue-50');
        });

        dropZone.addEventListener('dragleave', (e) => {
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove('border-blue-500', 'bg-blue-50');
            }
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-blue-500', 'bg-blue-50');
            this.handleDrop(e);
        });
    }

    /**
     * 드래그 시작 처리
     */
    handleDragStart(e) {
        this.isDragging = true;
        
        // 드래그된 행에서 회사 데이터 추출
        const row = e.target.closest('tr');
        const ticker = row.cells[0]?.textContent?.trim();
        
        if (ticker && window.allData) {
            this.draggedCompany = window.allData.find(company => company.Ticker === ticker);
            
            if (this.draggedCompany) {
                e.dataTransfer.setData('text/plain', ticker);
                e.dataTransfer.effectAllowed = 'copy';
                
                // 드래그 이미지 커스터마이징
                row.style.opacity = '0.5';
                
                console.log(`🖱️ 드래그 시작: ${ticker}`);
            }
        }
    }

    /**
     * 드래그 종료 처리
     */
    handleDragEnd(e) {
        this.isDragging = false;
        e.target.style.opacity = '';
    }

    /**
     * 드롭 처리
     */
    handleDrop(e) {
        const ticker = e.dataTransfer.getData('text/plain');
        
        if (this.draggedCompany && ticker) {
            this.addToPortfolio(this.draggedCompany);
            this.draggedCompany = null;
            
            console.log(`📥 드롭 완료: ${ticker}`);
        }
    }

    /**
     * 포트폴리오에 종목 추가
     */
    addToPortfolio(company, weight = null) {
        const ticker = company.Ticker;
        
        if (this.portfolio.has(ticker)) {
            this.showMessage(`${ticker}는 이미 포트폴리오에 있습니다.`, 'warning');
            return;
        }

        // 자동 가중치 계산 (균등 분배)
        const currentSize = this.portfolio.size;
        const autoWeight = weight || (100 / (currentSize + 1));
        
        // 기존 종목들 가중치 재조정
        if (!weight) {
            this.portfolio.forEach((item) => {
                item.weight = 100 / (currentSize + 1);
            });
        }

        this.portfolio.set(ticker, {
            company,
            weight: autoWeight,
            addedAt: new Date(),
            value: parseFloat(company['(USD mn)']) || 0
        });

        this.updatePortfolioUI();
        this.calculatePortfolioMetrics();
        this.showMessage(`${ticker} 포트폴리오에 추가되었습니다.`, 'success');
        
        console.log(`💼 포트폴리오 추가: ${ticker} (${autoWeight.toFixed(1)}%)`);
    }

    /**
     * 포트폴리오에서 종목 제거
     */
    removeFromPortfolio(ticker) {
        if (!this.portfolio.has(ticker)) return;

        this.portfolio.delete(ticker);
        
        // 남은 종목들 가중치 재조정
        if (this.portfolio.size > 0) {
            const equalWeight = 100 / this.portfolio.size;
            this.portfolio.forEach((item) => {
                item.weight = equalWeight;
            });
        }

        this.updatePortfolioUI();
        this.calculatePortfolioMetrics();
        this.showMessage(`${ticker} 포트폴리오에서 제거되었습니다.`, 'info');
        
        console.log(`🗑️ 포트폴리오 제거: ${ticker}`);
    }

    /**
     * 포트폴리오 UI 업데이트
     */
    updatePortfolioUI() {
        const emptyState = document.getElementById('empty-portfolio');
        const portfolioItems = document.getElementById('portfolio-items');
        const portfolioCount = document.getElementById('portfolio-count');
        
        if (this.portfolio.size === 0) {
            emptyState.style.display = 'block';
            portfolioItems.style.display = 'none';
            portfolioCount.textContent = '0개 종목';
            this.updateButtonStates(false);
        } else {
            emptyState.style.display = 'none';
            portfolioItems.style.display = 'grid';
            portfolioCount.textContent = `${this.portfolio.size}개 종목`;
            this.updateButtonStates(true);
            
            this.renderPortfolioItems();
        }
    }

    /**
     * 포트폴리오 아이템 렌더링
     */
    renderPortfolioItems() {
        const container = document.getElementById('portfolio-items');
        if (!container) return;

        container.innerHTML = '';
        
        this.portfolio.forEach((item, ticker) => {
            const { company, weight, value } = item;
            
            const itemDiv = document.createElement('div');
            itemDiv.className = 'portfolio-item bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow';
            itemDiv.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h5 class="font-bold text-lg">${ticker}</h5>
                        <p class="text-sm text-gray-600">${company.corpName || company.industry}</p>
                    </div>
                    <button class="remove-btn text-red-500 hover:text-red-700" data-ticker="${ticker}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="space-y-2">
                    <div class="flex justify-between text-sm">
                        <span>비중</span>
                        <span class="font-medium">${weight.toFixed(1)}%</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>시가총액</span>
                        <span class="font-medium">$${this.formatMarketCap(value)}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>PER</span>
                        <span class="font-medium">${parseFloat(company['PER (Oct-25)']).toFixed(1) || '-'}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>ROE</span>
                        <span class="font-medium">${parseFloat(company['ROE (Fwd)']).toFixed(1) || '-'}%</span>
                    </div>
                </div>
                
                <!-- 가중치 조절 슬라이더 -->
                <div class="mt-3">
                    <label class="text-xs text-gray-600">비중 조절</label>
                    <input type="range" class="weight-slider w-full mt-1" 
                           min="1" max="50" value="${weight.toFixed(0)}" 
                           data-ticker="${ticker}">
                </div>
            `;
            
            container.appendChild(itemDiv);
        });

        // 이벤트 리스너 추가
        this.setupPortfolioItemEvents();
    }

    /**
     * 포트폴리오 아이템 이벤트 설정
     */
    setupPortfolioItemEvents() {
        // 제거 버튼
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ticker = e.target.closest('.remove-btn').dataset.ticker;
                this.removeFromPortfolio(ticker);
            });
        });

        // 가중치 슬라이더
        document.querySelectorAll('.weight-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const ticker = e.target.dataset.ticker;
                const newWeight = parseFloat(e.target.value);
                this.updateWeight(ticker, newWeight);
            });
        });
    }

    /**
     * 가중치 업데이트
     */
    updateWeight(ticker, newWeight) {
        if (!this.portfolio.has(ticker)) return;

        const item = this.portfolio.get(ticker);
        const oldWeight = item.weight;
        const weightDiff = newWeight - oldWeight;
        
        // 다른 종목들의 가중치 조정
        const otherTickers = Array.from(this.portfolio.keys()).filter(t => t !== ticker);
        const totalOtherWeight = otherTickers.reduce((sum, t) => sum + this.portfolio.get(t).weight, 0);
        
        if (totalOtherWeight > 0) {
            otherTickers.forEach(t => {
                const otherItem = this.portfolio.get(t);
                const proportion = otherItem.weight / totalOtherWeight;
                otherItem.weight = Math.max(1, otherItem.weight - (weightDiff * proportion));
            });
        }

        item.weight = newWeight;
        
        // 총합이 100%가 되도록 정규화
        this.normalizeWeights();
        
        this.updatePortfolioUI();
        this.calculatePortfolioMetrics();
    }

    /**
     * 가중치 정규화
     */
    normalizeWeights() {
        const totalWeight = Array.from(this.portfolio.values())
            .reduce((sum, item) => sum + item.weight, 0);
        
        if (totalWeight !== 100) {
            const factor = 100 / totalWeight;
            this.portfolio.forEach(item => {
                item.weight *= factor;
            });
        }
    }  
  /**
     * 포트폴리오 메트릭 계산
     */
    calculatePortfolioMetrics() {
        if (this.portfolio.size === 0) {
            this.resetMetrics();
            return;
        }

        const companies = Array.from(this.portfolio.values()).map(item => item.company);
        
        // 기본 통계
        const totalStocks = this.portfolio.size;
        const totalMarketCap = companies.reduce((sum, company) => {
            return sum + (parseFloat(company['(USD mn)']) || 0);
        }, 0);

        // 평균 PER 계산
        const perValues = companies
            .map(company => parseFloat(company['PER (Oct-25)']))
            .filter(per => !isNaN(per) && per > 0);
        const avgPER = perValues.length > 0 ? 
            perValues.reduce((sum, per) => sum + per, 0) / perValues.length : 0;

        // 평균 ROE 계산
        const roeValues = companies
            .map(company => parseFloat(company['ROE (Fwd)']))
            .filter(roe => !isNaN(roe));
        const avgROE = roeValues.length > 0 ? 
            roeValues.reduce((sum, roe) => sum + roe, 0) / roeValues.length : 0;

        // 리스크 점수 계산 (간단한 분산 기반)
        const riskScore = this.calculateRiskScore(companies);

        // UI 업데이트
        this.updateMetricsUI({
            totalStocks,
            totalMarketCap,
            avgPER,
            avgROE,
            riskScore
        });

        // 섹터 분산 업데이트
        this.updateSectorDistribution(companies);
    }

    /**
     * 리스크 점수 계산
     */
    calculateRiskScore(companies) {
        // 섹터 분산도 기반 리스크 계산
        const sectors = {};
        companies.forEach(company => {
            const sector = company.industry || 'Unknown';
            sectors[sector] = (sectors[sector] || 0) + 1;
        });

        const sectorCount = Object.keys(sectors).length;
        const totalCompanies = companies.length;
        
        // 분산도가 높을수록 리스크 낮음 (1-10 스케일)
        let riskScore = 10;
        
        if (sectorCount === 1) riskScore = 8; // 단일 섹터
        else if (sectorCount === 2) riskScore = 6;
        else if (sectorCount >= 3) riskScore = 4;
        
        // 종목 수가 적으면 리스크 증가
        if (totalCompanies < 5) riskScore += 2;
        else if (totalCompanies < 10) riskScore += 1;
        
        return Math.min(10, Math.max(1, riskScore));
    }

    /**
     * 메트릭 UI 업데이트
     */
    updateMetricsUI(metrics) {
        document.getElementById('total-stocks').textContent = metrics.totalStocks;
        document.getElementById('total-market-cap').textContent = `$${this.formatMarketCap(metrics.totalMarketCap)}`;
        document.getElementById('avg-per').textContent = metrics.avgPER > 0 ? metrics.avgPER.toFixed(1) : '-';
        document.getElementById('avg-roe').textContent = metrics.avgROE !== 0 ? `${metrics.avgROE.toFixed(1)}%` : '-';
        
        const riskElement = document.getElementById('risk-score');
        riskElement.textContent = `${metrics.riskScore}/10`;
        
        // 리스크 점수에 따른 색상 변경
        riskElement.className = 'font-bold ' + this.getRiskColor(metrics.riskScore);
    }

    /**
     * 리스크 색상 반환
     */
    getRiskColor(score) {
        if (score <= 3) return 'text-green-600';
        if (score <= 6) return 'text-yellow-600';
        return 'text-red-600';
    }

    /**
     * 섹터 분산 업데이트
     */
    updateSectorDistribution(companies) {
        const container = document.getElementById('sector-distribution');
        if (!container) return;

        const sectors = {};
        companies.forEach(company => {
            const sector = company.industry || 'Unknown';
            sectors[sector] = (sectors[sector] || 0) + 1;
        });

        const total = companies.length;
        const sectorEntries = Object.entries(sectors)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5); // 상위 5개 섹터만

        container.innerHTML = `
            <div class="space-y-2">
                ${sectorEntries.map(([sector, count]) => {
                    const percentage = (count / total * 100).toFixed(1);
                    return `
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-gray-700">${sector}</span>
                            <div class="flex items-center">
                                <div class="w-16 bg-gray-200 rounded-full h-2 mr-2">
                                    <div class="bg-blue-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                                </div>
                                <span class="text-xs font-medium">${percentage}%</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    /**
     * 메트릭 초기화
     */
    resetMetrics() {
        document.getElementById('total-stocks').textContent = '0';
        document.getElementById('total-market-cap').textContent = '$0';
        document.getElementById('avg-per').textContent = '-';
        document.getElementById('avg-roe').textContent = '-';
        document.getElementById('risk-score').textContent = '-';
        document.getElementById('risk-score').className = 'font-bold text-gray-600';
        
        const sectorContainer = document.getElementById('sector-distribution');
        if (sectorContainer) {
            sectorContainer.innerHTML = `
                <div class="text-center text-gray-500 py-8">
                    <i class="fas fa-chart-pie text-2xl mb-2"></i>
                    <p class="text-sm">종목을 추가하면 섹터 분산을 확인할 수 있습니다</p>
                </div>
            `;
        }
    }

    /**
     * 버튼 상태 업데이트
     */
    updateButtonStates(hasItems) {
        const buttons = ['rebalance-btn', 'analyze-btn', 'save-portfolio-btn', 'clear-portfolio-btn'];
        buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = !hasItems;
            }
        });
    }

    /**
     * 포트폴리오 리밸런싱
     */
    rebalancePortfolio() {
        if (this.portfolio.size === 0) return;

        const equalWeight = 100 / this.portfolio.size;
        this.portfolio.forEach(item => {
            item.weight = equalWeight;
        });

        this.updatePortfolioUI();
        this.showMessage('포트폴리오가 균등 분배로 리밸런싱되었습니다.', 'success');
        
        console.log('⚖️ 포트폴리오 리밸런싱 완료');
    }

    /**
     * 포트폴리오 분석
     */
    analyzePortfolio() {
        if (this.portfolio.size === 0) return;

        const companies = Array.from(this.portfolio.values()).map(item => item.company);
        
        // 분석 모달 생성
        this.showAnalysisModal(companies);
        
        console.log('📊 포트폴리오 분석 시작');
    }

    /**
     * 분석 모달 표시
     */
    showAnalysisModal(companies) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-2xl font-bold text-gray-900">
                        <i class="fas fa-chart-line text-blue-600 mr-2"></i>
                        포트폴리오 분석 리포트
                    </h3>
                    <button class="close-modal text-2xl font-bold text-gray-500 hover:text-gray-700">&times;</button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- 리스크 분석 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-3">리스크 분석</h4>
                        <div id="risk-analysis">
                            ${this.generateRiskAnalysis(companies)}
                        </div>
                    </div>
                    
                    <!-- 수익성 분석 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-3">수익성 분석</h4>
                        <div id="profitability-analysis">
                            ${this.generateProfitabilityAnalysis(companies)}
                        </div>
                    </div>
                    
                    <!-- 밸류에이션 분석 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-3">밸류에이션 분석</h4>
                        <div id="valuation-analysis">
                            ${this.generateValuationAnalysis(companies)}
                        </div>
                    </div>
                    
                    <!-- 개선 제안 -->
                    <div class="dashboard-card">
                        <h4 class="text-lg font-bold mb-3">개선 제안</h4>
                        <div id="improvement-suggestions">
                            ${this.generateImprovementSuggestions(companies)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 모달 닫기 이벤트
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * 리스크 분석 생성
     */
    generateRiskAnalysis(companies) {
        const sectors = {};
        companies.forEach(company => {
            const sector = company.industry || 'Unknown';
            sectors[sector] = (sectors[sector] || 0) + 1;
        });

        const sectorCount = Object.keys(sectors).length;
        const riskLevel = sectorCount >= 5 ? '낮음' : sectorCount >= 3 ? '보통' : '높음';
        const riskColor = sectorCount >= 5 ? 'text-green-600' : sectorCount >= 3 ? 'text-yellow-600' : 'text-red-600';

        return `
            <div class="space-y-3">
                <div class="flex justify-between">
                    <span>분산도</span>
                    <span class="font-bold ${riskColor}">${riskLevel}</span>
                </div>
                <div class="flex justify-between">
                    <span>섹터 수</span>
                    <span class="font-bold">${sectorCount}개</span>
                </div>
                <div class="flex justify-between">
                    <span>종목 수</span>
                    <span class="font-bold">${companies.length}개</span>
                </div>
                <div class="text-sm text-gray-600 mt-3">
                    ${sectorCount < 3 ? '⚠️ 섹터 분산을 늘려 리스크를 줄이세요' : '✅ 적절한 분산 투자입니다'}
                </div>
            </div>
        `;
    }

    /**
     * 수익성 분석 생성
     */
    generateProfitabilityAnalysis(companies) {
        const roeValues = companies
            .map(company => parseFloat(company['ROE (Fwd)']))
            .filter(roe => !isNaN(roe));
        
        const avgROE = roeValues.length > 0 ? 
            roeValues.reduce((sum, roe) => sum + roe, 0) / roeValues.length : 0;
        
        const highROECount = roeValues.filter(roe => roe >= 15).length;
        const roeGrade = avgROE >= 20 ? 'A' : avgROE >= 15 ? 'B' : avgROE >= 10 ? 'C' : 'D';

        return `
            <div class="space-y-3">
                <div class="flex justify-between">
                    <span>평균 ROE</span>
                    <span class="font-bold">${avgROE.toFixed(1)}%</span>
                </div>
                <div class="flex justify-between">
                    <span>수익성 등급</span>
                    <span class="font-bold">${roeGrade}</span>
                </div>
                <div class="flex justify-between">
                    <span>우량 종목</span>
                    <span class="font-bold">${highROECount}/${companies.length}개</span>
                </div>
                <div class="text-sm text-gray-600 mt-3">
                    ${avgROE >= 15 ? '✅ 높은 수익성을 보입니다' : '⚠️ 수익성 개선이 필요합니다'}
                </div>
            </div>
        `;
    }

    /**
     * 밸류에이션 분석 생성
     */
    generateValuationAnalysis(companies) {
        const perValues = companies
            .map(company => parseFloat(company['PER (Oct-25)']))
            .filter(per => !isNaN(per) && per > 0);
        
        const avgPER = perValues.length > 0 ? 
            perValues.reduce((sum, per) => sum + per, 0) / perValues.length : 0;
        
        const undervaluedCount = perValues.filter(per => per <= 15).length;
        const valuationGrade = avgPER <= 15 ? 'A' : avgPER <= 20 ? 'B' : avgPER <= 25 ? 'C' : 'D';

        return `
            <div class="space-y-3">
                <div class="flex justify-between">
                    <span>평균 PER</span>
                    <span class="font-bold">${avgPER.toFixed(1)}</span>
                </div>
                <div class="flex justify-between">
                    <span>밸류에이션 등급</span>
                    <span class="font-bold">${valuationGrade}</span>
                </div>
                <div class="flex justify-between">
                    <span>저평가 종목</span>
                    <span class="font-bold">${undervaluedCount}/${companies.length}개</span>
                </div>
                <div class="text-sm text-gray-600 mt-3">
                    ${avgPER <= 20 ? '✅ 적정한 밸류에이션입니다' : '⚠️ 고평가 구간일 수 있습니다'}
                </div>
            </div>
        `;
    }

    /**
     * 개선 제안 생성
     */
    generateImprovementSuggestions(companies) {
        const suggestions = [];
        
        // 섹터 분산 체크
        const sectors = {};
        companies.forEach(company => {
            const sector = company.industry || 'Unknown';
            sectors[sector] = (sectors[sector] || 0) + 1;
        });
        
        if (Object.keys(sectors).length < 3) {
            suggestions.push('다양한 섹터의 종목을 추가하여 분산 투자하세요');
        }
        
        if (companies.length < 5) {
            suggestions.push('포트폴리오 규모를 5-10개 종목으로 확대하세요');
        }
        
        const highPERCount = companies.filter(company => {
            const per = parseFloat(company['PER (Oct-25)']);
            return !isNaN(per) && per > 25;
        }).length;
        
        if (highPERCount > companies.length * 0.5) {
            suggestions.push('고PER 종목 비중을 줄이고 저평가 종목을 추가하세요');
        }

        return `
            <div class="space-y-2">
                ${suggestions.length > 0 ? 
                    suggestions.map(suggestion => `
                        <div class="flex items-start">
                            <i class="fas fa-lightbulb text-yellow-500 mr-2 mt-1"></i>
                            <span class="text-sm">${suggestion}</span>
                        </div>
                    `).join('') :
                    '<div class="text-center text-green-600"><i class="fas fa-check-circle mr-2"></i>잘 구성된 포트폴리오입니다!</div>'
                }
            </div>
        `;
    }

    /**
     * 포트폴리오 저장
     */
    savePortfolio() {
        const portfolioData = {
            timestamp: new Date().toISOString(),
            portfolio: Array.from(this.portfolio.entries()).map(([ticker, item]) => ({
                ticker,
                weight: item.weight,
                company: item.company
            }))
        };

        try {
            localStorage.setItem('stockAnalyzer_portfolio', JSON.stringify(portfolioData));
            this.showMessage('포트폴리오가 저장되었습니다.', 'success');
        } catch (error) {
            this.showMessage('포트폴리오 저장에 실패했습니다.', 'error');
        }
    }

    /**
     * 저장된 포트폴리오 로드
     */
    loadSavedPortfolio() {
        try {
            const saved = localStorage.getItem('stockAnalyzer_portfolio');
            if (saved) {
                const portfolioData = JSON.parse(saved);
                
                portfolioData.portfolio.forEach(item => {
                    this.portfolio.set(item.ticker, {
                        company: item.company,
                        weight: item.weight,
                        addedAt: new Date(portfolioData.timestamp),
                        value: parseFloat(item.company['(USD mn)']) || 0
                    });
                });

                if (this.portfolio.size > 0) {
                    this.updatePortfolioUI();
                    this.calculatePortfolioMetrics();
                    console.log(`💼 저장된 포트폴리오 로드: ${this.portfolio.size}개 종목`);
                }
            }
        } catch (error) {
            console.warn('포트폴리오 로드 실패:', error);
        }
    }

    /**
     * 포트폴리오 초기화
     */
    clearPortfolio() {
        if (this.portfolio.size === 0) return;

        if (confirm('포트폴리오를 초기화하시겠습니까?')) {
            this.portfolio.clear();
            this.updatePortfolioUI();
            this.resetMetrics();
            this.showMessage('포트폴리오가 초기화되었습니다.', 'info');
            
            console.log('🗑️ 포트폴리오 초기화 완료');
        }
    }

    /**
     * 시가총액 포맷팅
     */
    formatMarketCap(value) {
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(1)}T`;
        } else if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}B`;
        } else {
            return `${value.toFixed(0)}M`;
        }
    }

    /**
     * 메시지 표시
     */
    showMessage(message, type = 'info') {
        if (window.loadingManager) {
            window.loadingManager.showFeedback(message, type, 3000);
        } else {
            alert(message);
        }
    }

    /**
     * 포트폴리오 데이터 반환
     */
    getPortfolioData() {
        return Array.from(this.portfolio.entries()).map(([ticker, item]) => ({
            ticker,
            ...item
        }));
    }
}

// 전역 인스턴스 생성
window.portfolioManager = new PortfolioManager();

console.log('✅ PortfolioManager 로드 완료 - 드래그 앤 드롭 포트폴리오 빌더');