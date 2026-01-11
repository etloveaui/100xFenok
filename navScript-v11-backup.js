/**
 * Nav V11 JavaScript - Production Version
 * - Search autocomplete (symbol/menu)
 * - Notification system (localStorage)
 * - Live Ticker simulation
 * - Sticky Nav compression
 * - Mobile menu (slide-in)
 * - SPA navigation integration
 * - URL sharing (brand click)
 */

// ========================================
//   1. Configuration & Sample Data
// ========================================
const NavConfig = {
  stickyThreshold: 50,
  tickerUpdateInterval: 30000,
  searchDebounceMs: 150,
  notificationStorageKey: 'nav_notifications_v11',
};

const SampleData = {
  symbols: [
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'ETF' },
    { symbol: 'AAPL', name: 'Apple Inc.', type: 'Stock' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'Stock' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'Stock' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'Stock' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'Stock' },
    { symbol: 'TSLA', name: 'Tesla Inc.', type: 'Stock' },
    { symbol: 'BTC', name: 'Bitcoin', type: 'Crypto' },
    { symbol: 'ETH', name: 'Ethereum', type: 'Crypto' },
  ],
  menus: [
    { name: 'Market Radar', path: 'tools/macro-monitor/index.html', icon: 'chart-line' },
    { name: 'Multichart', path: 'tools/asset/multichart.html', icon: 'chart-area' },
    { name: 'Market Wrap', path: '100x/100x-main.html', icon: 'newspaper' },
    { name: 'Alpha Scout', path: 'alpha-scout/alpha-scout-main.html', icon: 'crosshairs' },
    { name: 'Insights', path: 'posts/posts-main.html', icon: 'lightbulb' },
  ],
  tickerItems: [
    { symbol: 'SPY', price: 595.42, change: 0.85 },
    { symbol: 'QQQ', price: 518.73, change: 1.12 },
    { symbol: 'VIX', price: 13.45, change: -5.23 },
  ],
};

// ========================================
//   2. Search Autocomplete System
// ========================================
class SearchAutocomplete {
  constructor(inputEl, suggestionsEl) {
    this.input = inputEl;
    this.suggestions = suggestionsEl;
    this.highlightedIndex = -1;
    this.results = [];
    this.debounceTimer = null;

    this.init();
  }

  init() {
    if (!this.input || !this.suggestions) return;

    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (e) => this.onKeydown(e));
    this.input.addEventListener('focus', () => this.onFocus());
    this.input.addEventListener('blur', () => this.onBlur());

