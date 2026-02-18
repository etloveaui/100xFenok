// ===================================================================
// 100x Daily Wrap - Dynamic Colors Script (완전 수정 버전)
// 모든 색깔 처리를 자동화하는 통합 스크립트
// ===================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dynamic Colors Script 로딩 완료');
    
    // 모든 색깔 처리 함수 실행
    processMarketIndicators();
    processLiquidityIndicators();
    processAssetPerformance();
    processCorrelationMatrix();
    processWallStreetUpdates();
    processRealityLabels();
    processRotationSignals();
    processSectorHeatmap();
    processTechRadar();
    processLiveTradeSignals();
    processOvernightFutures();
    processGeneralPercentages();
    
    console.log('모든 동적 색깔 처리 완료');
});

// ===================================================================
// 1. 핵심 지표 섹션 (S&P 500, Nasdaq, VIX, 10-Y Treasury)
// ===================================================================
function processMarketIndicators() {
    const marketCards = document.querySelectorAll('.card-shadow');
    
    marketCards.forEach(card => {
        const titleElement = card.querySelector('h4');
        const valueElement = card.querySelector('.text-2xl');
        const changeElement = card.querySelector('.text-sm');
        
        if (!titleElement || !valueElement || !changeElement) return;
        
        const title = titleElement.textContent.trim();
        const changeText = changeElement.textContent.trim();
        
        // 숫자 추출 (%, bp, + 등 제거)
        const changeValue = parseFloat(changeText.replace(/[+\-%bp]/g, ''));
        
        if (isNaN(changeValue)) return;
        
        // 모든 지수 동일 처리 (VIX 포함)
        if (changeValue > 0) {
            valueElement.className = 'text-2xl font-bold text-green-600';
            changeElement.className = 'text-sm font-semibold text-green-600';
        } else if (changeValue < 0) {
            valueElement.className = 'text-2xl font-bold text-red-600';
            changeElement.className = 'text-sm font-semibold text-red-600';
        }
    });
}

// ===================================================================
// 2. 100x 유동성 지표 - 상태 기반 색깔 처리
// ===================================================================
function processLiquidityIndicators() {
    const liquidityCards = document.querySelectorAll('.bg-white.p-3.rounded-lg.shadow-sm');
    
    liquidityCards.forEach(card => {
        const statusElement = card.querySelector('.font-bold.text-lg');
        
        if (!statusElement) return;
        
        const statusText = statusElement.textContent.trim();
        
        if (statusText.includes('축소')) {
            statusElement.className = 'font-bold text-lg text-red-600';
        } else if (statusText.includes('개선')) {
            statusElement.className = 'font-bold text-lg text-green-600';
        } else if (statusText.includes('중립')) {
            statusElement.className = 'font-bold text-lg text-gray-600';
        }
    });
}

// ===================================================================
// 3. 자산별 성과 요약 - 모든 변화율 처리
// ===================================================================
function processAssetPerformance() {
    const accordionContents = document.querySelectorAll('.accordion-content');
    
    accordionContents.forEach(content => {
        const textElements = content.querySelectorAll('b, strong, span');
        
        textElements.forEach(element => {
            const text = element.textContent.trim();
            
            // 퍼센트 패턴 매칭
            const percentMatch = text.match(/([+-]?\d+\.?\d*)%/);
            if (percentMatch) {
                const value = parseFloat(percentMatch[1]);
                
                if (value > 0) {
                    element.classList.remove('text-red-600', 'text-gray-600');
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.remove('text-green-600', 'text-gray-600');
                    element.classList.add('text-red-600');
                }
            }
            
            // bp (basis points) 패턴 매칭
            const bpMatch = text.match(/([+-]?\d+\.?\d*)bp/);
            if (bpMatch) {
                const value = parseFloat(bpMatch[1]);
                
                if (value > 0) {
                    element.classList.remove('text-red-600', 'text-gray-600');
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.remove('text-green-600', 'text-gray-600');
                    element.classList.add('text-red-600');
                }
            }
        });
    });
}

