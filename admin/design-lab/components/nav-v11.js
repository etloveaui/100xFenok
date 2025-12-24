/**
 * Nav V11 JavaScript
 * - v10 전체 기능 통합
 * - 검색 자동완성 (심볼/메뉴)
 * - 알림 시스템 (localStorage)
 * - Live Ticker 시뮬레이션
 * - Sticky Nav 압축
 * - 모바일 메뉴
 * - 키보드 접근성
 */

// ========================================
//   1. 설정 및 샘플 데이터
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
    { name: 'Market Radar', path: '/tools/macro-monitor/', icon: 'chart-line' },
    { name: 'Valuation Lab', path: '/admin/valuation-lab/', icon: 'calculator' },
    { name: 'Banking Health', path: '/tools/macro-monitor/#banking', icon: 'building-columns' },
    { name: 'Liquidity Flow', path: '/tools/macro-monitor/#liquidity', icon: 'water' },
    { name: 'Global Scouter', path: '/admin/valuation-lab/expansion/', icon: 'globe' },
  ],
  tickerItems: [
    { symbol: 'SPY', price: 595.42, change: 0.85 },
    { symbol: 'QQQ', price: 518.73, change: 1.12 },
    { symbol: 'VIX', price: 13.45, change: -5.23 },
  ],
};

// ========================================
//   2. 검색 자동완성 시스템
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
          <span class="text-slate-400 text-sm">검색 결과가 없습니다</span>
        </div>
      `;
      this.show();
      return;
    }

    let html = '';
    const symbols = this.results.filter((r) => r.symbol);
    const menus = this.results.filter((r) => r.path);

    if (symbols.length > 0) {
      html += '<div class="suggestion-category">심볼</div>';
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
      html += '<div class="suggestion-category">메뉴</div>';
      menus.forEach((item, idx) => {
        html += `
          <div class="suggestion-item" data-index="${symbols.length + idx}" data-type="menu" data-path="${item.path}">
            <span class="suggestion-symbol"><i class="fas fa-${item.icon}"></i></span>
            <span class="suggestion-name">${item.name}</span>
            <span class="suggestion-type">페이지</span>
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
      this.input.value = el.dataset.value;
      console.log('Selected symbol:', el.dataset.value);
    } else if (type === 'menu') {
      window.location.href = el.dataset.path;
    }
    this.hide();
  }
}

// ========================================
//   3. 알림 시스템
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

    // 샘플 알림 추가 (데모용)
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
        title: 'VIX 급등 경고',
        message: 'VIX가 20 이상으로 상승했습니다. 시장 변동성 주의.',
        type: 'warning',
        time: new Date(Date.now() - 1800000).toISOString(),
        read: false,
      },
      {
        id: 2,
        title: 'Banking Health 업데이트',
        message: '새로운 FDIC 데이터가 반영되었습니다.',
        type: 'info',
        time: new Date(Date.now() - 86400000).toISOString(),
        read: true,
      },
      {
        id: 3,
        title: 'TGA 일간 전환 완료',
        message: 'Treasury General Account 데이터가 일간으로 업그레이드되었습니다.',
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
          <p>알림이 없습니다</p>
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

    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
    return date.toLocaleDateString('ko-KR');
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
//   4. Live Ticker 시스템
// ========================================
class LiveTicker {
  constructor(containerEl) {
    this.container = containerEl;
    this.items = [...SampleData.tickerItems];
    this.intervalId = null;

    this.init();
  }

  init() {
    this.render();
    this.startSimulation();
  }

  startSimulation() {
    this.intervalId = setInterval(() => {
      this.updatePrices();
    }, NavConfig.tickerUpdateInterval);
  }

  stopSimulation() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  updatePrices() {
    this.items.forEach((item) => {
      const changePercent = (Math.random() - 0.5) * 2;
      const priceChange = item.price * (changePercent / 100);
      item.price = Math.round((item.price + priceChange) * 100) / 100;
      item.change = Math.round(changePercent * 100) / 100;
    });
    this.render();
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
//   5. Sticky Nav 시스템
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
//   6. 모바일 메뉴 시스템
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
//   7. 모바일 전체화면 검색
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
//   8. 드롭다운 hover 딜레이
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
//   9. 초기화
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

  // 현재 페이지 하이라이트
  function highlightCurrentPage() {
    const currentHash = window.location.hash || '#dashboard';
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
      link.classList.remove('text-brand-navy', 'border-brand-navy', 'bg-blue-50/50', 'border-b-2');
      link.removeAttribute('aria-current');

      if (link.getAttribute('href') === currentHash) {
        link.classList.add('text-brand-navy', 'border-brand-navy', 'bg-blue-50/50', 'border-b-2');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  window.addEventListener('load', highlightCurrentPage);
  window.addEventListener('hashchange', highlightCurrentPage);

  console.log('Nav V11 initialized');
});
