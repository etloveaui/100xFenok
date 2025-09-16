/**
 * 🏝️ Miyako UI Components System
 * Modern JavaScript module for handling component interactions
 *
 * Architecture: SOLID principles applied
 * - Single Responsibility: Each class handles one component type
 * - Open/Closed: Easy to extend without modifying existing code
 * - Liskov Substitution: Consistent interface for all components
 * - Interface Segregation: Focused, specific component methods
 * - Dependency Inversion: Event-driven architecture
 */

/* =============================================================================
   🎯 Button Component Manager
   ============================================================================= */

class ButtonComponent {
  constructor(element) {
    this.element = element;
    this.isLoading = false;
    this.originalContent = element.innerHTML;
    this.init();
  }

  init() {
    // Ensure button has proper ARIA attributes
    if (!this.element.hasAttribute('role')) {
      this.element.setAttribute('role', 'button');
    }

    // Add keyboard support
    this.element.addEventListener('keydown', this.handleKeydown.bind(this));

    // Add loading state support
    this.element.addEventListener('click', this.handleClick.bind(this));
  }

  handleKeydown(event) {
    // Space and Enter should trigger button action
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.element.click();
    }
  }

  async handleClick(event) {
    // Prevent multiple clicks during loading
    if (this.isLoading || this.element.disabled) {
      event.preventDefault();
      return;
    }

    // Add visual feedback
    this.element.style.transform = 'scale(0.98)';
    setTimeout(() => {
      if (this.element) {
        this.element.style.transform = '';
      }
    }, 150);
  }

  setLoading(loading = true) {
    this.isLoading = loading;

    if (loading) {
      this.element.disabled = true;
      this.element.innerHTML = `
        <svg class="icon animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25"/>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
        </svg>
        로딩 중...
      `;
    } else {
      this.element.disabled = false;
      this.element.innerHTML = this.originalContent;
    }
  }

  setText(text) {
    this.originalContent = text;
    if (!this.isLoading) {
      this.element.innerHTML = text;
    }
  }

  destroy() {
    this.element.removeEventListener('keydown', this.handleKeydown);
    this.element.removeEventListener('click', this.handleClick);
  }
}

/* =============================================================================
   🎴 Card Component Manager
   ============================================================================= */

class CardComponent {
  constructor(element) {
    this.element = element;
    this.isInteractive = this.element.hasAttribute('data-interactive');
    this.init();
  }

  init() {
    if (this.isInteractive) {
      this.element.setAttribute('tabindex', '0');
      this.element.setAttribute('role', 'button');
      this.element.addEventListener('keydown', this.handleKeydown.bind(this));
      this.element.addEventListener('click', this.handleClick.bind(this));
    }

    // Add intersection observer for animation on scroll
    this.observeIntersection();
  }

  handleKeydown(event) {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.element.click();
    }
  }

  handleClick(event) {
    // Emit custom event for card interaction
    this.element.dispatchEvent(new CustomEvent('card:clicked', {
      bubbles: true,
      detail: { element: this.element }
    }));
  }

  observeIntersection() {
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in');
            observer.unobserve(entry.target);
          }
        });
      }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
      });

      observer.observe(this.element);
    }
  }

  setLoading(loading = true) {
    if (loading) {
      this.element.classList.add('opacity-50');
      this.element.style.pointerEvents = 'none';
    } else {
      this.element.classList.remove('opacity-50');
      this.element.style.pointerEvents = '';
    }
  }

  destroy() {
    if (this.isInteractive) {
      this.element.removeEventListener('keydown', this.handleKeydown);
      this.element.removeEventListener('click', this.handleClick);
    }
  }
}

/* =============================================================================
   🎭 Modal Component Manager
   ============================================================================= */

class ModalComponent {
  constructor(element) {
    this.element = element;
    this.closeButton = this.element.querySelector('.modal-close');
    this.backdrop = this.element;
    this.content = this.element.querySelector('.modal-content');
    this.isOpen = false;
    this.focusTrap = null;
    this.init();
  }

  init() {
    // Close button handler
    if (this.closeButton) {
      this.closeButton.addEventListener('click', this.close.bind(this));
    }

    // Backdrop click handler
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) {
        this.close();
      }
    });

    // Escape key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // ARIA attributes
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-hidden', 'true');
  }

  open() {
    if (this.isOpen) return;

    this.isOpen = true;
    this.element.classList.add('open');
    this.element.setAttribute('aria-hidden', 'false');

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Focus management
    this.setupFocusTrap();
    this.focusFirstElement();

    // Emit custom event
    this.element.dispatchEvent(new CustomEvent('modal:opened', {
      bubbles: true,
      detail: { modal: this }
    }));
  }

  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.element.classList.remove('open');
    this.element.setAttribute('aria-hidden', 'true');

    // Restore body scroll
    document.body.style.overflow = '';

    // Clean up focus trap
    this.removeFocusTrap();

    // Emit custom event
    this.element.dispatchEvent(new CustomEvent('modal:closed', {
      bubbles: true,
      detail: { modal: this }
    }));
  }

  setupFocusTrap() {
    const focusableElements = this.content.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    this.focusTrap = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    this.content.addEventListener('keydown', this.focusTrap);
  }

  removeFocusTrap() {
    if (this.focusTrap) {
      this.content.removeEventListener('keydown', this.focusTrap);
      this.focusTrap = null;
    }
  }

  focusFirstElement() {
    const firstFocusable = this.content.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }

  destroy() {
    if (this.closeButton) {
      this.closeButton.removeEventListener('click', this.close);
    }
    this.removeFocusTrap();
  }
}