// ===================================================================
// 4. 상관관계 매트릭스 - 수치 범위 기반 색깔
// ===================================================================
function processCorrelationMatrix() {
    const correlationElements = document.querySelectorAll('.correlation-value, .text-lg');
    
    correlationElements.forEach(element => {
        const text = element.textContent.trim();
        
        // 상관관계 수치 추출 (-1.0 ~ +1.0)
        const correlationMatch = text.match(/([+-]?\d+\.?\d*)/);
        if (correlationMatch) {
            const correlation = parseFloat(correlationMatch[1]);
            
            if (correlation >= 0.3) {
                element.classList.remove('text-red-600', 'text-gray-600');
                element.classList.add('text-green-600');
            } else if (correlation <= -0.3) {
                element.classList.remove('text-green-600', 'text-gray-600');
                element.classList.add('text-red-600');
            } else {
                element.classList.remove('text-green-600', 'text-red-600');
                element.classList.add('text-gray-600');
            }
        }
    });
}

// ===================================================================
// 5. 월스트리트 정보 - 액션 기반 색깔 처리
// ===================================================================
function processWallStreetUpdates() {
    const timelineItems = document.querySelectorAll('.timeline-item');
    
    timelineItems.forEach(item => {
        const actionElements = item.querySelectorAll('span, .font-semibold');
        
        actionElements.forEach(element => {
            const text = element.textContent.toLowerCase();
            
            if (text.includes('상향') || text.includes('매수') || text.includes('신규') || 
                text.includes('upgrade') || text.includes('outperform') || text.includes('buy')) {
                element.classList.remove('text-red-600', 'text-gray-600');
                element.classList.add('text-green-600');
            } else if (text.includes('하향') || text.includes('매도') || 
                       text.includes('downgrade') || text.includes('sell') || text.includes('underperform')) {
                element.classList.remove('text-green-600', 'text-gray-600');
                element.classList.add('text-red-600');
            }
        });
    });
}

// ===================================================================
// 6. Reality Label 색상 처리
// ===================================================================
function processRealityLabels() {
    const realityElements = document.querySelectorAll('.reality-label, [class*="reality"]');
    
    realityElements.forEach(element => {
        const text = element.textContent.toLowerCase();
        
        if (text.includes('과열')) {
            element.classList.remove('text-orange-600', 'text-gray-600', 'text-green-600');
            element.classList.add('text-red-600');
        } else if (text.includes('조정')) {
            element.classList.remove('text-red-600', 'text-gray-600', 'text-green-600');
            element.classList.add('text-orange-600');
        } else if (text.includes('중립')) {
            element.classList.remove('text-red-600', 'text-orange-600', 'text-green-600');
            element.classList.add('text-gray-600');
        } else if (text.includes('저평가')) {
            element.classList.remove('text-red-600', 'text-orange-600', 'text-gray-600');
            element.classList.add('text-green-600');
        }
    });
}

// ===================================================================
// 7. Rotation Signal 색상 처리
// ===================================================================
function processRotationSignals() {
    const rotationElements = document.querySelectorAll('.rotation-signal, [class*="rotation"]');
    
    rotationElements.forEach(element => {
        const text = element.textContent.toLowerCase();
        
        if (text.includes('과열')) {
            element.classList.remove('text-orange-600', 'text-blue-600', 'text-gray-600');
            element.classList.add('text-red-600');
        } else if (text.includes('활발')) {
            element.classList.remove('text-red-600', 'text-blue-600', 'text-gray-600');
            element.classList.add('text-orange-600');
        } else if (text.includes('보통')) {
            element.classList.remove('text-red-600', 'text-orange-600', 'text-gray-600');
            element.classList.add('text-blue-600');
        } else if (text.includes('침체')) {
            element.classList.remove('text-red-600', 'text-orange-600', 'text-blue-600');
            element.classList.add('text-gray-600');
        }
    });
}

// ===================================================================
// 8. 섹터 퍼포먼스 히트맵 - 퍼센트 기반 색깔
// ===================================================================
function processSectorHeatmap() {
    const sectorCards = document.querySelectorAll('.sector-card, .heatmap-cell');
    
    sectorCards.forEach(card => {
        const percentElements = card.querySelectorAll('[class*="percent"], .performance-value');
        
        percentElements.forEach(element => {
            const text = element.textContent.trim();
            const percentMatch = text.match(/([+-]?\d+\.?\d*)%/);
            
            if (percentMatch) {
                const value = parseFloat(percentMatch[1]);
                
                if (value > 0) {
                    element.classList.remove('text-red-600', 'text-gray-600');
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.remove('text-green-600', 'text-gray-600');
                    element.classList.add('text-red-600');
                }
            }
        });
    });
}