    document.addEventListener('click', (e) => {
      if (!this.input.contains(e.target) && !this.suggestions.contains(e.target)) {
        this.hide();
      }
    });
  }

  onInput() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const query = this.input.value.trim().toLowerCase();
      if (query.length < 1) {
        this.hide();
        return;
      }
      this.search(query);
    }, NavConfig.searchDebounceMs);
  }

  search(query) {
    const symbolResults = SampleData.symbols.filter(
      (s) =>
        s.symbol.toLowerCase().includes(query) ||
        s.name.toLowerCase().includes(query)
    );

    const menuResults = SampleData.menus.filter((m) =>
      m.name.toLowerCase().includes(query)
    );

    this.results = [...symbolResults.slice(0, 5), ...menuResults.slice(0, 3)];
    this.render();
  }

  render() {
    if (this.results.length === 0) {
      this.suggestions.innerHTML = `
        <div class="suggestion-empty">
          <span class="text-slate-400 text-sm">No results found</span>
        </div>
      `;
      this.show();
      return;
    }

    let html = '';
    const symbols = this.results.filter((r) => r.symbol);
    const menus = this.results.filter((r) => r.path);

    if (symbols.length > 0) {
      html += '<div class="suggestion-category">Symbols</div>';
      symbols.forEach((item, idx) => {
        html += `
          <div class="suggestion-item" data-index="${idx}" data-type="symbol" data-value="${item.symbol}">
            <span class="suggestion-symbol">${item.symbol}</span>
            <span class="suggestion-name">${item.name}</span>
            <span class="suggestion-type">${item.type}</span>
          </div>
        `;
      });
    }

    if (menus.length > 0) {
      html += '<div class="suggestion-category">Pages</div>';
      menus.forEach((item, idx) => {
        html += `
          <div class="suggestion-item" data-index="${symbols.length + idx}" data-type="menu" data-path="${item.path}">
            <span class="suggestion-symbol"><i class="fas fa-${item.icon}"></i></span>
            <span class="suggestion-name">${item.name}</span>
            <span class="suggestion-type">Page</span>
          </div>
        `;
      });
    }

    this.suggestions.innerHTML = html;
    this.highlightedIndex = -1;
    this.show();

    this.suggestions.querySelectorAll('.suggestion-item').forEach((el) => {
      el.addEventListener('click', () => this.selectItem(el));
      el.addEventListener('mouseenter', () => {
        this.highlightedIndex = parseInt(el.dataset.index);
        this.updateHighlight();
      });
    });
  }

  show() {
    this.suggestions.classList.add('visible');
  }

  hide() {
    this.suggestions.classList.remove('visible');
    this.highlightedIndex = -1;
  }

  onFocus() {
    if (this.input.value.trim().length > 0 && this.results.length > 0) {
      this.show();
    }
  }

  onBlur() {
    setTimeout(() => this.hide(), 200);
  }

  onKeydown(e) {
    if (!this.suggestions.classList.contains('visible')) return;

    const items = this.suggestions.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.highlightedIndex = Math.min(this.highlightedIndex + 1, items.length - 1);
        this.updateHighlight();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
        this.updateHighlight();
        break;
      case 'Enter':
        e.preventDefault();
        if (this.highlightedIndex >= 0) {
          this.selectItem(items[this.highlightedIndex]);
        }
        break;
      case 'Escape':
        this.hide();
        this.input.blur();
        break;
    }
  }

  updateHighlight() {
    const items = this.suggestions.querySelectorAll('.suggestion-item');
    items.forEach((item, idx) => {
      item.classList.toggle('highlighted', idx === this.highlightedIndex);
    });

    if (this.highlightedIndex >= 0 && items[this.highlightedIndex]) {
      items[this.highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  selectItem(el) {
    const type = el.dataset.type;
    if (type === 'symbol') {
      // Coming Soon: Symbol search feature not yet implemented
      if (window.showToast) {
        window.showToast('Symbol search coming soon!', 'info');
      } else {
        alert('Symbol search coming soon!');
      }
    } else if (type === 'menu') {
      // SPA navigation
      const path = el.dataset.path;
      if (window.handleNavigation) {
        window.handleNavigation(path);
      } else {
        window.location.href = (window.baseHref || './') + path;
      }
    }
    this.hide();
  }
}

// ========================================
//   3. Notification System
// ========================================
class NotificationManager {
  constructor(badgeEl, panelEl, toggleBtn) {
    this.badge = badgeEl;
    this.panel = panelEl;
    this.toggleBtn = toggleBtn;
    this.notifications = [];

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.updateBadge();
    this.renderPanel();

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePanel();
      });
    }

    document.addEventListener('click', (e) => {
      if (this.panel && !this.panel.contains(e.target) && !this.toggleBtn?.contains(e.target)) {
        this.closePanel();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel?.classList.contains('open')) {
        this.closePanel();
      }
    });

    // Add sample notifications (demo)
    if (this.notifications.length === 0) {
      this.addSampleNotifications();
    }
  }

  loadFromStorage() {
    try {
      const stored = localStorage.getItem(NavConfig.notificationStorageKey);
      this.notifications = stored ? JSON.parse(stored) : [];
    } catch (e) {
      this.notifications = [];
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(NavConfig.notificationStorageKey, JSON.stringify(this.notifications));
    } catch (e) {
      console.warn('Failed to save notifications:', e);
    }
  }

  addSampleNotifications() {
    this.notifications = [
      {
        id: 1,
        title: 'VIX Spike Alert',
        message: 'VIX rose above 20. Monitor market volatility.',
        type: 'warning',
        time: new Date(Date.now() - 1800000).toISOString(),
        read: false,
      },
      {
        id: 2,
        title: 'Banking Health Update',
        message: 'New FDIC data has been reflected.',
        type: 'info',
        time: new Date(Date.now() - 86400000).toISOString(),
        read: true,
      },
      {
        id: 3,
        title: 'TGA Daily Conversion Complete',
        message: 'Treasury General Account data upgraded to daily.',
        type: 'success',
        time: new Date(Date.now() - 172800000).toISOString(),
        read: true,
      },
    ];
    this.saveToStorage();
    this.updateBadge();
    this.renderPanel();
  }

  getUnreadCount() {
    return this.notifications.filter((n) => !n.read).length;
  }

  updateBadge() {
    if (!this.badge) return;

    const count = this.getUnreadCount();
    this.badge.textContent = count > 9 ? '9+' : count;
    this.badge.classList.toggle('visible', count > 0);
    this.badge.classList.toggle('pulse', count > 0);
  }

  togglePanel() {
    if (!this.panel) return;
    this.panel.classList.toggle('open');
  }

  closePanel() {
    if (!this.panel) return;
    this.panel.classList.remove('open');
  }

  renderPanel() {
    if (!this.panel) return;

    const listEl = this.panel.querySelector('.notification-list');
    if (!listEl) return;

    if (this.notifications.length === 0) {
      listEl.innerHTML = `
        <div class="notification-empty">
          <i class="fas fa-bell-slash text-2xl mb-2"></i>
          <p>No notifications</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.notifications
      .map((n) => this.renderNotificationItem(n))
      .join('');

    listEl.querySelectorAll('.notification-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        this.markAsRead(id);
      });
    });
  }

  renderNotificationItem(notification) {
    const iconMap = {
      warning: 'exclamation-triangle',
      info: 'info-circle',
      success: 'check-circle',
      error: 'times-circle',
    };
    const colorMap = {
      warning: 'bg-amber-100 text-amber-600',
      info: 'bg-blue-100 text-blue-600',
      success: 'bg-green-100 text-green-600',
      error: 'bg-red-100 text-red-600',
    };

    const icon = iconMap[notification.type] || 'bell';
    const color = colorMap[notification.type] || 'bg-gray-100 text-gray-600';
    const timeAgo = this.formatTimeAgo(notification.time);

    return `
      <div class="notification-item ${notification.read ? '' : 'unread'}" data-id="${notification.id}">
        <div class="notification-icon ${color}">
          <i class="fas fa-${icon}"></i>
        </div>
        <div class="notification-content">
          <div class="notification-title">${notification.title}</div>
          <div class="notification-message">${notification.message}</div>
          <div class="notification-time">${timeAgo}</div>
        </div>
      </div>
    `;
  }

  formatTimeAgo(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString('en-US');
  }

  markAsRead(id) {
    const notification = this.notifications.find((n) => n.id === id);
    if (notification && !notification.read) {
      notification.read = true;
      this.saveToStorage();
      this.updateBadge();
      this.renderPanel();
    }
  }

  markAllAsRead() {
    this.notifications.forEach((n) => (n.read = true));
    this.saveToStorage();
    this.updateBadge();
    this.renderPanel();
  }

  clearAll() {
    this.notifications = [];
    this.saveToStorage();
    this.updateBadge();
    this.renderPanel();
  }
}

// ========================================
//   4. Live Ticker System
// ========================================
class LiveTicker {
  constructor(containerEl) {
    this.container = containerEl;
    this.items = [...SampleData.tickerItems];
    this.intervalId = null;

    this.init();
  }

  init() {
    // Coming Soon: Click shows toast instead of real-time simulation
    if (this.container) {
      this.container.addEventListener('click', () => {
        if (window.showToast) {
          window.showToast('Real-time data coming soon!', 'info');
        } else {
          alert('Real-time data coming soon!');
        }
      });
    }
    // Note: Simulation disabled - static demo data only
  }

  render() {
    if (!this.container) return;

    const tickerEls = document.querySelectorAll('[data-ticker-symbol]');
    tickerEls.forEach((el) => {
      const symbol = el.dataset.tickerSymbol;
      const item = this.items.find((i) => i.symbol === symbol);
      if (!item) return;

      const priceEl = el.querySelector('.ticker-price');
      const changeEl = el.querySelector('.ticker-change');

      if (priceEl) {
        const oldPrice = parseFloat(priceEl.textContent.replace(/[^0-9.-]/g, ''));
        priceEl.textContent = item.price.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        priceEl.classList.remove('price-up', 'price-down', 'price-neutral', 'updating');
        if (item.change > 0) {
          priceEl.classList.add('price-up');
        } else if (item.change < 0) {
          priceEl.classList.add('price-down');
        } else {
          priceEl.classList.add('price-neutral');
        }

        if (oldPrice !== item.price) {
          priceEl.classList.add('updating');
          setTimeout(() => priceEl.classList.remove('updating'), 500);
        }
      }

      if (changeEl) {
        const sign = item.change >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${item.change.toFixed(2)}%`;
        changeEl.classList.remove('positive', 'negative');
        changeEl.classList.add(item.change >= 0 ? 'positive' : 'negative');
      }
    });
  }
}