/* =============================================================================
   🍞 Toast Notification Manager
   ============================================================================= */

class ToastManager {
  constructor() {
    this.container = document.getElementById('toast-container') || this.createContainer();
    this.toasts = new Map();
    this.nextId = 1;
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  show(message, type = 'info', duration = 4000) {
    const id = this.nextId++;
    const toast = this.createToast(id, message, type);

    this.container.appendChild(toast);
    this.toasts.set(id, toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => this.hide(id), duration);
    }

    return id;
  }

  createToast(id, message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const icon = this.getIconForType(type);

    toast.innerHTML = `
      <div class="flex items-center gap-md">
        <span class="text-lg">${icon}</span>
        <span class="flex-1">${message}</span>
        <button class="btn-ghost btn-icon toast-close" aria-label="닫기">
          <svg class="icon icon-sm" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    // Close button handler
    const closeButton = toast.querySelector('.toast-close');
    closeButton.addEventListener('click', () => this.hide(id));

    return toast;
  }

  getIconForType(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    return icons[type] || icons.info;
  }

  hide(id) {
    const toast = this.toasts.get(id);
    if (!toast) return;

    toast.classList.remove('show');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      this.toasts.delete(id);
    }, 300);
  }

  clear() {
    this.toasts.forEach((toast, id) => this.hide(id));
  }
}

/* =============================================================================
   🎯 Component Factory - Dependency Injection
   ============================================================================= */

class ComponentFactory {
  static create(element, type) {
    const componentMap = {
      'button': ButtonComponent,
      'card': CardComponent,
      'modal': ModalComponent
    };

    const ComponentClass = componentMap[type];
    if (!ComponentClass) {
      throw new Error(`Unknown component type: ${type}`);
    }

    return new ComponentClass(element);
  }

  static autoInit() {
    // Auto-initialize components based on CSS classes
    const componentSelectors = {
      'button': '.btn-primary, .btn-secondary, .btn-ghost, .btn-destructive',
      'card': '.card, .dashboard-card',
      'modal': '.modal'
    };

    Object.entries(componentSelectors).forEach(([type, selector]) => {
      document.querySelectorAll(selector).forEach(element => {
        if (!element._miyakoComponent) {
          element._miyakoComponent = ComponentFactory.create(element, type);
        }
      });
    });
  }
}

/* =============================================================================
   🚀 UI Manager - Orchestration Layer
   ============================================================================= */

class UIManager {
  constructor() {
    this.components = new Map();
    this.toastManager = new ToastManager();
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', this.onDOMReady.bind(this));
    } else {
      this.onDOMReady();
    }
  }

  onDOMReady() {
    // Auto-initialize all components
    ComponentFactory.autoInit();

    // Set up global event listeners
    this.setupGlobalEvents();

    // Initialize theme
    this.initializeTheme();

    console.log('🏝️ Miyako UI System initialized');
  }

  setupGlobalEvents() {
    // Handle all button clicks with loading states
    document.addEventListener('click', async (e) => {
      const button = e.target.closest('[data-action]');
      if (button && button._miyakoComponent) {
        const action = button.dataset.action;
        await this.handleButtonAction(button, action);
      }
    });

    // Handle card interactions
    document.addEventListener('card:clicked', (e) => {
      console.log('Card clicked:', e.detail.element);
    });

    // Handle modal triggers
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-modal]');
      if (trigger) {
        const modalId = trigger.dataset.modal;
        const modal = document.getElementById(modalId);
        if (modal && modal._miyakoComponent) {
          modal._miyakoComponent.open();
        }
      }
    });
  }

  async handleButtonAction(button, action) {
    const component = button._miyakoComponent;

    try {
      component.setLoading(true);

      // Simulate API call or async operation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Show success message
      this.toastManager.show(`액션 "${action}" 완료되었습니다!`, 'success');

    } catch (error) {
      console.error('Button action failed:', error);
      this.toastManager.show('작업 중 오류가 발생했습니다.', 'error');
    } finally {
      component.setLoading(false);
    }
  }

  initializeTheme() {
    // Set up theme switching capability
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    prefersDark.addListener((e) => {
      document.documentElement.classList.toggle('dark', e.matches);
    });

    // Initial theme setup
    if (prefersDark.matches) {
      document.documentElement.classList.add('dark');
    }
  }

  showToast(message, type = 'info', duration = 4000) {
    return this.toastManager.show(message, type, duration);
  }

  hideToast(id) {
    this.toastManager.hide(id);
  }

  getComponent(element) {
    return element._miyakoComponent;
  }

  destroy() {
    // Clean up all components
    this.components.forEach(component => {
      if (component.destroy) {
        component.destroy();
      }
    });
    this.components.clear();
  }
}

/* =============================================================================
   🎯 Public API - Module Exports
   ============================================================================= */

// Global instance
window.MiyakoUI = new UIManager();

// Export for ES6 modules
export {
  UIManager,
  ButtonComponent,
  CardComponent,
  ModalComponent,
  ToastManager,
  ComponentFactory
};

/* =============================================================================
   🎮 Development Helpers
   ============================================================================= */

if (process.env.NODE_ENV === 'development') {
  window.MiyakoUI.debug = {
    showToast: (message, type) => window.MiyakoUI.showToast(message, type),
    getComponents: () => Array.from(document.querySelectorAll('[data-miyako-component]')),
    reinitialize: () => ComponentFactory.autoInit()
  };
}