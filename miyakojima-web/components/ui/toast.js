import { cn } from '../core/utils.js';

/**
 * Toast Component System (바닐라 JS 변환 - Shadcn Toast 기반)
 *
 * Shadcn Toast/Sonner 컴포넌트를 바닐라 JavaScript로 변환
 * - 다양한 Toast 타입 (success, error, warning, info)
 * - 자동 제거 기능 (타이머)
 * - 애니메이션 효과 (slide-in/fade-out)
 * - 스택 관리 (다중 Toast)
 * - 액션 버튼 지원
 * - 접근성 지원 (ARIA 속성)
 * - 포지션 설정 (top/bottom, left/center/right)
 */

/**
 * Toast 타입 정의
 */
const TOAST_TYPES = {
  DEFAULT: 'default',
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  LOADING: 'loading'
};

/**
 * Toast 위치 정의
 */
const TOAST_POSITIONS = {
  TOP_LEFT: 'top-left',
  TOP_CENTER: 'top-center',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_CENTER: 'bottom-center',
  BOTTOM_RIGHT: 'bottom-right'
};

/**
 * 글로벌 Toast 컨테이너 클래스
 */
class ToastContainer {
  constructor() {
    this.toasts = new Map();
    this.containers = new Map();
    this.maxToasts = 5;
    this.defaultDuration = 4000;
    this.zIndex = 9999;

    this.setupContainers();
  }

  /**
   * 포지션별 컨테이너 설정
   */
  setupContainers() {
    Object.values(TOAST_POSITIONS).forEach(position => {
      const container = this.createContainer(position);
      this.containers.set(position, container);
      document.body.appendChild(container);
    });
  }

  /**
   * 컨테이너 생성
   * @param {string} position - Toast 위치
   * @returns {HTMLElement}
   */
  createContainer(position) {
    const container = document.createElement('div');
    container.className = cn(
      'fixed flex flex-col gap-2 w-full max-w-sm p-4 pointer-events-none',
      this.getPositionClasses(position)
    );
    container.style.zIndex = this.zIndex;
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-label', 'Toast notifications');

    return container;
  }

  /**
   * 포지션에 따른 CSS 클래스 반환
   * @param {string} position
   * @returns {string}
   */
  getPositionClasses(position) {
    const classes = {
      [TOAST_POSITIONS.TOP_LEFT]: 'top-4 left-4',
      [TOAST_POSITIONS.TOP_CENTER]: 'top-4 left-1/2 transform -translate-x-1/2',
      [TOAST_POSITIONS.TOP_RIGHT]: 'top-4 right-4',
      [TOAST_POSITIONS.BOTTOM_LEFT]: 'bottom-4 left-4',
      [TOAST_POSITIONS.BOTTOM_CENTER]: 'bottom-4 left-1/2 transform -translate-x-1/2',
      [TOAST_POSITIONS.BOTTOM_RIGHT]: 'bottom-4 right-4'
    };

    return classes[position] || classes[TOAST_POSITIONS.TOP_RIGHT];
  }

  /**
   * Toast 추가
   * @param {Object} options - Toast 옵션
   * @returns {string} Toast ID
   */
  addToast(options) {
    const toast = new Toast(options);
    const container = this.containers.get(options.position || TOAST_POSITIONS.TOP_RIGHT);

    // 최대 개수 제한
    if (container.children.length >= this.maxToasts) {
      const oldestToast = container.firstElementChild;
      if (oldestToast) {
        this.removeToast(oldestToast.dataset.toastId);
      }
    }

    this.toasts.set(toast.id, toast);
    container.appendChild(toast.element);

    // 진입 애니메이션
    requestAnimationFrame(() => {
      toast.show();
    });

    // 자동 제거 타이머
    if (toast.options.duration !== 0 && toast.options.type !== TOAST_TYPES.LOADING) {
      toast.timer = setTimeout(() => {
        this.removeToast(toast.id);
      }, toast.options.duration);
    }

    return toast.id;
  }

  /**
   * Toast 제거
   * @param {string} toastId - Toast ID
   */
  removeToast(toastId) {
    const toast = this.toasts.get(toastId);
    if (!toast) return;

    if (toast.timer) {
      clearTimeout(toast.timer);
    }

    toast.hide(() => {
      if (toast.element && toast.element.parentNode) {
        toast.element.parentNode.removeChild(toast.element);
      }
      this.toasts.delete(toastId);
    });
  }

  /**
   * 모든 Toast 제거
   * @param {string} position - 특정 위치의 Toast만 제거 (선택적)
   */
  removeAllToasts(position) {
    if (position) {
      const container = this.containers.get(position);
      if (container) {
        Array.from(container.children).forEach(toastElement => {
          this.removeToast(toastElement.dataset.toastId);
        });
      }
    } else {
      this.toasts.forEach((toast) => {
        this.removeToast(toast.id);
      });
    }
  }