// ========================================
//   5. Sticky Nav System
// ========================================
class StickyNav {
  constructor(navEl) {
    this.nav = navEl;
    this.isCompressed = false;
    this.lastScrollY = 0;

    this.init();
  }

  init() {
    if (!this.nav) return;

    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.onScroll();
  }

  onScroll() {
    const currentScrollY = window.scrollY;

    if (currentScrollY > NavConfig.stickyThreshold && !this.isCompressed) {
      this.compress();
    } else if (currentScrollY <= NavConfig.stickyThreshold && this.isCompressed) {
      this.expand();
    }

    this.lastScrollY = currentScrollY;
  }

  compress() {
    this.nav.classList.add('nav-compressed');
    this.isCompressed = true;
  }

  expand() {
    this.nav.classList.remove('nav-compressed');
    this.isCompressed = false;
  }
}

// ========================================
//   6. Mobile Menu System
// ========================================
class MobileMenu {
  constructor(menuEl, overlayEl, toggleBtn, closeBtn) {
    this.menu = menuEl;
    this.overlay = overlayEl;
    this.toggleBtn = toggleBtn;
    this.closeBtn = closeBtn;

    this.init();
  }

  init() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.close());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.menu?.classList.contains('open')) {
        this.close();
      }
    });
  }

  open() {
    if (this.menu) this.menu.classList.add('open');
    if (this.overlay) this.overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  close() {
    if (this.menu) this.menu.classList.remove('open');
    if (this.overlay) this.overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  toggle() {
    if (this.menu?.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  }
}

// ========================================
//   7. Mobile Fullscreen Search
// ========================================
class MobileSearch {
  constructor(searchEl, triggerBtn, closeBtn) {
    this.search = searchEl;
    this.triggerBtn = triggerBtn;
    this.closeBtn = closeBtn;

    this.init();
  }

  init() {
    if (this.triggerBtn) {
      this.triggerBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.search?.classList.contains('open')) {
        this.close();
      }
    });
  }

  open() {
    if (this.search) {
      this.search.classList.add('open');
      const input = this.search.querySelector('input');
      if (input) setTimeout(() => input.focus(), 300);
    }
  }

  close() {
    if (this.search) this.search.classList.remove('open');
  }
}

