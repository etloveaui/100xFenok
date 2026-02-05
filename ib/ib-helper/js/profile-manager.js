/**
 * Profile Manager - Multi-Profile Support for IB Helper
 *
 * Manages multiple user profiles with localStorage persistence.
 * Supports 5 family members with individual stock settings.
 *
 * @version 1.2.2
 * @see PHASE2_SPEC.md
 *
 * v1.2.2 (02-03): resetToDefaults() - daily data 삭제 추가 (SSOT 원칙)
 * v1.2.1 (02-03): getAll() - JSON.parse 예외 처리 추가 (C-06)
 * v1.2.0 (02-03): createWithId() for sheet sync ID preservation
 * v1.1.0 (02-03): Korean name ID fix, saveDailyData simplification
 */

const ProfileManager = (function() {

  const STORAGE_KEY = 'ib_profiles';

  function sanitizeProfileId(name = '') {
    const cleaned = (name || '').trim().replace(/[^0-9A-Za-z가-힣_-]/g, '');
    return cleaned || 'profile';
  }

  // =====================================================
  // Default Profiles - Empty (Users add their own)
  // =====================================================

  const DEFAULT_PROFILES = {};  // Empty - users add their own profiles

  // =====================================================
  // Initialize
  // =====================================================

  /**
   * Initialize profiles (start empty - users add their own)
   * @returns {Object|null} Active profile or null if none
   */
  function init() {
    const existing = getAll();
    if (!existing) {
      // First time - start with empty profiles
      const data = {
        version: '1.0',
        activeProfileId: null,  // No active profile until user creates one
        profiles: {}
      };
      save(data);
    }
    return getActive();
  }

  // =====================================================
  // CRUD Operations
  // =====================================================

  /**
   * Get all profile data
   * 🔴 v1.2.1: JSON.parse 예외 처리 추가 (C-06)
   * @returns {Object|null}
   */
  function getAll() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      console.error('ProfileManager.getAll: localStorage 파싱 오류', error);
      // 손상된 데이터 삭제하고 null 반환
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  /**
   * Save all profile data
   * @param {Object} data
   */
  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Get active profile
   * @returns {Object|null}
   */
  function getActive() {
    const data = getAll();
    return data?.profiles[data.activeProfileId] || null;
  }

  /**
   * Get active profile ID
   * @returns {string|null}
   */
  function getActiveId() {
    const data = getAll();
    return data?.activeProfileId || null;
  }

  /**
   * Set active profile
   * @param {string} profileId
   * @returns {boolean} Success
   */
  function setActive(profileId) {
    const data = getAll();
    if (data.profiles[profileId]) {
      data.activeProfileId = profileId;
      save(data);
      return true;
    }
    return false;
  }

  /**
   * Get specific profile by ID
   * @param {string} profileId
   * @returns {Object|null}
   */
  function getById(profileId) {
    const data = getAll();
    return data?.profiles[profileId] || null;
  }

  /**
   * Get all profiles as array
   * @returns {Array}
   */
  function getAllProfiles() {
    const data = getAll();
    return data ? Object.values(data.profiles) : [];
  }

  /**
   * Create new profile
   * @param {string} name
   * @param {string} accountNumber
   * @returns {string} New profile ID
   */
  function create(name, accountNumber = '') {
    const data = getAll();
    const baseId = sanitizeProfileId(name).substring(0, 20);
    const id = `${baseId}_${Date.now()}`;

    data.profiles[id] = {
      id,
      name,
      accountNumber,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      settings: {
        method: 'V2.2',
        splits: 40,
        sellRatio: 12,
        partialSellRatio: 6,
        additionalBuy: {
          enabled: true,
          maxDecline: 15,
          quantity: 1
        }
      },
      stocks: []
    };

    save(data);
    return id;
  }

  /**
   * 🔴 v1.2.0: Create profile with specific ID (시트 동기화용)
   * @param {string} id - 시트에서 가져온 원본 프로필 ID
   * @param {string} name - 프로필 이름
   * @param {string} accountNumber
   * @returns {string} 동일한 profile ID
   */
  function createWithId(id, name, accountNumber = '') {
    const data = getAll();

    // 이미 존재하면 업데이트만
    if (data.profiles[id]) {
      data.profiles[id].name = name;
      data.profiles[id].updated = new Date().toISOString();
      save(data);
      return id;
    }

    data.profiles[id] = {
      id,
      name,
      accountNumber,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      settings: {
        method: 'V2.2',
        splits: 40,
        sellRatio: 12,
        partialSellRatio: 6,
        additionalBuy: {
          enabled: true,
          maxDecline: 15,
          quantity: 1
        }
      },
      stocks: []
    };

    save(data);
    return id;
  }

  /**
   * Update profile
   * @param {string} profileId
   * @param {Object} updates - Partial profile updates
   * @returns {boolean} Success
   */
  function update(profileId, updates) {
    const data = getAll();
    if (data.profiles[profileId]) {
      // Deep merge for nested objects
      const profile = data.profiles[profileId];

      if (updates.settings) {
        profile.settings = { ...profile.settings, ...updates.settings };
        delete updates.settings;
      }

      data.profiles[profileId] = {
        ...profile,
        ...updates,
        updated: new Date().toISOString()
      };

      save(data);
      return true;
    }
    return false;
  }

  /**
   * Delete profile
   * @param {string} profileId
   * @returns {boolean} Success
   */
  function deleteProfile(profileId) {
    const data = getAll();

    // Cannot delete active profile
    if (profileId === data.activeProfileId) {
      console.warn('Cannot delete active profile');
      return false;
    }

    // Cannot delete if only one profile left
    if (Object.keys(data.profiles).length <= 1) {
      console.warn('Cannot delete last profile');
      return false;
    }

    delete data.profiles[profileId];
    save(data);
    return true;
  }

  // =====================================================
  // Stock Management
  // =====================================================

  /**
   * Add stock to profile
   * @param {string} profileId
   * @param {Object} stock - { symbol, principal, sellPercent, locSellPercent }
   * @returns {boolean} Success
   */
  function addStock(profileId, stock) {
    const data = getAll();
    const profile = data.profiles[profileId];

    if (!profile) return false;

    // Check if stock already exists
    const existingIndex = profile.stocks.findIndex(s => s.symbol === stock.symbol);
    if (existingIndex >= 0) {
      // Update existing
      profile.stocks[existingIndex] = { ...profile.stocks[existingIndex], ...stock };
    } else {
      // Add new
      profile.stocks.push(stock);
    }

    profile.updated = new Date().toISOString();
    save(data);
    return true;
  }

  /**
   * Remove stock from profile
   * @param {string} profileId
   * @param {string} symbol
   * @returns {boolean} Success
   */
  function removeStock(profileId, symbol) {
    const data = getAll();
    const profile = data.profiles[profileId];

    if (!profile) return false;

    profile.stocks = profile.stocks.filter(s => s.symbol !== symbol);
    profile.updated = new Date().toISOString();
    save(data);
    return true;
  }

  /**
   * Get stock from active profile
   * @param {string} symbol
   * @returns {Object|null}
   */
  function getStock(symbol) {
    const profile = getActive();
    if (!profile) return null;
    return profile.stocks.find(s => s.symbol === symbol) || null;
  }

  /**
   * Get stock enabled state (default: true)
   * @param {string} symbol
   * @returns {boolean}
   */
  function isStockEnabled(symbol) {
    const stock = getStock(symbol);
    return stock?.enabled ?? true;
  }

  /**
   * Set stock enabled state for active profile
   * @param {string} symbol
   * @param {boolean} enabled
   * @returns {boolean} Success
   */
  function setStockEnabled(symbol, enabled) {
    const data = getAll();
    if (!data) return false;
    const profileId = data.activeProfileId;
    const profile = data.profiles[profileId];
    if (!profile) return false;
    const index = profile.stocks.findIndex(s => s.symbol === symbol);
    if (index < 0) return false;
    profile.stocks[index] = { ...profile.stocks[index], enabled: Boolean(enabled) };
    profile.updated = new Date().toISOString();
    save(data);
    return true;
  }

  // =====================================================
  // Export / Import
  // =====================================================

  /**
   * Export profile as JSON string
   * @param {string} profileId
   * @returns {string} JSON string
   */
  function exportProfile(profileId) {
    const profile = getById(profileId);
    if (!profile) return null;
    return JSON.stringify(profile, null, 2);
  }

  /**
   * Export all profiles as JSON string
   * @returns {string} JSON string
   */
  function exportAll() {
    return JSON.stringify(getAll(), null, 2);
  }

  /**
   * Import profile from JSON string
   * @param {string} jsonString
   * @returns {string|null} New profile ID or null on error
   */
  function importProfile(jsonString) {
    try {
      const profile = JSON.parse(jsonString);
      const data = getAll();

      // Generate new ID to avoid conflicts
      profile.id = profile.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
      profile.created = new Date().toISOString();
      profile.updated = new Date().toISOString();

      data.profiles[profile.id] = profile;
      save(data);
      return profile.id;
    } catch (e) {
      console.error('Import failed:', e);
      return null;
    }
  }

  /**
   * Reset to default profiles
   * 🔴 v1.2.2: daily data도 삭제 (SSOT 원칙 - 완전한 초기화)
   * @returns {boolean} Success
   */
  function resetToDefaults() {
    // 1. 프로필 데이터 삭제
    localStorage.removeItem(STORAGE_KEY);

    // 2. 🔴 v1.2.2: daily data 삭제 (ib_daily_data_* 키들)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DAILY_KEY)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log(`ProfileManager.resetToDefaults: Cleared ${keysToRemove.length} daily data keys`);

    init();
    return true;
  }

  // =====================================================
  // Daily Data (Volatile)
  // =====================================================

  const DAILY_KEY = 'ib_daily_data';

  /**
   * Save daily input data (평단가, 총매입금, 보유량, 현재가)
   * @param {string} profileId
   * @param {string} symbol
   * @param {Object} data - { avgPrice, totalInvested, holdings, currentPrice }
   */
  function saveDailyData(profileId, symbol, dailyData) {
    const key = `${DAILY_KEY}_${profileId}_${symbol}`;
    // v1.1.0: 날짜 생성 간소화
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const saved = {
      ...dailyData,
      date,
      timestamp: now.toISOString()
    };
    localStorage.setItem(key, JSON.stringify(saved));
  }

  /**
   * Load daily input data
   * @param {string} profileId
   * @param {string} symbol
   * @returns {Object|null}
   */
  function loadDailyData(profileId, symbol) {
    const key = `${DAILY_KEY}_${profileId}_${symbol}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  // =====================================================
  // Public API
  // =====================================================

  return {
    // Core
    init,
    getAll,
    save,

    // Profile CRUD
    getActive,
    getActiveId,
    setActive,
    getById,
    getAllProfiles,
    create,
    createWithId,  // v1.2.0: 시트 동기화용
    update,
    delete: deleteProfile,

    // Stock management
    addStock,
    removeStock,
    getStock,
    isStockEnabled,
    setStockEnabled,

    // Export/Import
    exportProfile,
    exportAll,
    importProfile,
    resetToDefaults,

    // Daily data
    saveDailyData,
    loadDailyData,

    // Constants
    STORAGE_KEY,
    DEFAULT_PROFILES
  };

})();

// Auto-initialize on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    ProfileManager.init();
  });
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProfileManager;
}