  /**
   * Toast 업데이트
   * @param {string} toastId - Toast ID
   * @param {Object} updates - 업데이트할 옵션
   */
  updateToast(toastId, updates) {
    const toast = this.toasts.get(toastId);
    if (!toast) return;

    toast.update(updates);
  }
}

/**
 * 개별 Toast 클래스
 */
class Toast {
  constructor(options = {}) {
    this.id = this.generateId();
    this.options = {
      type: TOAST_TYPES.DEFAULT,
      title: '',
      description: '',
      duration: 4000,
      position: TOAST_POSITIONS.TOP_RIGHT,
      action: null,
      actionText: 'Action',
      onAction: null,
      onDismiss: null,
      dismissible: true,
      icon: null,
      className: '',
      ...options
    };

    this.element = null;
    this.timer = null;

    this.createElement();
  }

  /**
   * 고유 ID 생성
   * @returns {string}
   */
  generateId() {
    return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Toast 요소 생성
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.dataset.toastId = this.id;
    this.element.className = cn(
      'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all',
      'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
      this.getTypeClasses(),
      this.options.className
    );

    this.element.setAttribute('data-state', 'closed');
    this.element.setAttribute('role', 'alert');
    this.element.setAttribute('aria-live', 'assertive');
    this.element.setAttribute('aria-atomic', 'true');

    // 콘텐츠 생성
    this.createContent();

    // 닫기 버튼 생성
    if (this.options.dismissible) {
      this.createCloseButton();
    }
  }

  /**
   * Toast 타입에 따른 스타일 클래스 반환
   * @returns {string}
   */
  getTypeClasses() {
    const typeStyles = {
      [TOAST_TYPES.DEFAULT]: 'border bg-background text-foreground',
      [TOAST_TYPES.SUCCESS]: 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
      [TOAST_TYPES.ERROR]: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
      [TOAST_TYPES.WARNING]: 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
      [TOAST_TYPES.INFO]: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
      [TOAST_TYPES.LOADING]: 'border bg-background text-foreground'
    };

    return typeStyles[this.options.type] || typeStyles[TOAST_TYPES.DEFAULT];
  }

  /**
   * 콘텐츠 생성
   */
  createContent() {
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'flex items-start space-x-3 flex-1';

    // 아이콘
    if (this.options.icon || this.getDefaultIcon()) {
      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'flex-shrink-0';

      const icon = this.options.icon || this.getDefaultIcon();
      if (typeof icon === 'string') {
        iconWrapper.innerHTML = icon;
      } else if (icon instanceof HTMLElement) {
        iconWrapper.appendChild(icon);
      }

      contentWrapper.appendChild(iconWrapper);
    }

    // 텍스트 콘텐츠
    const textWrapper = document.createElement('div');
    textWrapper.className = 'flex-1 min-w-0';

    if (this.options.title) {
      const title = document.createElement('div');
      title.className = 'text-sm font-semibold';
      title.textContent = this.options.title;
      textWrapper.appendChild(title);
    }

    if (this.options.description) {
      const description = document.createElement('div');
      description.className = cn(
        'text-sm opacity-90',
        this.options.title ? 'mt-1' : ''
      );
      description.textContent = this.options.description;
      textWrapper.appendChild(description);
    }

    contentWrapper.appendChild(textWrapper);

    // 액션 버튼
    if (this.options.action || this.options.onAction) {
      const actionButton = this.createActionButton();
      contentWrapper.appendChild(actionButton);
    }

    this.element.appendChild(contentWrapper);
  }

  /**
   * 기본 아이콘 반환
   * @returns {string|null}
   */
  getDefaultIcon() {
    const icons = {
      [TOAST_TYPES.SUCCESS]: '<svg class="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>',
      [TOAST_TYPES.ERROR]: '<svg class="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>',
      [TOAST_TYPES.WARNING]: '<svg class="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>',
      [TOAST_TYPES.INFO]: '<svg class="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>',
      [TOAST_TYPES.LOADING]: '<svg class="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'
    };

    return icons[this.options.type] || null;
  }