// ========================================
//   8. Dropdown Hover Delay
// ========================================
class DropdownManager {
  constructor(wrappers) {
    this.wrappers = wrappers;
    this.activeDropdown = null;
    this.hideTimeout = null;

    this.init();
  }

  init() {
    this.wrappers.forEach((wrapper) => {
      const dropdown = wrapper.querySelector('.dropdown-menu');
      if (!dropdown) return;

      wrapper.addEventListener('mouseenter', () => {
        clearTimeout(this.hideTimeout);
        this.showDropdown(dropdown);
      });

      wrapper.addEventListener('mouseleave', () => {
        this.hideTimeout = setTimeout(() => {
          this.hideDropdown(dropdown);
        }, 200);
      });

      wrapper.addEventListener('focusin', () => {
        clearTimeout(this.hideTimeout);
        this.showDropdown(dropdown);
      });

      wrapper.addEventListener('focusout', (e) => {
        if (!wrapper.contains(e.relatedTarget)) {
          this.hideDropdown(dropdown);
        }
      });
    });
  }

  showDropdown(dropdown) {
    if (this.activeDropdown && this.activeDropdown !== dropdown) {
      this.hideDropdown(this.activeDropdown);
    }
    dropdown.classList.add('visible');
    this.activeDropdown = dropdown;
  }