// ===================================================================
// 9. 100x Tech Radar - 카드별 변화율
// ===================================================================
function processTechRadar() {
    const techCards = document.querySelectorAll('.flip-card, .tech-card');
    
    techCards.forEach(card => {
        const percentElements = card.querySelectorAll('.text-green-600, .text-red-600, [class*="percent"]');
        
        percentElements.forEach(element => {
            const text = element.textContent.trim();
            const percentMatch = text.match(/([+-]?\d+\.?\d*)%/);
            
            if (percentMatch) {
                const value = parseFloat(percentMatch[1]);
                
                if (value > 0) {
                    element.classList.remove('text-red-600', 'text-gray-600');
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.remove('text-green-600', 'text-gray-600');
                    element.classList.add('text-red-600');
                }
            }
        });
    });
}

// ===================================================================
// 10. 실시간 트레이드 - 진입/목표/손절 색깔
// ===================================================================
function processLiveTradeSignals() {
    const tradeCards = document.querySelectorAll('.trade-card, .signal-card');
    
    tradeCards.forEach(card => {
        const priceElements = card.querySelectorAll('span, .price-info');
        
        priceElements.forEach(element => {
            const text = element.textContent.toLowerCase();
            
            if (text.includes('진입') || text.includes('현재') || text.includes('entry')) {
                element.classList.remove('text-green-600', 'text-red-600');
                element.classList.add('text-blue-600');
            } else if (text.includes('목표') || text.includes('target') || text.includes('상승여력')) {
                element.classList.remove('text-blue-600', 'text-red-600');
                element.classList.add('text-green-600');
            } else if (text.includes('손절') || text.includes('stop') || text.includes('리스크')) {
                element.classList.remove('text-blue-600', 'text-green-600');
                element.classList.add('text-red-600');
            }
        });
    });
}

// ===================================================================
// 11. 부록 A - 야간 선물 변동률
// ===================================================================
function processOvernightFutures() {
    const futuresCards = document.querySelectorAll('.futures-card, .overnight-data');
    
    futuresCards.forEach(card => {
        const changeElements = card.querySelectorAll('.change-value, .futures-change');
        
        changeElements.forEach(element => {
            const text = element.textContent.trim();
            const changeMatch = text.match(/([+-]?\d+\.?\d*)%/);
            
            if (changeMatch) {
                const value = parseFloat(changeMatch[1]);
                
                if (value > 0) {
                    element.classList.remove('text-red-600', 'text-gray-600');
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.remove('text-green-600', 'text-gray-600');
                    element.classList.add('text-red-600');
                }
            }
        });
    });
}

// ===================================================================
// 12. 일반 퍼센트 값 처리 (포괄적 처리)
// ===================================================================
function processGeneralPercentages() {
    const allElements = document.querySelectorAll('span, b, strong, p, div');
    
    allElements.forEach(element => {
        // 이미 색깔이 적용된 요소는 건너뛰기
        if (element.classList.contains('text-green-600') || 
            element.classList.contains('text-red-600') ||
            element.classList.contains('text-blue-600') ||
            element.classList.contains('text-gray-600')) {
            return;
        }
        
        const text = element.textContent.trim();
        const percentMatch = text.match(/([+-]?\d+\.?\d*)%/);
        
        if (percentMatch) {
            const value = parseFloat(percentMatch[1]);
            
            if (!isNaN(value)) {
                if (value > 0) {
                    element.classList.add('text-green-600');
                } else if (value < 0) {
                    element.classList.add('text-red-600');
                }
            }
        }
    });
}

// ===================================================================
// 유틸리티 함수들
// ===================================================================

// 숫자 추출 함수
function extractNumber(text) {
    const match = text.match(/([+-]?\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : NaN;
}

// 클래스 안전 교체 함수
function replaceColorClass(element, newColorClass) {
    const colorClasses = ['text-red-600', 'text-green-600', 'text-blue-600', 'text-gray-600', 'text-orange-600'];
    
    colorClasses.forEach(cls => {
        element.classList.remove(cls);
    });
    
    element.classList.add(newColorClass);
}

// 디버깅 함수
function debugColorProcessing() {
    console.log('=== Dynamic Colors Debug Info ===');
    console.log('Green elements:', document.querySelectorAll('.text-green-600').length);
    console.log('Red elements:', document.querySelectorAll('.text-red-600').length);
    console.log('Blue elements:', document.querySelectorAll('.text-blue-600').length);
    console.log('Gray elements:', document.querySelectorAll('.text-gray-600').length);
    console.log('Orange elements:', document.querySelectorAll('.text-orange-600').length);
}

// 개발 모드에서 디버깅 정보 출력
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setTimeout(debugColorProcessing, 1000);
}
