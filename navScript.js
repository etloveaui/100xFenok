/**
 * Nav V12 JavaScript - Production Version
 * - Notification system (localStorage)
 * - Sticky Nav compression
 * - Mobile menu (slide-in)
 * - SPA navigation integration
 * - URL sharing (brand click)
 *
 * Removed in v12: Search autocomplete, Live ticker, Mobile fullscreen search
 */

// ========================================
//   1. Configuration
// ========================================
const NavConfig = {
  stickyThreshold: 50,
  notificationStorageKey: 'nav_notifications_v12',
};

// ========================================
//   2. Notification System
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
      if (this.panel?.classList.contains('open') && !this.panel.contains(e.target) && !this.toggleBtn?.contains(e.target)) {
        this.closePanel();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel?.classList.contains('open')) {
        this.closePanel();
      }
    });
  }

  loadFromStorage() {
    try {
      const stored = localStorage.getItem(NavConfig.notificationStorageKey);
      if (stored) {
        this.notifications = JSON.parse(stored);
      } else {
        this.notifications = this.getDefaultNotifications();
        this.saveToStorage();
      }
    } catch (error) {
      this.notifications = this.getDefaultNotifications();
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(NavConfig.notificationStorageKey, JSON.stringify(this.notifications));
    } catch (error) {
      console.warn('Failed to save notifications');
    }
  }

  getDefaultNotifications() {
    return [
      {
        id: 1,
        title: 'Welcome to 100x Fenok',
        message: 'Explore Market Radar for real-time insights',
        timestamp: Date.now() - 3600000,
        read: false,
        type: 'info',
        icon: 'rocket',
      },
      {
        id: 2,
        title: 'Market Update',
        message: 'Check the latest technical analysis',
        timestamp: Date.now() - 7200000,
        read: true,
        type: 'update',
        icon: 'chart-line',
      },
    ];
  }

  togglePanel() {
    if (this.panel?.classList.contains('open')) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  openPanel() {
    this.panel?.classList.add('open');
    this.toggleBtn?.setAttribute('aria-expanded', 'true');
  }

  closePanel() {
    this.panel?.classList.remove('open');
    this.toggleBtn?.setAttribute('aria-expanded', 'false');
  }

  updateBadge() {
    const unreadCount = this.notifications.filter((n) => !n.read).length;
    if (this.badge) {
      if (unreadCount > 0) {
        this.badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        this.badge.classList.add('visible');
        if (unreadCount > 0) {
          this.badge.classList.add('pulse');
        }
      } else {
        this.badge.classList.remove('visible', 'pulse');
      }
    }
  }

  renderPanel() {
    if (!this.panel) return;

    const listEl = this.panel.querySelector('.notification-list');
    if (!listEl) return;

    if (this.notifications.length === 0) {
      listEl.innerHTML = `
        <div class="notification-empty">
          <i class="fas fa-bell-slash text-2xl text-slate-300 mb-2"></i>
          <p class="text-sm text-slate-400">No notifications</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.notifications
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((n) => this.renderNotificationItem(n))
      .join('');

    listEl.querySelectorAll('.notification-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id, 10);
        this.markAsRead(id);
      });
    });
  }

  renderNotificationItem(notification) {
    const timeAgo = this.formatTimeAgo(notification.timestamp);
    const iconBgClass = this.getIconBgClass(notification.type);

    return `
      <div class="notification-item ${notification.read ? '' : 'unread'}" data-id="${notification.id}">
        <div class="notification-icon ${iconBgClass}">
          <i class="fas fa-${notification.icon} text-white"></i>
        </div>
        <div class="notification-content">
          <div class="notification-title">${notification.title}</div>
          <div class="notification-message">${notification.message}</div>
          <div class="notification-time">${timeAgo}</div>
        </div>
      </div>
    `;
  }

  getIconBgClass(type) {
    const classes = {
      info: 'bg-brand-interactive',
      update: 'bg-green-500',
      alert: 'bg-amber-500',
      warning: 'bg-red-500',
    };
    return classes[type] || classes.info;
  }

  formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
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

  addNotification(notification) {
    const newNotification = {
      id: Date.now(),
      timestamp: Date.now(),
      read: false,
      ...notification,
    };
    this.notifications.unshift(newNotification);
    this.saveToStorage();
    this.updateBadge();
    this.renderPanel();
  }
}

// ========================================
//   3. Sticky Nav System
// ========================================
class StickyNav {
  constructor(navEl) {
    this.nav = navEl;
    this.isCompressed = false;
    this.ticking = false;

    this.init();
  }

  init() {
    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.onScroll();
  }

  onScroll() {
    if (!this.ticking) {
      window.requestAnimationFrame(() => {
        this.updateState();
        this.ticking = false;
      });
      this.ticking = true;
    }
  }

  updateState() {
    const shouldCompress = window.scrollY > NavConfig.stickyThreshold;

    if (shouldCompress !== this.isCompressed) {
      this.isCompressed = shouldCompress;
      if (shouldCompress) {
        this.nav.classList.add('nav-compressed');
      } else {
        this.nav.classList.remove('nav-compressed');
      }
    }
  }
}

// ========================================
//   4. Mobile Menu System
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
    this.menu?.classList.add('open');
    this.overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.menu?.classList.remove('open');
    this.overlay?.classList.remove('visible');
    document.body.style.overflow = '';
  }
}

// ========================================
//   5. Dropdown Hover Delay
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
        }, 150);
      });

      const button = wrapper.querySelector('button');
      if (button) {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          if (dropdown.classList.contains('visible')) {
            this.hideDropdown(dropdown);
          } else {
            this.showDropdown(dropdown);
          }
        });
      }
    });

    document.addEventListener('click', (e) => {
      if (this.activeDropdown && !e.target.closest('.dropdown-wrapper')) {
        this.hideDropdown(this.activeDropdown);
      }
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
//   6. URL Sharing (Brand Click)
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
//   7. Current Page Highlight
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
//   8. Mobile Menu Link Handler
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
//   9. Icon Nav Active State
// ========================================
function updateIconNavActiveState() {
  const currentPath = window.currentActivePage || '';
  const iconLinks = document.querySelectorAll('.nav-icon-only .nav-icon');

  iconLinks.forEach(link => {
    const linkPath = link.getAttribute('data-path') || '';
    link.classList.remove('active');

    if (linkPath && currentPath.includes(linkPath.replace(/^\.\//, ''))) {
      link.classList.add('active');
    }
  });
}

// ========================================
//   10. Initialize
// ========================================
document.addEventListener('DOMContentLoaded', () => {
  // Sticky Nav
  const navWrapper = document.querySelector('.nav-wrapper');
  if (navWrapper) {
    window.stickyNav = new StickyNav(navWrapper);
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

  // Mobile Menu
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileOverlay = document.querySelector('.mobile-overlay');
  const mobileToggle = document.querySelector('.mobile-menu-toggle');
  const mobileClose = document.querySelector('.mobile-menu-close');
  if (mobileMenu) {
    window.mobileMenuManager = new MobileMenu(mobileMenu, mobileOverlay, mobileToggle, mobileClose);
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

  // Mobile Menu Links
  initMobileMenuLinks();

  // Current Page Highlight
  highlightCurrentPage();
  updateIconNavActiveState();
  window.addEventListener('popstate', () => {
    highlightCurrentPage();
    updateIconNavActiveState();
  });

  console.log('Nav V12 initialized');
});