  hideDropdown(dropdown) {
    dropdown.classList.remove('visible');
    if (this.activeDropdown === dropdown) {
      this.activeDropdown = null;
    }
  }
}

// ========================================
//   9. URL Sharing (Brand Click)
// ========================================
function initBrandShare() {
  const brandLink = document.querySelector('.brand-share-link');
  if (!brandLink) return;

  brandLink.addEventListener('click', (e) => {
    e.preventDefault();

    let currentPath = 'main.html';
    try {
      if (window.currentActivePage) {
        currentPath = window.currentActivePage;
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        currentPath = urlParams.get('path') || 'main.html';
      }
    } catch (error) {
      currentPath = 'main.html';
    }

    const baseURL = window.location.origin + window.location.pathname;
    const shareableURL = `${baseURL}?path=${currentPath}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareableURL)
        .then(() => {
          showCopyNotification('URL copied!');
        })
        .catch(() => {
          fallbackCopyURL(shareableURL);
        });
    } else {
      fallbackCopyURL(shareableURL);
    }
  });
}

function showCopyNotification(message) {
  const existingNotification = document.querySelector('.copy-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('visible');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('visible');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function fallbackCopyURL(url) {
  const textArea = document.createElement('textarea');
  textArea.value = url;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
    showCopyNotification('URL copied!');
  } catch (error) {
    showCopyNotification('Copy failed');
  }

  document.body.removeChild(textArea);
}

// ========================================
//   10. Keyboard Shortcut (Cmd+K for Search)
// ========================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+K or Ctrl+K opens search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const searchInput = document.querySelector('.search-desktop .search-input');
      if (searchInput) {
        searchInput.focus();
      } else {
        // Mobile: open fullscreen search
        const mobileSearch = document.querySelector('.search-fullscreen');
        if (mobileSearch && window.mobileSearch) {
          window.mobileSearch.open();
        }
      }
    }
  });
}

// ========================================
//   11. Current Page Highlight
// ========================================
function highlightCurrentPage() {
  const currentPath = window.currentActivePage || '';
  const navLinks = document.querySelectorAll('[data-path]');

  navLinks.forEach(link => {
    const linkPath = link.getAttribute('data-path') || '';
    link.classList.remove('text-brand-navy', 'border-brand-navy', 'bg-blue-50/50', 'border-b-2');
    link.removeAttribute('aria-current');

    if (linkPath && currentPath.includes(linkPath.replace(/^\.\//, ''))) {
      link.classList.add('text-brand-navy', 'border-brand-navy', 'bg-blue-50/50', 'border-b-2');
      link.setAttribute('aria-current', 'page');
    }
  });
}

// ========================================
//   12. Mobile Menu Link Handler
// ========================================
function initMobileMenuLinks() {
  const mobileMenu = document.querySelector('.mobile-menu');
  if (!mobileMenu) return;

  mobileMenu.querySelectorAll('[data-path]').forEach(link => {
    link.addEventListener('click', () => {
      // Close mobile menu after navigation
      if (window.mobileMenuManager) {
        window.mobileMenuManager.close();
      }
    });
  });
}

// ========================================
//   13. Initialize
// ========================================
document.addEventListener('DOMContentLoaded', () => {
  // Sticky Nav
  const navWrapper = document.querySelector('.nav-wrapper');
  if (navWrapper) {
    window.stickyNav = new StickyNav(navWrapper);
  }

  // Desktop Search Autocomplete
  const desktopSearchInputs = document.querySelectorAll('.search-desktop .search-input');
  const desktopSearchSuggestions = document.querySelectorAll('.search-desktop .search-suggestions');
  if (desktopSearchInputs.length > 0 && desktopSearchSuggestions.length > 0) {
    window.searchAutocomplete = new SearchAutocomplete(
      desktopSearchInputs[0],
      desktopSearchSuggestions[0]
    );
  }

  // Mobile Search Autocomplete
  const mobileSearchInputs = document.querySelectorAll('.search-fullscreen .search-input');
  const mobileSearchSuggestions = document.querySelectorAll('.search-fullscreen .search-suggestions');
  if (mobileSearchInputs.length > 0 && mobileSearchSuggestions.length > 0) {
    window.mobileSearchAutocomplete = new SearchAutocomplete(
      mobileSearchInputs[0],
      mobileSearchSuggestions[0]
    );
  }

  // Notification System
  const notificationBadge = document.querySelector('.notification-badge');
  const notificationPanel = document.querySelector('.notification-panel');
  const notificationToggle = document.querySelector('.notification-toggle');
  if (notificationBadge && notificationPanel) {
    window.notificationManager = new NotificationManager(
      notificationBadge,
      notificationPanel,
      notificationToggle
    );
  }

  // Live Ticker
  const tickerContainer = document.querySelector('.live-ticker');
  if (tickerContainer) {
    window.liveTicker = new LiveTicker(tickerContainer);
  }

  // Mobile Menu
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileOverlay = document.querySelector('.mobile-overlay');
  const mobileToggle = document.querySelector('.mobile-menu-toggle');
  const mobileClose = document.querySelector('.mobile-menu-close');
  if (mobileMenu) {
    window.mobileMenuManager = new MobileMenu(mobileMenu, mobileOverlay, mobileToggle, mobileClose);
  }

  // Mobile Search
  const mobileSearchPanel = document.querySelector('.search-fullscreen');
  const mobileSearchTrigger = document.querySelector('.search-mobile-trigger');
  const mobileSearchClose = document.querySelector('.search-fullscreen-close');
  if (mobileSearchPanel) {
    window.mobileSearch = new MobileSearch(mobileSearchPanel, mobileSearchTrigger, mobileSearchClose);
  }

  // Dropdown Manager
  const dropdownWrappers = document.querySelectorAll('.dropdown-wrapper');
  if (dropdownWrappers.length > 0) {
    window.dropdownManager = new DropdownManager(dropdownWrappers);
  }

  // Mark All Read Button
  const markAllReadBtn = document.querySelector('.mark-all-read');
  if (markAllReadBtn && window.notificationManager) {
    markAllReadBtn.addEventListener('click', () => {
      window.notificationManager.markAllAsRead();
    });
  }

  // Brand Share Link
  initBrandShare();

  // Keyboard Shortcuts
  initKeyboardShortcuts();

  // Mobile Menu Links
  initMobileMenuLinks();

  // Current Page Highlight
  highlightCurrentPage();
  window.addEventListener('popstate', highlightCurrentPage);

  console.log('Nav V11 initialized');
});
