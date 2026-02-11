/**
 * IB Helper Balance Manager - Phase 3
 *
 * 예수금 관리 + 부족 알림 기능
 *
 * @version 1.0.0
 * @author 100xFenok Claude
 * @spec _tmp/PHASE3_SPEC.md (Asset Allocator)
 */

const BalanceManager = (function() {

  // =====================================================
  // CONSTANTS
  // =====================================================

  const STEP_RATE = 0.02;       // 2% compound decline
  const MAX_DECLINE_PCT = 0.15; // Max -15%
  const ADDITIONAL_BUY_CACHE_TTL = 5 * 60 * 1000;
  const MAX_ADDITIONAL_STEPS = 8;
  const ADDITIONAL_BUY_MODES = {
    BUDGET_RATIO: 'budget_ratio',
    FIXED: 'fixed'
  };

  const additionalBuyCache = new Map();

  /**
   * 🔴 #236 (DEC-175): avgPrice 파생값 계산 (IIFE 내부용)
   */
  function _computeAvgPrice(totalInvested, holdings) {
    if (totalInvested > 0 && holdings > 0) {
      return parseFloat((totalInvested / holdings).toFixed(4));
    }
    return 0;
  }

  function resolveSplits(settings, stock) {
    const fromSettings = parseInt(settings?.splits, 10);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
      return fromSettings;
    }
    const fromStock = parseInt(stock?.divisions, 10);
    if (Number.isFinite(fromStock) && fromStock > 0) {
      return fromStock;
    }
    return 40;
  }

  function resolveAdditionalBuyConfig(settings = {}, oneTimeBuy, basePrice) {
    const additional = settings?.additionalBuy || {};
    const mode = additional.mode === ADDITIONAL_BUY_MODES.FIXED
      ? ADDITIONAL_BUY_MODES.FIXED
      : ADDITIONAL_BUY_MODES.BUDGET_RATIO;
    const parsedQuantity = parseInt(additional.quantity, 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
    const parsedRatio = parseFloat(additional.budgetRatio);
    const budgetRatio = Number.isFinite(parsedRatio) ? Math.max(0, Math.min(100, parsedRatio)) : 20;
    const parsedDecline = parseFloat(additional.maxDecline);
    const maxDecline = Number.isFinite(parsedDecline) ? parsedDecline : 15;
    const explicitOrderCount = parseInt(additional.orderCount, 10);
    const orderCount = mode === ADDITIONAL_BUY_MODES.FIXED
      ? _resolveFixedOrderCount(explicitOrderCount, basePrice, maxDecline)
      : 0;
    const targetBudget = mode === ADDITIONAL_BUY_MODES.BUDGET_RATIO
      ? roundPrice(Math.max((oneTimeBuy || 0) * (budgetRatio / 100), 0))
      : 0;
    return {
      mode,
      quantity,
      budgetRatio,
      allowOneOver: additional.allowOneOver !== false,
      maxDecline,
      orderCount,
      targetBudget,
      maxSteps: MAX_ADDITIONAL_STEPS
    };
  }

  // =====================================================
  // Core Calculations
  // =====================================================

  /**
   * Calculate daily buy attempt amount for a single stock
   *
   * @param {Object} stock - Stock data (symbol, principal, avgPrice, currentPrice, quantity)
   * @param {Object} settings - Profile settings (splits, additionalBuy)
   * @returns {Object} { oneTimeBuy, additionalAmount, total }
   */
  function calcStockDailyAttempt(stock, settings) {
    const splits = resolveSplits(settings, stock);
    const oneTimeBuy = stock.principal / splits;

    // Base amount (1회 매수금)
    let total = oneTimeBuy;
    let additionalAmount = 0;

    // 하락대비 추가매수 (if enabled)
    if (settings?.additionalBuy?.enabled) {
      const declineBasePrice = calcDeclineBasePrice(stock, settings);
      const additionalConfig = resolveAdditionalBuyConfig(settings, oneTimeBuy, declineBasePrice);
      additionalAmount = calcAdditionalBuyAmount(stock, declineBasePrice, additionalConfig);
      total += additionalAmount;
    }

    return {
      symbol: stock.symbol,
      oneTimeBuy: roundPrice(oneTimeBuy),
      additionalAmount: roundPrice(additionalAmount),
      total: roundPrice(total),
      percentage: 0 // calculated later
    };
  }

  /**
   * Calculate number of additional buy steps (2% compound)
   *
   * @param {number} currentPrice - Current price
   * @param {number} maxDeclinePct - Max decline percentage (e.g., 15 for 15%)
   * @returns {number} Number of steps
   */
  function calcAdditionalBuySteps(currentPrice, maxDeclinePct) {
    const minPrice = currentPrice * (1 - maxDeclinePct / 100);

    let count = 0;
    let price = currentPrice;

    while (price > minPrice) {
      // Match calculator precision to reduce boundary mismatch.
      price = Math.round(price * (1 - STEP_RATE) * 10000) / 10000;
      if (price >= minPrice) count++;
    }

    return count; // Usually 8-9 steps for 15%
  }

  function _resolveFixedOrderCount(explicitOrderCount, basePrice, maxDecline) {
    if (Number.isFinite(explicitOrderCount)) {
      return Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, explicitOrderCount));
    }
    return Math.min(calcAdditionalBuySteps(basePrice, maxDecline), MAX_ADDITIONAL_STEPS);
  }

  function calcDeclineBasePrice(stock, settings) {
    // 🔴 FIX: calculator.js와 동일하게 평단LOC 기준으로 수정
    // 전반전(T < 20): 평단LOC vs 큰수LOC 중 더 낮은 가격
    // 후반전(T >= 20): 큰수LOC 가격
    const splits = resolveSplits(settings, stock);
    const oneTimeBuy = stock.principal / splits;
    const totalInvested = (stock.avgPrice || 0) * (stock.quantity || 0);
    const T = (typeof IBCalculator !== 'undefined')
      ? IBCalculator.calculateT(totalInvested, oneTimeBuy)
      : 0;
    
    // 큰수LOC 가격 계산
    const locPrice = calcLocPrice(stock, settings);
    
    // 전반전일 때는 평단LOC도 계산해서 비교
    if (T < 20 && stock.avgPrice > 0) {
      const priceCap = (stock.currentPrice && stock.currentPrice > 0)
        ? stock.currentPrice * 1.15
        : Infinity;
      const avgPriceBuy = Math.min(stock.avgPrice, priceCap);
      const avgLocPrice = (typeof IBCalculator !== 'undefined' &&
          typeof IBCalculator.getBuyLOCPrice === 'function')
        ? IBCalculator.getBuyLOCPrice(avgPriceBuy)
        : roundPrice(avgPriceBuy - 0.01);
      // 더 낮은 가격 선택 (평단LOC 기준)
      const declineBasePrice = Math.min(avgLocPrice, locPrice);
      return declineBasePrice > 0 ? declineBasePrice : locPrice;
    }
    
    // 후반전 또는 fallback: 큰수LOC 기준
    if (!Number.isFinite(locPrice) || locPrice <= 0) return 0;
    if (typeof IBCalculator !== 'undefined' &&
        typeof IBCalculator.getBuyLOCPrice === 'function') {
      return IBCalculator.getBuyLOCPrice(locPrice);
    }
    return roundPrice(locPrice - 0.01);
  }

  /**
   * Calculate LOC price for a stock
   * Uses Calculator module if available
   *
   * @param {Object} stock - Stock data
   * @param {Object} settings - Profile settings
   * @returns {number} LOC price
   */
  function calcLocPrice(stock, settings) {
    // Use IBCalculator if available
    if (typeof IBCalculator !== 'undefined') {
      const splits = resolveSplits(settings, stock);
      const oneTimeBuy = stock.principal / splits;
      const totalInvested = (stock.avgPrice || 0) * (stock.quantity || 0);
      const T = IBCalculator.calculateT(totalInvested, oneTimeBuy);
      const parsedSellPercent = parseFloat(stock.sellPercent);
      const parsedLocPercent = parseFloat(stock.locSellPercent);
      const effectiveSellPercent = Number.isFinite(parsedSellPercent)
        ? parsedSellPercent
        : IBCalculator.getSellPercent(stock.symbol);
      const effectiveLocPercent = Number.isFinite(parsedLocPercent) ? parsedLocPercent : 5;
      const starPct = IBCalculator.calculateStarPercent(T, effectiveSellPercent, effectiveLocPercent);
      const locInfo = IBCalculator.calculateLOC(stock.avgPrice, starPct, stock.currentPrice);
      return locInfo.locPrice;
    }

    // Fallback: simple calculation
    // 🔴 Note: 이 함수는 매수용 (additionalBuy) → CAP 적용 유지
    const splits = resolveSplits(settings, stock);
    const principalPerSplit = stock.principal / splits;
    const T = principalPerSplit > 0
      ? Math.ceil(((stock.avgPrice * stock.quantity) / principalPerSplit) * 10) / 10
      : 0;
    const fallbackSellPercent = Number.isFinite(parseFloat(stock.sellPercent))
      ? parseFloat(stock.sellPercent)
      : (stock.symbol === 'SOXL' ? 12 : 10);
    const fallbackLocPercent = Number.isFinite(parseFloat(stock.locSellPercent))
      ? parseFloat(stock.locSellPercent)
      : 5;
    const starPct = (fallbackSellPercent * (1 - T / 20) + (fallbackLocPercent - 5)) / 100;
    const starPrice = stock.avgPrice * (1 + starPct);
    const locCap = stock.currentPrice * 1.15;
    return Math.min(starPrice, locCap);  // 매수용이므로 CAP 적용
  }

  /**
   * Calculate total daily buy attempt for all stocks in profile
   *
   * @param {Object} profile - Profile object with stocks and settings
   * @returns {Object} { total, details[] }
   */
  function calcDailyBuyAttempt(profile) {
    if (!profile || !profile.stocks || profile.stocks.length === 0) {
      return { total: 0, details: [] };
    }

    const activeStocks = profile.stocks.filter(stock => stock?.enabled !== false);
    if (activeStocks.length === 0) {
      return { total: 0, details: [] };
    }

    const details = [];
    let total = 0;

    activeStocks.forEach(stock => {
      // Get daily data for this stock
      const dailyData = ProfileManager.loadDailyData(profile.id, stock.symbol) || {};

      // 🔴 #236 (DEC-175): avgPrice를 파생값으로 계산
      const stockWithData = {
        ...stock,
        avgPrice: _computeAvgPrice(dailyData.totalInvested || 0, dailyData.holdings || 0),
        currentPrice: dailyData.currentPrice || 0,
        quantity: dailyData.holdings || 0
      };

      const result = calcStockDailyAttempt(stockWithData, profile.settings);
      details.push(result);
      total += result.total;
    });

    // Calculate percentages
    details.forEach(d => {
      d.percentage = total > 0 ? parseFloat((d.total / total * 100).toFixed(1)) : 0;
    });

    return { total: roundPrice(total), details };
  }

  /**
   * Calculate order status (여유/부족)
   *
   * @param {Object} profile - Profile with balance and stocks
   * @returns {Object} Order status info
   */
  function calcOrderStatus(profile) {
    const balance = profile.settings?.balance?.available || 0;
    const { total: dailyAttempt, details } = calcDailyBuyAttempt(profile);
    const diff = balance - dailyAttempt;

    // v4.50.0: Tomorrow check — after today's buy, can tomorrow be covered?
    const remainingAfterToday = Math.max(0, balance - dailyAttempt);
    const tomorrowDiff = remainingAfterToday - dailyAttempt;
    const todayShortfall = diff < 0 ? roundPrice(Math.abs(diff)) : 0;
    const tmrShortfall = tomorrowDiff < 0 ? roundPrice(Math.abs(tomorrowDiff)) : 0;

    return {
      available: balance,
      required: dailyAttempt,
      diff: roundPrice(diff),
      status: diff >= 0 ? 'OK' : 'INSUFFICIENT',
      statusKo: diff >= 0 ? '여유' : '부족',
      shortfall: todayShortfall,
      totalShortfall: roundPrice(todayShortfall + tmrShortfall),
      remainingAfterToday: roundPrice(remainingAfterToday),
      tomorrowDiff: roundPrice(tomorrowDiff),
      tomorrowStatus: tomorrowDiff >= 0 ? 'OK' : 'INSUFFICIENT',
      tomorrowShortfall: tmrShortfall,
      details
    };
  }

  // =====================================================
  // Balance Management
  // =====================================================

  /**
   * Update balance for a profile
   *
   * @param {string} profileId - Profile ID
   * @param {number} amount - New balance amount
   */
  function updateBalance(profileId, amount) {
    const data = ProfileManager.getAll();
    const profile = data.profiles[profileId];

    if (!profile) return;

    if (!profile.settings.balance) {
      profile.settings.balance = { currency: 'USD' };
    }

    profile.settings.balance.available = parseFloat(amount) || 0;
    profile.settings.balance.lastUpdated = new Date().toISOString();

    ProfileManager.save(data);
  }

  /**
   * Update commission rate for a profile
   *
   * @param {string} profileId - Profile ID
   * @param {number} rate - Commission rate (percent value, e.g. 0.07)
   */
  function updateCommissionRate(profileId, rate) {
    const data = ProfileManager.getAll();
    const profile = data.profiles[profileId];

    if (!profile) return;

    if (!profile.settings.balance) {
      profile.settings.balance = { currency: 'USD' };
    }

    const numRate = parseFloat(rate);
    profile.settings.balance.commissionRate = Number.isFinite(numRate) ? numRate : 0;
    profile.settings.balance.lastUpdated = new Date().toISOString();

    ProfileManager.save(data);
  }

  /**
   * Get balance for a profile
   *
   * @param {string} profileId - Profile ID
   * @returns {Object} Balance info
   */
  function getBalance(profileId) {
    const profile = ProfileManager.getAll().profiles[profileId];
    return profile?.settings?.balance || { available: 0, currency: 'USD' };
  }

  /**
   * Get commission rate for a profile
   *
   * @param {string} profileId - Profile ID
   * @returns {number} Commission rate (percent value)
   */
  function getCommissionRate(profileId) {
    const profile = ProfileManager.getAll().profiles[profileId];
    const rate = profile?.settings?.balance?.commissionRate;
    return Number.isFinite(rate) ? rate : null;
  }

  /**
   * Recalculate and cache order status
   *
   * @param {string} profileId - Profile ID
   * @returns {Object} Order status
   */
  function recalculate(profileId) {
    const data = ProfileManager.getAll();
    const profile = data.profiles[profileId];

    if (!profile) return null;

    const status = calcOrderStatus(profile);

    // Cache calculated values
    profile.calculated = {
      dailyBuyAttempt: status.required,
      orderStatus: status.status,
      shortfall: status.shortfall,
      lastCalculated: new Date().toISOString()
    };

    ProfileManager.save(data);
    return status;
  }

  // =====================================================
  // Alert System
  // =====================================================

  /**
   * Check if alert should be shown
   *
   * @param {string} profileId - Profile ID
   * @returns {Object} Alert info { show, message, shortfall }
   */
  function checkAlert(profileId) {
    const profile = ProfileManager.getAll().profiles[profileId];

    if (!profile) return { show: false };

    const status = calcOrderStatus(profile);

    // v4.50.0: Combined today+tomorrow shortage
    if (status.status === 'INSUFFICIENT') {
      const msg = status.tomorrowShortfall > 0
        ? `오늘 부족 $${status.shortfall.toFixed(2)} / 내일 부족 $${status.tomorrowShortfall.toFixed(2)} (총 $${status.totalShortfall.toFixed(2)})`
        : `오늘 매수 부족! 부족금액: $${status.shortfall.toFixed(2)}`;
      return {
        show: true,
        message: msg,
        shortfall: status.shortfall,
        totalShortfall: status.totalShortfall,
        required: status.required,
        available: status.available
      };
    }

    if (status.tomorrowStatus === 'INSUFFICIENT') {
      return {
        show: true,
        message: `내일 매수 부족! 부족금액: $${status.tomorrowShortfall.toFixed(2)}`,
        shortfall: status.tomorrowShortfall,
        totalShortfall: status.totalShortfall,
        required: status.required,
        available: status.available
      };
    }

    return { show: false };
  }

  // =====================================================
  // Helpers
  // =====================================================

  function roundPrice(price) {
    return Math.round(price * 100) / 100;
  }

  function calcAdditionalBuyAmount(stock, basePrice, options) {
    const qty = Math.max(options?.quantity || 1, 0);
    if (!Number.isFinite(basePrice) || basePrice <= 0 || qty <= 0) {
      return 0;
    }
    if (options?.mode === ADDITIONAL_BUY_MODES.FIXED && (!Number.isFinite(options.orderCount) || options.orderCount <= 0)) {
      return 0;
    }
    if (options?.mode === ADDITIONAL_BUY_MODES.BUDGET_RATIO && (!Number.isFinite(options.targetBudget) || options.targetBudget <= 0)) {
      return 0;
    }

    const cacheKey = [
      stock.symbol || 'UNKNOWN',
      basePrice,
      options.mode,
      qty,
      options.orderCount || 0,
      options.targetBudget || 0,
      options.allowOneOver ? 1 : 0,
      options.maxDecline || 15
    ].join('|');
    const cached = _getCachedAdditionalAmount(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let generated = [];
    if (typeof IBCalculator !== 'undefined' &&
        typeof IBCalculator.generateAdditionalBuyOrders === 'function') {
      generated = IBCalculator.generateAdditionalBuyOrders(basePrice, {
        mode: options.mode,
        orderCount: options.orderCount,
        quantity: qty,
        maxDeclinePct: options.mode === ADDITIONAL_BUY_MODES.FIXED ? options.maxDecline : undefined,
        targetBudget: options.targetBudget,
        allowOneOver: options.allowOneOver,
        maxSteps: options.maxSteps
      }) || [];
    } else {
      generated = _generateAdditionalBuyOrdersFallback(basePrice, options);
    }

    const total = generated.reduce((sum, order) => {
      const orderPrice = parseFloat(order?.price);
      const orderQty = parseFloat(order?.quantity);
      if (!Number.isFinite(orderPrice) || !Number.isFinite(orderQty)) return sum;
      return sum + (orderPrice * orderQty);
    }, 0);
    const roundedTotal = roundPrice(total);
    _setCachedAdditionalAmount(cacheKey, roundedTotal);
    return roundedTotal;
  }

  function _generateAdditionalBuyOrdersFallback(basePrice, options) {
    const orders = [];
    const mode = options.mode === ADDITIONAL_BUY_MODES.FIXED
      ? ADDITIONAL_BUY_MODES.FIXED
      : ADDITIONAL_BUY_MODES.BUDGET_RATIO;
    const qty = Math.max(parseInt(options.quantity, 10) || 0, 1);
    const maxSteps = Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parseInt(options.maxSteps, 10) || MAX_ADDITIONAL_STEPS));
    let price = basePrice;

    if (mode === ADDITIONAL_BUY_MODES.BUDGET_RATIO) {
      const targetBudget = Number.isFinite(options.targetBudget) ? Math.max(options.targetBudget, 0) : 0;
      const allowOneOver = options.allowOneOver !== false;
      if (targetBudget <= 0 || maxSteps <= 0) return orders;
      let accumulated = 0;
      for (let step = 1; step <= maxSteps; step++) {
        price = roundPrice(price * (1 - STEP_RATE));
        if (!Number.isFinite(price) || price <= 0) break;
        const amount = roundPrice(price * qty);
        const next = accumulated + amount;
        const declineFromBase = ((basePrice - price) / basePrice * 100).toFixed(1);
        if (next <= targetBudget + 0.0001) {
          orders.push({
            type: `하락대비 추가매수 ${step}`,
            description: `-${declineFromBase}% 하락 시`,
            price,
            amount,
            quantity: qty,
            orderType: 'LOC'
          });
          accumulated = next;
          continue;
        }
        if (allowOneOver) {
          orders.push({
            type: `하락대비 추가매수 ${step}`,
            description: `-${declineFromBase}% 하락 시`,
            price,
            amount,
            quantity: qty,
            orderType: 'LOC'
          });
        }
        break;
      }
      return orders;
    }

    const orderCount = Math.max(0, Math.min(MAX_ADDITIONAL_STEPS, parseInt(options.orderCount, 10) || 0));
    if (orderCount <= 0) return orders;
    const parsedDecline = parseFloat(options.maxDecline);
    const useDeclineGuard = Number.isFinite(parsedDecline) && parsedDecline > 0;
    const minPrice = useDeclineGuard ? basePrice * (1 - parsedDecline / 100) : 0;
    for (let step = 1; step <= orderCount; step++) {
      price = roundPrice(price * (1 - STEP_RATE));
      if (!Number.isFinite(price) || price <= 0) break;
      if (useDeclineGuard && price < minPrice) break;
      const declineFromBase = ((basePrice - price) / basePrice * 100).toFixed(1);
      orders.push({
        type: `하락대비 추가매수 ${step}`,
        description: `-${declineFromBase}% 하락 시`,
        price,
        amount: roundPrice(price * qty),
        quantity: qty,
        orderType: 'LOC'
      });
    }
    return orders;
  }

  function _getCachedAdditionalAmount(key) {
    const cached = additionalBuyCache.get(key);
    if (!cached) return null;
    if (cached.expires > Date.now()) {
      return cached.value;
    }
    additionalBuyCache.delete(key);
    return null;
  }

  function _setCachedAdditionalAmount(key, value) {
    additionalBuyCache.set(key, {
      value,
      expires: Date.now() + ADDITIONAL_BUY_CACHE_TTL
    });
  }

  // =====================================================
  // Public API
  // =====================================================

  return {
    // Core calculations
    calcDailyBuyAttempt,
    calcOrderStatus,
    calcStockDailyAttempt,
    calcAdditionalBuySteps,
    calcLocPrice,

    // Balance management
    updateBalance,
    getBalance,
    updateCommissionRate,
    getCommissionRate,
    recalculate,

    // Alert system
    checkAlert,

    // Constants
    STEP_RATE,
    MAX_DECLINE_PCT
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BalanceManager;
}