  /**
   * 액션 버튼 생성
   * @returns {HTMLElement}
   */
  createActionButton() {
    const button = document.createElement('button');
    button.className = 'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
    button.textContent = this.options.actionText;

    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.options.onAction) {
        this.options.onAction();
      }
    });

    return button;
  }

  /**
   * 닫기 버튼 생성
   */
  createCloseButton() {
    const closeButton = document.createElement('button');
    closeButton.className = 'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100';
    closeButton.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    closeButton.setAttribute('aria-label', 'Close');

    closeButton.addEventListener('click', () => {
      this.dismiss();
    });

    this.element.appendChild(closeButton);
  }

  /**
   * Toast 표시
   */
  show() {
    this.element.setAttribute('data-state', 'open');
  }

  /**
   * Toast 숨김
   * @param {Function} callback - 애니메이션 완료 후 콜백
   */
  hide(callback) {
    this.element.setAttribute('data-state', 'closed');

    // 애니메이션 완료 후 콜백 실행
    setTimeout(() => {
      if (callback) callback();
    }, 150);
  }

  /**
   * Toast 제거
   */
  dismiss() {
    if (this.options.onDismiss) {
      this.options.onDismiss();
    }

    if (window.toastContainer) {
      window.toastContainer.removeToast(this.id);
    }
  }

  /**
   * Toast 업데이트
   * @param {Object} updates - 업데이트할 옵션
   */
  update(updates) {
    Object.assign(this.options, updates);

    // 타이머 재설정
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // 요소 다시 생성
    const oldElement = this.element;
    this.createElement();

    if (oldElement && oldElement.parentNode) {
      oldElement.parentNode.replaceChild(this.element, oldElement);
    }

    this.show();

    // 새 타이머 설정
    if (this.options.duration !== 0 && this.options.type !== TOAST_TYPES.LOADING) {
      this.timer = setTimeout(() => {
        this.dismiss();
      }, this.options.duration);
    }
  }
}

/**
 * 글로벌 Toast 인스턴스 초기화
 */
if (typeof window !== 'undefined') {
  window.toastContainer = window.toastContainer || new ToastContainer();
}

/**
 * Toast API 함수들
 */
const toast = {
  /**
   * 기본 Toast 표시
   * @param {string|Object} message - 메시지 또는 옵션 객체
   * @param {Object} options - 추가 옵션
   * @returns {string} Toast ID
   */
  show(message, options = {}) {
    if (typeof message === 'string') {
      options = { description: message, ...options };
    } else {
      options = { ...message, ...options };
    }

    return window.toastContainer.addToast(options);
  },

  /**
   * 성공 Toast
   * @param {string|Object} message
   * @param {Object} options
   * @returns {string} Toast ID
   */
  success(message, options = {}) {
    return this.show(message, { type: TOAST_TYPES.SUCCESS, ...options });
  },

  /**
   * 에러 Toast
   * @param {string|Object} message
   * @param {Object} options
   * @returns {string} Toast ID
   */
  error(message, options = {}) {
    return this.show(message, { type: TOAST_TYPES.ERROR, ...options });
  },

  /**
   * 경고 Toast
   * @param {string|Object} message
   * @param {Object} options
   * @returns {string} Toast ID
   */
  warning(message, options = {}) {
    return this.show(message, { type: TOAST_TYPES.WARNING, ...options });
  },

  /**
   * 정보 Toast
   * @param {string|Object} message
   * @param {Object} options
   * @returns {string} Toast ID
   */
  info(message, options = {}) {
    return this.show(message, { type: TOAST_TYPES.INFO, ...options });
  },

  /**
   * 로딩 Toast
   * @param {string|Object} message
   * @param {Object} options
   * @returns {string} Toast ID
   */
  loading(message, options = {}) {
    return this.show(message, {
      type: TOAST_TYPES.LOADING,
      duration: 0,
      dismissible: false,
      ...options
    });
  },

  /**
   * Promise Toast (로딩 → 성공/실패)
   * @param {Promise} promise
   * @param {Object} messages
   * @param {Object} options
   * @returns {Promise}
   */
  promise(promise, messages = {}, options = {}) {
    const loadingToast = this.loading(messages.loading || 'Loading...', options);

    return promise
      .then((result) => {
        window.toastContainer.removeToast(loadingToast);
        this.success(messages.success || 'Success!', options);
        return result;
      })
      .catch((error) => {
        window.toastContainer.removeToast(loadingToast);
        this.error(messages.error || 'Something went wrong!', options);
        throw error;
      });
  },

  /**
   * Toast 제거
   * @param {string} toastId
   */
  dismiss(toastId) {
    if (toastId) {
      window.toastContainer.removeToast(toastId);
    } else {
      window.toastContainer.removeAllToasts();
    }
  },

  /**
   * Toast 업데이트
   * @param {string} toastId
   * @param {Object} updates
   */
  update(toastId, updates) {
    window.toastContainer.updateToast(toastId, updates);
  },

  /**
   * 설정 변경
   * @param {Object} config
   */
  configure(config) {
    if (window.toastContainer) {
      Object.assign(window.toastContainer, config);
    }
  }
};

// 편의 함수들
toast.dismiss.all = () => toast.dismiss();
toast.TYPES = TOAST_TYPES;
toast.POSITIONS = TOAST_POSITIONS;

/**
 * Toaster 컴포넌트 (컨테이너 초기화용)
 * HTML에 추가할 필요 없음 - 자동으로 관리됨
 */
class Toaster {
  static init(options = {}) {
    if (typeof window !== 'undefined') {
      window.toastContainer = new ToastContainer();
      toast.configure(options);
    }
  }
}

export { toast, Toast, ToastContainer, Toaster, TOAST_TYPES, TOAST_POSITIONS };
export default toast;