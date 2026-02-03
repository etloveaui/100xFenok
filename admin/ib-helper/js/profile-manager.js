/**
 * Profile Manager - Multi-Profile Support for IB Helper
 *
 * Manages multiple user profiles with localStorage persistence.
 * Supports 5 family members with individual stock settings.
 *
 * @version 1.0.0
 * @see PHASE2_SPEC.md
 */

const ProfileManager = (function() {

  const STORAGE_KEY = 'ib_profiles';

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
   * @returns {Object|null}
   */
  function getAll() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
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
    const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();

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
   * @returns {boolean} Success
   */
  function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
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
    const saved = {
      ...dailyData,
      date: (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })(),
      timestamp: new Date().toISOString()
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
    update,
    delete: deleteProfile,

    // Stock management
    addStock,
    removeStock,
    getStock,

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
