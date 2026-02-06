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

  /**
   * 🔴 #236 (DEC-175): avgPrice 파생값 계산 (IIFE 내부용)
   */
  function _computeAvgPrice(totalInvested, holdings) {
    if (totalInvested > 0 && holdings > 0) {
      return parseFloat((totalInvested / holdings).toFixed(4));
    }
    return 0;
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
    const oneTimeBuy = stock.principal / (settings.splits || 40);

    // Base amount (1회 매수금)
    let total = oneTimeBuy;
    let additionalAmount = 0;

    // 하락대비 추가매수 (if enabled)
    if (settings.additionalBuy?.enabled && stock.currentPrice > 0) {
      const steps = calcAdditionalBuySteps(
        stock.currentPrice,
        settings.additionalBuy.maxDecline || 15
      );

      // LOC price calculation
      const locPrice = calcLocPrice(stock, settings);
      const qty = settings.additionalBuy.quantity || 1;

      additionalAmount = steps * locPrice * qty;
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
      price = price * (1 - STEP_RATE);
      if (price >= minPrice) count++;
    }

    return count; // Usually 8-9 steps for 15%
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
      const oneTimeBuy = stock.principal / (settings.splits || 40);
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
    const T = Math.ceil(((stock.avgPrice * stock.quantity) / (stock.principal / 40)) * 10) / 10;
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

    const details = [];
    let total = 0;

    profile.stocks.forEach(stock => {
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

    return {
      available: balance,
      required: dailyAttempt,
      diff: roundPrice(diff),
      status: diff >= 0 ? 'OK' : 'INSUFFICIENT',
      statusKo: diff >= 0 ? '여유' : '부족',
      shortfall: diff < 0 ? roundPrice(Math.abs(diff)) : 0,
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

    // Get current status
    const status = calcOrderStatus(profile);

    if (status.status === 'INSUFFICIENT') {
      return {
        show: true,
        message: `내일 매수 부족! 부족금액: $${status.shortfall.toFixed(2)}`,
        shortfall: status.shortfall,
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
