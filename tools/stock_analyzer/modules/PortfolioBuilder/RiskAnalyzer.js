/**
 * RiskAnalyzer - 포트폴리오 리스크 지표 계산 유틸리티
 */
class RiskAnalyzer {
    analyze(holdings = []) {
        if (!holdings.length) {
            return this.emptyResult();
        }

        const totalWeight = holdings.reduce((sum, item) => sum + (item.weight || 0), 0) || 1;
        const normalized = holdings.map(item => ({
            ...item,
            weight: (item.weight || 0) / totalWeight
        }));

        const weightedRisk = this.weightedAverage(normalized, item => item.riskProxy);
        const expectedReturn = this.weightedAverage(normalized, item => item.expectedReturn);
        const downside = this.weightedAverage(normalized, item => Math.min(0, item.expectedReturn));

        const diversification = this.computeDiversification(normalized);
        const sharpe = weightedRisk ? expectedReturn / weightedRisk : null;
        const sortino = downside ? expectedReturn / Math.abs(downside) : null;

        return {
            volatility: weightedRisk,
            expectedReturn,
            sharpe,
            sortino,
            diversification,
            notes: this.buildNotes({ diversification, sharpe, volatility: weightedRisk })
        };
    }

    buildNotes({ diversification, sharpe, volatility }) {
        const notes = [];
        if (diversification < 0.5) {
            notes.push('비중 상위 종목 편중이 커서 분산 효과가 낮습니다.');
        } else if (diversification > 0.8) {
            notes.push('분산이 우수하여 특정 종목 리스크에 견고합니다.');
        }

        if (Number.isFinite(sharpe)) {
            notes.push(`샤프 지수는 ${sharpe.toFixed(2)} 수준입니다.`);
        } else {
            notes.push('샤프 지수를 계산할 충분한 데이터가 없습니다.');
        }

        if (Number.isFinite(volatility)) {
            notes.push(`예상 변동성은 ${(volatility * 100).toFixed(1)}%입니다.`);
        }

        return notes;
    }

    computeDiversification(holdings) {
        if (!holdings.length) return 0;
        const hhi = holdings.reduce((sum, item) => sum + Math.pow(item.weight, 2), 0);
        return 1 - hhi; // 0~1 범위
    }

    weightedAverage(holdings, selector) {
        let totalWeight = 0;
        let total = 0;
        holdings.forEach(item => {
            const value = selector(item);
            if (Number.isFinite(value)) {
                total += value * (item.weight || 0);
                totalWeight += item.weight || 0;
            }
        });
        if (!totalWeight) return null;
        return total / totalWeight;
    }

    emptyResult() {
        return {
            volatility: null,
            expectedReturn: null,
            sharpe: null,
            sortino: null,
            diversification: 0,
            notes: ['선택된 종목이 없어 리스크 분석이 불가능합니다.']
        };
    }
}

window.PortfolioRiskAnalyzerCore = RiskAnalyzer;

console.log('✅ PortfolioRiskAnalyzerCore 로드 완료 - 리스크 분석 엔진');
