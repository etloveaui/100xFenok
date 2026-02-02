/**
 * IB Helper Calculator - V2.2 Algorithm Implementation
 *
 * 🔴 CRITICAL: This implements the exact Genie RPA logic
 * Reference: DEV.md, Asset_Allocator/docs/references/genie-rpa-infinitebuy-guide.md
 *
 * @version 1.0.0
 * @author 100xFenok Claude
 */

const IBCalculator = (function() {

  // =====================================================
  // CONSTANTS - V2.2 Parameters
  // =====================================================

  const DEFAULT_CONFIG = {
    divisions: 40,           // 기본 분할 수
    basePercent: 10,         // 기준% (별% 계산 기준)
    sellPercent: {
      TQQQ: 10,              // TQQQ AFTER 매도%
      SOXL: 12,              // SOXL AFTER 매도%
      DEFAULT: 10            // 기타 종목 기본값
    },
    locCapMultiplier: 1.15,  // 현재가 캡 배수 (×1.15)
    locBuyOffset: 0.01,      // 매수 LOC 차감 금액
    locSellOffsetRate: 0.005 // 매도 LOC 가산 비율 (평단가의 0.5%)
  };

  // =====================================================
  // T값 Calculation - 핵심!
  // =====================================================

  /**
   * T값 계산 (소수점 첫째자리 올림)
   *
   * @param {number} totalInvested - 총 매입금
   * @param {number} oneTimeBuy - 1회 매수금
   * @returns {number} T값
   *
   * 🔴 FORMULA: T = ceil((totalInvested / oneTimeBuy) * 10) / 10
   *
   * Example:
   *   principal = $13,000
   *   divisions = 40
   *   oneTimeBuy = $325
   *   totalInvested = $1,631
   *   T = ceil((1631 / 325) * 10) / 10 = ceil(50.18) / 10 = 5.1
   */
  function calculateT(totalInvested, oneTimeBuy) {
    if (!oneTimeBuy || oneTimeBuy <= 0) return 0;
    if (!totalInvested || totalInvested <= 0) return 0;

    const rawT = totalInvested / oneTimeBuy;
    const T = Math.ceil(rawT * 10) / 10;  // 소수점 첫째자리 올림

    return T;
  }

  // =====================================================
  // 별% (Star Percent) Calculation - 핵심!
  // =====================================================

  /**
   * 별% 계산
   *
   * @param {number} T - T값
   * @returns {number} 별% (percentage as number, e.g., 9.5 for 9.5%)
   *
   * 🔴 CRITICAL: 모든 종목 동일 공식!
   * 🔴 FORMULA: 별% = 10 - (T / 2)
   *
   * ⚠️ 기존 코드 오류: SOXL에 12 - (T * 0.6) 사용 → 틀림!
   * ✅ 정답: 모든 종목 동일 공식 10 - (T / 2) 사용
   *
   * Examples:
   *   T=2  → 별% = 10 - 1 = 9%
   *   T=20 → 별% = 10 - 10 = 0%  (전후반전 기준, 진행률 50%)
   *   T=20 → 별% = 10 - 10 = 0%
   *   T=40 → 별% = 10 - 20 = -10%
   */
  function calculateStarPercent(T) {
    return 10 - (T / 2);
  }

  // =====================================================
  // LOC Price Calculation - 가장 중요!
  // =====================================================

  /**
   * LOC 가격 계산
   *
   * @param {number} avgPrice - 평단가
   * @param {number} starPercent - 별%
   * @param {number} currentPrice - 현재가
   * @returns {Object} { starPrice, currentPriceCap, locPrice, reason }
   *
   * 🔴 CRITICAL: Genie RPA는 현재가+15% 캡을 적용!
   * 🔴 FORMULA: LOC = min(별%가, 현재가×1.15)
   *
   * 패턴: T값이 높을수록 별%가 낮아지고, 현재가+15%가 LOC가로 선택될 확률 ↑
   */
  function calculateLOC(avgPrice, starPercent, currentPrice) {
    // 별%가 계산
    const starPrice = avgPrice * (1 + starPercent / 100);

    // 현재가가 없으면 별%가만 사용 (캡 없음)
    if (!currentPrice || currentPrice <= 0) {
      return {
        starPrice: roundPrice(starPrice),
        currentPriceCap: 0,
        locPrice: roundPrice(starPrice),
        reason: '별%가 사용 (현재가 없음)'
      };
    }

    // 현재가+15% 캡
    const currentPriceCap = currentPrice * DEFAULT_CONFIG.locCapMultiplier;

    // LOC = min(별%가, 현재가×1.15)
    const locPrice = Math.min(starPrice, currentPriceCap);

    // 어떤 값이 선택되었는지 기록
    const reason = locPrice === starPrice ? '별%가 선택' : '현재가+15% 선택';

    return {
      starPrice: roundPrice(starPrice),
      currentPriceCap: roundPrice(currentPriceCap),
      locPrice: roundPrice(locPrice),
      reason
    };
  }

  /**
   * 매수용 LOC 가격 (0.01 차감)
   * @param {number} locPrice
   * @returns {number}
   */
  function getBuyLOCPrice(locPrice) {
    return roundPrice(locPrice - DEFAULT_CONFIG.locBuyOffset);
  }

  /**
   * 매도용 LOC 가격 (평단가의 0.5% 가산)
   * @param {number} locPrice
   * @param {number} avgPrice
   * @returns {number}
   */
  function getSellLOCPrice(locPrice, avgPrice) {
    return roundPrice(locPrice + (avgPrice * DEFAULT_CONFIG.locSellOffsetRate));
  }

  // =====================================================
  // Buy Orders Generation - 매수 주문 생성
  // =====================================================

  /**
   * 매수 주문 생성
   *
   * @param {Object} params
   * @param {number} params.principal - 세팅원금
   * @param {number} params.divisions - 분할 수
   * @param {number} params.avgPrice - 평단가
   * @param {number} params.totalInvested - 총 매입금
   * @param {number} params.currentPrice - 현재가
   * @param {string} params.ticker - 종목코드
   * @returns {Object} { T, starPercent, locInfo, orders, summary }
   */
  function generateBuyOrders(params) {
    const { principal, divisions, avgPrice, totalInvested, currentPrice, ticker } = params;

    // 1회 매수금
    const oneTimeBuy = principal / divisions;

    // T값 계산
    const T = calculateT(totalInvested, oneTimeBuy);

    // 별% 계산
    const starPercent = calculateStarPercent(T);

    // LOC 계산
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice);
    const buyLocPrice = getBuyLOCPrice(locInfo.locPrice);

    const orders = [];
    let usedAmount = 0;

    // ========================================
    // 전반전 (T < 20): 1회 매수금을 2개로 나눔 (진행률 50% 미만)
    // ========================================
    if (T < 20) {
      const halfAmount = oneTimeBuy / 2;

      // 주문 1: 평단LOC 매수 (0% 기준)
      const avgPriceBuy = roundPrice(avgPrice);
      const qty1 = Math.floor(halfAmount / avgPriceBuy);
      if (qty1 > 0) {
        orders.push({
          type: '평단LOC 매수',
          description: '평단가 기준 (0%)',
          price: avgPriceBuy,
          amount: roundPrice(halfAmount),
          quantity: qty1,
          orderType: 'LOC'
        });
        usedAmount += avgPriceBuy * qty1;
      }

      // 주문 2: 큰수LOC 매수 (별% 기준)
      const qty2 = Math.floor(halfAmount / buyLocPrice);
      if (qty2 > 0) {
        orders.push({
          type: '큰수LOC 매수',
          description: `별% ${starPercent.toFixed(1)}% 기준`,
          price: buyLocPrice,
          amount: roundPrice(halfAmount),
          quantity: qty2,
          orderType: 'LOC'
        });
        usedAmount += buyLocPrice * qty2;
      }
    }
    // ========================================
    // 후반전 (T >= 20): 전체를 큰수LOC로만 (진행률 50% 이상)
    // ========================================
    else {
      const qty = Math.floor(oneTimeBuy / buyLocPrice);
      if (qty > 0) {
        orders.push({
          type: '큰수LOC 매수',
          description: `별% ${starPercent.toFixed(1)}% 기준`,
          price: buyLocPrice,
          amount: roundPrice(oneTimeBuy),
          quantity: qty,
          orderType: 'LOC'
        });
        usedAmount += buyLocPrice * qty;
      }
    }

    // ========================================
    // 하락대비 추가매수 (남은 금액으로)
    // ========================================
    const additionalOrders = generateAdditionalBuyOrders(
      oneTimeBuy - usedAmount,
      orders.length > 0 ? orders[orders.length - 1].price : buyLocPrice
    );

    orders.push(...additionalOrders);

    return {
      T,
      starPercent,
      locInfo,
      oneTimeBuy: roundPrice(oneTimeBuy),
      phase: T < 20 ? '전반전' : '후반전',
      orders,
      summary: {
        totalOrders: orders.length,
        totalQuantity: orders.reduce((sum, o) => sum + o.quantity, 0),
        totalAmount: orders.reduce((sum, o) => sum + (o.price * o.quantity), 0)
      }
    };
  }

  /**
   * 하락대비 추가매수 주문 생성
   *
   * 🔴 Genie RPA 역공학 결과 (Asset Allocator 검증):
   * - 스텝 사이즈: 2% (복리)
   * - 공식: price[i] = 현재가 × 0.98^i
   * - 최대 하락폭: -15% (현재가 × 0.85까지)
   * - 종료: price < minPrice 또는 남은 금액 부족
   *
   * @param {number} remainingAmount - 남은 금액
   * @param {number} basePrice - 기준 가격 (현재가 또는 마지막 매수가)
   * @returns {Array} 추가매수 주문 배열
   */
  function generateAdditionalBuyOrders(remainingAmount, basePrice) {
    const orders = [];
    const stepPct = 0.02;  // 2% 복리 하락
    const maxDeclinePct = 0.15;  // 최대 -15%
    const minPrice = basePrice * (1 - maxDeclinePct);  // 하한선

    let remaining = remainingAmount;
    let price = basePrice;
    let step = 0;

    while (remaining > 0) {
      // 2% 복리 하락 적용
      price = roundPrice(price * (1 - stepPct));

      // 최대 하락폭 체크
      if (price < minPrice) break;

      // 남은 금액으로 1주 구매 가능한지 체크
      if (remaining < price) break;

      step++;
      const declineFromBase = ((basePrice - price) / basePrice * 100).toFixed(1);

      orders.push({
        type: `하락대비 추가매수 ${step}`,
        description: `-${declineFromBase}% 하락 시`,
        price: price,
        amount: roundPrice(price),
        quantity: 1,
        orderType: 'LOC'
      });

      remaining -= price;
    }

    return orders;
  }

  // =====================================================
  // Sell Orders Generation - 매도 주문 생성
  // =====================================================

  /**
   * 매도 주문 생성
   *
   * @param {Object} params
   * @param {number} params.holdings - 보유 수량
   * @param {number} params.avgPrice - 평단가
   * @param {number} params.currentPrice - 현재가
   * @param {string} params.ticker - 종목코드
   * @param {number} params.T - T값
   * @param {number} params.starPercent - 별%
   * @returns {Object} { orders, quarterStopLoss, summary }
   */
  function generateSellOrders(params) {
    const { holdings, avgPrice, currentPrice, ticker, T, starPercent } = params;

    const orders = [];

    // 쿼터손절 모드 체크 (T > 40)
    if (T > 40) {
      return {
        orders: [],
        quarterStopLoss: {
          active: true,
          message: '쿼터손절 모드 진입',
          instructions: [
            '1. 보유 수량의 1/4을 MOC(종가) 매도',
            '2. 매도 대금으로 -10%/-12% LOC 10분할 추가매수 준비',
            '3. 자세한 내용은 V2.2 방법론 참조'
          ],
          mocQuantity: Math.floor(holdings / 4)
        },
        summary: {
          totalOrders: 0,
          totalQuantity: 0
        }
      };
    }

    // LOC 매도가 계산
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice);
    const sellLocPrice = getSellLOCPrice(locInfo.locPrice, avgPrice);

    // AFTER 매도% 결정
    const sellPercent = getSellPercent(ticker);
    const afterSellPrice = roundPrice(avgPrice * (1 + sellPercent / 100));

    // 주문 1: LOC 매도 (25% = 쿼터매도)
    const locQuantity = Math.floor(holdings / 4);
    if (locQuantity > 0) {
      orders.push({
        type: 'LOC 매도',
        description: '보유의 25% (1/4)',
        price: sellLocPrice,
        quantity: locQuantity,
        orderType: 'LOC'
      });
    }

    // 주문 2: 지정가 매도 (75%)
    const afterQuantity = holdings - locQuantity;
    if (afterQuantity > 0) {
      orders.push({
        type: `지정가 매도 (+${sellPercent}%)`,
        description: '보유의 75% (3/4)',
        price: afterSellPrice,
        quantity: afterQuantity,
        orderType: 'LIMIT'
      });
    }

    return {
      orders,
      quarterStopLoss: { active: false },
      summary: {
        totalOrders: orders.length,
        totalQuantity: orders.reduce((sum, o) => sum + o.quantity, 0)
      }
    };
  }

  /**
   * 종목별 AFTER 매도% 반환
   * @param {string} ticker
   * @returns {number}
   */
  function getSellPercent(ticker) {
    const upperTicker = (ticker || '').toUpperCase();
    return DEFAULT_CONFIG.sellPercent[upperTicker] || DEFAULT_CONFIG.sellPercent.DEFAULT;
  }

  // =====================================================
  // Full Calculation - 전체 계산 (매수 + 매도)
  // =====================================================

  /**
   * 전체 주문 계산
   *
   * @param {Object} input
   * @param {string} input.ticker - 종목코드
   * @param {number} input.principal - 세팅원금
   * @param {number} input.divisions - 분할 수 (기본 40)
   * @param {number} input.avgPrice - 평단가
   * @param {number} input.totalInvested - 총 매입금
   * @param {number} input.holdings - 보유 수량
   * @param {number} input.currentPrice - 현재가
   * @returns {Object} 전체 계산 결과
   */
  function calculate(input) {
    const {
      ticker,
      principal,
      divisions = 40,
      avgPrice,
      totalInvested,
      holdings,
      currentPrice
    } = input;

    // Validation
    if (!avgPrice || avgPrice <= 0) {
      return { error: '평단가를 입력하세요' };
    }
    if (!principal || principal <= 0) {
      return { error: '세팅원금을 입력하세요' };
    }
    if (!currentPrice || currentPrice <= 0) {
      return { error: '현재가를 입력하세요' };
    }

    // 1회 매수금
    const oneTimeBuy = principal / divisions;

    // T값 계산
    const T = calculateT(totalInvested, oneTimeBuy);

    // 별% 계산
    const starPercent = calculateStarPercent(T);

    // LOC 정보
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice);

    // 매수 주문 생성
    const buyResult = generateBuyOrders({
      principal,
      divisions,
      avgPrice,
      totalInvested,
      currentPrice,
      ticker
    });

    // 매도 주문 생성
    const sellResult = generateSellOrders({
      holdings: holdings || 0,
      avgPrice,
      currentPrice,
      ticker,
      T,
      starPercent
    });

    return {
      ticker: ticker?.toUpperCase() || 'UNKNOWN',
      timestamp: new Date().toISOString(),
      input: {
        principal,
        divisions,
        avgPrice,
        totalInvested,
        holdings,
        currentPrice
      },
      calculation: {
        oneTimeBuy: roundPrice(oneTimeBuy),
        T,
        starPercent: roundPercent(starPercent),
        phase: T < 20 ? '전반전' : (T <= 40 ? '후반전' : '쿼터손절'),
        locInfo
      },
      buyOrders: buyResult.orders,
      sellOrders: sellResult.orders,
      quarterStopLoss: sellResult.quarterStopLoss,
      summary: {
        buy: buyResult.summary,
        sell: sellResult.summary
      }
    };
  }

  // =====================================================
  // Helper Functions
  // =====================================================

  /**
   * 가격 반올림 (소수점 4자리)
   * @param {number} price
   * @returns {number}
   */
  function roundPrice(price) {
    return Math.round(price * 10000) / 10000;
  }

  /**
   * 퍼센트 반올림 (소수점 2자리)
   * @param {number} percent
   * @returns {number}
   */
  function roundPercent(percent) {
    return Math.round(percent * 100) / 100;
  }

  /**
   * 달러 포맷
   * @param {number} amount
   * @param {number} decimals
   * @returns {string}
   */
  function formatDollar(amount, decimals = 2) {
    if (amount === null || amount === undefined || isNaN(amount)) return '-';
    return '$' + amount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * 퍼센트 포맷
   * @param {number} percent
   * @param {boolean} showSign
   * @returns {string}
   */
  function formatPercent(percent, showSign = false) {
    if (percent === null || percent === undefined || isNaN(percent)) return '-';
    const sign = showSign && percent > 0 ? '+' : '';
    return sign + percent.toFixed(2) + '%';
  }

  // =====================================================
  // Public API
  // =====================================================

  return {
    // Core calculations
    calculate,
    calculateT,
    calculateStarPercent,
    calculateLOC,

    // Order generation
    generateBuyOrders,
    generateSellOrders,

    // Utilities
    getSellPercent,
    getBuyLOCPrice,
    getSellLOCPrice,
    roundPrice,
    roundPercent,
    formatDollar,
    formatPercent,

    // Constants
    DEFAULT_CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IBCalculator;
}
