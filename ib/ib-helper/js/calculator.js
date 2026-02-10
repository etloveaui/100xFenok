/**
 * IB Helper Calculator - V2.2 Algorithm Implementation
 *
 * 🔴 CRITICAL: This implements the exact Genie RPA logic
 * Reference: DEV.md, Asset_Allocator/docs/references/genie-rpa-infinitebuy-guide.md
 *
 * @version 1.4.0
 * @author 100xFenok Claude
 *
 * v1.4.0 (02-05): V2.2 CAP 수정 + LOC% 연동 (#234)
 *   - LOC 매도: CAP 제거 (V2.2 원본)
 *   - LOC%: 5% 기준점으로 별% 조정 가능
 * v1.3.0 (02-03): divisions 검증 + Infinity/NaN 방지 (C-07)
 * v1.2.0 (02-03): 평단LOC 가격캡 추가 (V2.2 명세 준수)
 * v1.1.0 (02-03): sellPercent 사용자 입력 지원
 */

const IBCalculator = (function() {

  // =====================================================
  // CONSTANTS - V2.2 Parameters
  // =====================================================

  const DEFAULT_CONFIG = {
    divisions: 40,           // 기본 분할 수
    sellPercent: {
      TQQQ: 10,              // TQQQ AFTER 매도%
      SOXL: 12,              // SOXL AFTER 매도%
      DEFAULT: 10            // 기타 종목 기본값
    },
    locCapMultiplier: 1.15,  // 현재가 캡 배수 (×1.15)
    locBuyOffset: 0.01,      // 매수 LOC 차감 금액
    locSellOffsetRate: 0.005 // 매도 LOC 가산 비율 (평단가의 0.5%)
  };
  const ADDITIONAL_BUY_MODES = {
    BUDGET_RATIO: 'budget_ratio',
    FIXED: 'fixed'
  };
  const MAX_ADDITIONAL_STEPS = 8;

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
   * 별% 계산 (LOC% 연동 지원)
   *
   * @param {number} T - T값
   * @param {number} sellPercent - 매도비율 (AFTER %)
   * @param {number} locPercent - LOC% (사용자 입력, 기본 5%)
   * @returns {number} 별% (percentage as number, e.g., 9.5 for 9.5%)
   *
   * 🔴 CRITICAL: 별%는 sellPercent와 연동
   * 🔴 FORMULA: 별% = sellPercent * (1 - T / 20) + (locPercent - 5)
   *
   * 🔴 v1.4.0: LOC% 연동 추가 (#234)
   *   - LOC% = 5% (기본) → V2.2 공식 그대로
   *   - LOC% 올리면 → 별%도 그만큼 올라감
   *   - 예: LOC% = 45%, T=10 → 별% = 5% + 40% = 45%
   *
   * ✅ sellPercent가 높을수록 별% 시작점이 높아짐
   * ✅ T가 커질수록 별%는 0을 지나 음수로 내려감 (원본 설계)
   * ✅ locPercent로 별% 추가 조정 가능 (5%가 기준점)
   *
   * Examples:
   *   TQQQ (10%): T=2  → 10 × (1 - 0.1) = 9%
   *   SOXL (12%): T=2  → 12 × (1 - 0.1) = 10.8%
   *   T=20 → 별% = 0% (전후반전 기준, 진행률 50%)
   *   T=40 → TQQQ -10%, SOXL -12%
   */
  function calculateStarPercent(T, sellPercent, locPercent = 5) {
    const basePercent = Number.isFinite(parseFloat(sellPercent))
      ? parseFloat(sellPercent)
      : DEFAULT_CONFIG.sellPercent.DEFAULT;

    // V2.2 원본 공식
    const v22StarPercent = basePercent * (1 - T / 20);

    // 🔴 v1.4.0: LOC% 연동 (5%를 기준점으로)
    const parsedLocPercent = Number.isFinite(parseFloat(locPercent)) ? parseFloat(locPercent) : 5;
    const locOffset = parsedLocPercent - 5;

    return v22StarPercent + locOffset;
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
   * @param {boolean} isSell - true: 매도(CAP 없음), false: 매수(CAP 있음)
   * @returns {Object} { starPrice, currentPriceCap, locPrice, reason }
   *
   * 🔴 v1.4.0: V2.2 원본 CAP 적용 범위 수정 (#234)
   *   - LOC 매수: CAP 적용 (min(별%가, 현재가×1.15))
   *   - LOC 매도: CAP 없음! (별%가 그대로)
   *
   * 🔴 CRITICAL: Genie RPA 원본 (Page 5-6)
   *   - 평단LOC 매수: [평단] vs [현재가+15%] 작은값 ← CAP 적용
   *   - 큰수LOC 매수: [평단별%] vs [현재가+15%] 작은값 ← CAP 적용
   *   - 분할매도2(LOC 매도): [평단대비 ⭐%] ← CAP 없음!
   *
   * 패턴: T값이 높을수록 별%가 낮아지고, 현재가+15%가 LOC가로 선택될 확률 ↑ (매수만)
   */
  function calculateLOC(avgPrice, starPercent, currentPrice, isSell = false) {
    // 별%가 계산
    const starPrice = avgPrice * (1 + starPercent / 100);

    // 현재가가 없거나 매도인 경우 → 별%가만 사용 (CAP 없음)
    if (!currentPrice || currentPrice <= 0 || isSell) {
      return {
        starPrice: roundPrice(starPrice),
        currentPriceCap: 0,
        locPrice: roundPrice(starPrice),
        reason: isSell ? '별%가 사용 (V2.2 LOC 매도)' : '별%가 사용 (현재가 없음)'
      };
    }

    // 🔴 LOC 매수만 CAP 적용
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
    const {
      principal,
      divisions,
      avgPrice,
      totalInvested,
      currentPrice,
      ticker,
      sellPercent: inputSellPercent,
      locSellPercent = 5,
      additionalBuyEnabled = true,
      additionalBuyMode = ADDITIONAL_BUY_MODES.BUDGET_RATIO,
      additionalBuyOrderCount,
      additionalBuyBudgetRatio = 25,
      additionalBuyAllowOneOver = true,
      additionalBuyMaxDecline = 15,
      additionalBuyQuantity = 1
    } = params;

    // 1회 매수금
    const oneTimeBuy = principal / divisions;

    // T값 계산
    const T = calculateT(totalInvested, oneTimeBuy);

    // 별% 계산 (sellPercent + LOC% 연동)
    const effectiveSellPercent = resolveSellPercent(ticker, inputSellPercent);
    const starPercent = calculateStarPercent(T, effectiveSellPercent, locSellPercent);

    // LOC 계산
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice);
    const buyLocPrice = getBuyLOCPrice(locInfo.locPrice);

    const orders = [];
    // ========================================
    // 전반전 (T < 20): 1회 매수금을 2개로 나눔 (진행률 50% 미만)
    // ========================================
    if (T < 20) {
      const halfAmount = oneTimeBuy / 2;

      // 주문 1: 평단LOC 매수 (0% 기준)
      // 🔴 v1.2.0: 평단가도 현재가×1.15 캡 적용 (V2.2 명세)
      const priceCap = (currentPrice && currentPrice > 0)
        ? currentPrice * DEFAULT_CONFIG.locCapMultiplier
        : Infinity;
      const avgPriceBuy = roundPrice(Math.min(avgPrice, priceCap));
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
      }
    }

    // ========================================
    // 하락대비 추가매수 (전략 기반: 지정 개수)
    // ========================================
    // 🔴 FIX: 하락대비 기준가 = 가장 낮은 매수가(평단LOC 기준)
    const declineBasePrice = orders.length > 0 
      ? Math.min(...orders.map(o => o.price)) 
      : buyLocPrice;
    if (additionalBuyEnabled) {
      const config = resolveAdditionalBuyConfig({
        additionalBuyMode,
        additionalBuyOrderCount,
        additionalBuyBudgetRatio,
        additionalBuyAllowOneOver,
        additionalBuyMaxDecline,
        additionalBuyQuantity
      }, declineBasePrice, oneTimeBuy);
      const additionalOrders = generateAdditionalBuyOrders(declineBasePrice, config);
      orders.push(...additionalOrders);
    }

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

  function resolveAdditionalBuyOrderCount(params, basePrice) {
    const parsedOrderCount = parseInt(params?.additionalBuyOrderCount, 10);
    if (Number.isFinite(parsedOrderCount)) {
      return Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parsedOrderCount));
    }

    const parsedDeclinePct = parseFloat(params?.additionalBuyMaxDecline);
    const maxDeclinePct = Number.isFinite(parsedDeclinePct) ? parsedDeclinePct : 15;
    if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;

    const minPrice = basePrice * (1 - maxDeclinePct / 100);
    let price = basePrice;
    let count = 0;
    while (count < MAX_ADDITIONAL_STEPS) {
      price = roundPrice(price * 0.98);
      if (price < minPrice) break;
      count++;
    }
    return count;
  }

  function resolveAdditionalBuyConfig(params = {}, basePrice, oneTimeBuy) {
    const mode = params?.additionalBuyMode === ADDITIONAL_BUY_MODES.FIXED
      ? ADDITIONAL_BUY_MODES.FIXED
      : ADDITIONAL_BUY_MODES.BUDGET_RATIO;
    const parsedQuantity = parseInt(params?.additionalBuyQuantity, 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
    const parsedDecline = parseFloat(params?.additionalBuyMaxDecline);
    const maxDeclinePct = Number.isFinite(parsedDecline) ? parsedDecline : 15;
    const parsedOrderCount = parseInt(params?.additionalBuyOrderCount, 10);
    const explicitOrderCount = Number.isFinite(parsedOrderCount)
      ? Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parsedOrderCount))
      : null;
    const parsedRatio = parseFloat(params?.additionalBuyBudgetRatio);
    const budgetRatio = Number.isFinite(parsedRatio) ? Math.max(0, Math.min(100, parsedRatio)) : 25;
    const allowOneOver = params?.additionalBuyAllowOneOver !== false;

    const targetBudget = mode === ADDITIONAL_BUY_MODES.BUDGET_RATIO
      ? roundPrice(Math.max((oneTimeBuy || 0) * (budgetRatio / 100), 0))
      : 0;
    const resolvedOrderCount = mode === ADDITIONAL_BUY_MODES.FIXED
      ? (explicitOrderCount ?? resolveAdditionalBuyOrderCount({ additionalBuyMaxDecline: maxDeclinePct }, basePrice))
      : 0;

    return {
      mode,
      quantity,
      maxDeclinePct,
      orderCount: resolvedOrderCount,
      targetBudget,
      allowOneOver,
      maxSteps: MAX_ADDITIONAL_STEPS
    };
  }

  /**
   * 하락대비 추가매수 주문 생성
   *
   * @param {number} basePrice - 기준 가격 (현재가 또는 마지막 매수가)
   * @param {Object} options
   * @returns {Array} 추가매수 주문 배열
   */
  function generateAdditionalBuyOrders(basePrice, options = {}) {
    const orders = [];
    const stepPct = 0.02;  // 2% 복리 하락
    const mode = options.mode === ADDITIONAL_BUY_MODES.FIXED
      ? ADDITIONAL_BUY_MODES.FIXED
      : ADDITIONAL_BUY_MODES.BUDGET_RATIO;
    const parsedOrderCount = parseInt(options.orderCount, 10);
    const orderCount = Number.isFinite(parsedOrderCount) ? Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parsedOrderCount)) : 0;
    const parsedQuantity = parseInt(options.quantity, 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
    const parsedMaxSteps = parseInt(options.maxSteps, 10);
    const maxSteps = Number.isFinite(parsedMaxSteps) ? Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parsedMaxSteps)) : MAX_ADDITIONAL_STEPS;

    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      return orders;
    }

    if (mode === ADDITIONAL_BUY_MODES.BUDGET_RATIO) {
      const parsedTargetBudget = parseFloat(options.targetBudget);
      const targetBudget = Number.isFinite(parsedTargetBudget) ? Math.max(parsedTargetBudget, 0) : 0;
      const allowOneOver = options.allowOneOver !== false;
      if (targetBudget <= 0 || maxSteps <= 0) return orders;

      let price = basePrice;
      let accumulated = 0;
      for (let step = 1; step <= maxSteps; step++) {
        price = roundPrice(price * (1 - stepPct));
        if (!Number.isFinite(price) || price <= 0) break;

        const orderAmount = roundPrice(price * quantity);
        const nextTotal = accumulated + orderAmount;
        const declineFromBase = ((basePrice - price) / basePrice * 100).toFixed(1);

        if (nextTotal <= targetBudget + 0.0001) {
          orders.push({
            type: `하락대비 추가매수 ${step}`,
            description: `-${declineFromBase}% 하락 시`,
            price,
            amount: orderAmount,
            quantity,
            orderType: 'LOC'
          });
          accumulated = nextTotal;
          continue;
        }

        if (allowOneOver) {
          orders.push({
            type: `하락대비 추가매수 ${step}`,
            description: `-${declineFromBase}% 하락 시`,
            price,
            amount: orderAmount,
            quantity,
            orderType: 'LOC'
          });
        }
        break;
      }

      return orders;
    }

    if (orderCount <= 0) return orders;
    const parsedDeclinePct = parseFloat(options.maxDeclinePct);
    const useDeclineGuard = Number.isFinite(parsedDeclinePct) && parsedDeclinePct > 0;
    const minPrice = useDeclineGuard ? basePrice * (1 - parsedDeclinePct / 100) : 0;
    let price = basePrice;

    for (let step = 1; step <= orderCount; step++) {
      // 2% 복리 하락 적용
      price = roundPrice(price * (1 - stepPct));
      if (!Number.isFinite(price) || price <= 0) break;

      if (useDeclineGuard && price < minPrice) break;
      const declineFromBase = ((basePrice - price) / basePrice * 100).toFixed(1);

      orders.push({
        type: `하락대비 추가매수 ${step}`,
        description: `-${declineFromBase}% 하락 시`,
        price: price,
        amount: roundPrice(price * quantity),
        quantity,
        orderType: 'LOC'
      });
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
    // 🔴 v1.1.0: sellPercent 사용자 입력값 지원
    // Note: locSellPercent는 표시용 - LOC 가격은 별%가로 자동 계산됨
    const { holdings, avgPrice, currentPrice, ticker, T, starPercent, sellPercent: inputSellPercent } = params;

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

    // LOC 매도가 계산 (🔴 v1.4.0: isSell=true → CAP 없음)
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice, true);
    const sellLocPrice = getSellLOCPrice(locInfo.locPrice, avgPrice);

    // AFTER 매도% 결정 (🔴 v1.1.0: 사용자 입력값 우선)
    const sellPercent = resolveSellPercent(ticker, inputSellPercent);
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

  /**
   * 사용자 입력이 있으면 우선 사용, 없으면 종목 기본값 사용
   * @param {string} ticker
   * @param {number} inputSellPercent
   * @returns {number}
   */
  function resolveSellPercent(ticker, inputSellPercent) {
    const parsed = parseFloat(inputSellPercent);
    if (Number.isFinite(parsed)) return parsed;
    return getSellPercent(ticker);
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
      currentPrice,
      sellPercent: inputSellPercent,  // 🔴 v1.1.0: 사용자 입력값 우선
      locSellPercent = 5,  // 🔴 v1.4.0: LOC% 연동 (#234)
      additionalBuyEnabled = true,
      additionalBuyMode,
      additionalBuyOrderCount,
      additionalBuyBudgetRatio,
      additionalBuyAllowOneOver,
      additionalBuyMaxDecline,
      additionalBuyQuantity
    } = input;

    // Validation
    if (!avgPrice || avgPrice <= 0) {
      return { error: '평단가를 입력하세요' };
    }
    if (!principal || principal <= 0) {
      return { error: '세팅원금을 입력하세요' };
    }
    // 🔴 v1.3.0 (C-07): divisions 검증 추가 - Infinity/NaN 방지
    if (!divisions || divisions <= 0) {
      return { error: '분할 수는 1 이상이어야 합니다' };
    }

    // 1회 매수금
    const oneTimeBuy = principal / divisions;

    // 🔴 v1.3.0 (C-07): 계산 결과 검증 - Infinity/NaN 방지
    if (!Number.isFinite(oneTimeBuy)) {
      return { error: '1회 매수금 계산 오류' };
    }

    // T값 계산
    const T = calculateT(totalInvested, oneTimeBuy);

    const effectiveSellPercent = resolveSellPercent(ticker, inputSellPercent);

    // 별% 계산 (🔴 v1.4.0: LOC% 연동)
    const starPercent = calculateStarPercent(T, effectiveSellPercent, locSellPercent);

    // LOC 정보
    const locInfo = calculateLOC(avgPrice, starPercent, currentPrice);

    // 매수 주문 생성
    const buyResult = generateBuyOrders({
      principal,
      divisions,
      avgPrice,
      totalInvested,
      currentPrice,
      ticker,
      sellPercent: effectiveSellPercent,
      locSellPercent,
      additionalBuyEnabled,
      additionalBuyMode,
      additionalBuyOrderCount,
      additionalBuyBudgetRatio,
      additionalBuyAllowOneOver,
      additionalBuyMaxDecline,
      additionalBuyQuantity
    });

    // 매도 주문 생성
    // 🔴 v1.1.0: 사용자 입력 sellPercent 전달 (locSellPercent는 표시용)
    const sellResult = generateSellOrders({
      holdings: holdings || 0,
      avgPrice,
      currentPrice,
      ticker,
      T,
      starPercent,
      sellPercent: effectiveSellPercent
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
        currentPrice,
        sellPercent: inputSellPercent,
        locSellPercent,
        additionalBuyEnabled,
        additionalBuyMode,
        additionalBuyOrderCount,
        additionalBuyBudgetRatio,
        additionalBuyAllowOneOver,
        additionalBuyMaxDecline,
        additionalBuyQuantity
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
    generateAdditionalBuyOrders,

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
