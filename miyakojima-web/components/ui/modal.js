import { cn, Slot } from '../core/utils.js';

/**
 * Modal Component System (바닐라 JS 변환 - Shadcn Dialog 기반)
 *
 * Shadcn Dialog 컴포넌트를 바닐라 JavaScript로 변환
 * - 모달 오버레이 및 콘텐츠 관리
 * - 키보드 네비게이션 (ESC 키)
 * - 접근성 지원 (ARIA 속성)
 * - 백드롭 클릭으로 닫기
 * - 스크롤 잠금 관리
 */

class Modal {
  constructor(options = {}) {
    this.isOpen = false;
    this.options = {
      closeOnBackdrop: true,
      closeOnEscape: true,
      className: '',
      ...options
    };

    this.overlay = null;
    this.content = null;
    this.trigger = null;
    this.onOpenChange = options.onOpenChange || (() => {});

    this.boundKeyHandler = this.handleKeydown.bind(this);
    this.boundBackdropHandler = this.handleBackdropClick.bind(this);
  }

  /**
   * 모달 트리거 생성
   * @param {HTMLElement|string} element - 버튼 요소 또는 셀렉터
   * @param {Object} options - 트리거 옵션
   * @returns {HTMLElement} 트리거 요소
   */
  static createTrigger(element, options = {}) {
    const trigger = typeof element === 'string' ? document.querySelector(element) : element;

    if (!trigger) {
      console.warn('Modal trigger element not found');
      return null;
    }

    // 기본 클래스 적용
    const baseClasses = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
    const triggerClasses = options.variant ? this.getButtonVariant(options.variant) : 'bg-primary text-primary-foreground hover:bg-primary/90';
    const sizeClasses = options.size ? this.getButtonSize(options.size) : 'h-10 px-4 py-2';

    trigger.className = cn(
      baseClasses,
      triggerClasses,
      sizeClasses,
      options.className || ''
    );

    return trigger;
  }

  /**
   * 모달 콘텐츠 생성
   * @param {Object} options - 콘텐츠 옵션
   * @returns {HTMLElement} 콘텐츠 요소
   */
  createContent(options = {}) {
    // 오버레이 생성
    this.overlay = document.createElement('div');
    this.overlay.className = cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      options.overlayClassName || ''
    );
    this.overlay.setAttribute('data-state', 'closed');
    this.overlay.style.display = 'none';

    // 콘텐츠 컨테이너 생성
    this.content = document.createElement('div');
    this.content.className = cn(
      'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
      options.className || ''
    );
    this.content.setAttribute('role', 'dialog');
    this.content.setAttribute('aria-modal', 'true');
    this.content.setAttribute('data-state', 'closed');
    this.content.style.display = 'none';

    // 닫기 버튼 생성 (선택적)
    if (options.showCloseButton !== false) {
      const closeButton = document.createElement('button');
      closeButton.className = 'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground';
      closeButton.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.addEventListener('click', () => this.close());
      this.content.appendChild(closeButton);
    }

    // 이벤트 리스너 설정
    if (this.options.closeOnBackdrop) {
      this.overlay.addEventListener('click', this.boundBackdropHandler);
    }

    return this.content;
  }

  /**
   * 모달 헤더 생성
   * @param {Object} options - 헤더 옵션
   * @returns {HTMLElement} 헤더 요소
   */
  static createHeader(options = {}) {
    const header = document.createElement('div');
    header.className = cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      options.className || ''
    );

    return header;
  }

  /**
   * 모달 제목 생성
   * @param {string} title - 제목 텍스트
   * @param {Object} options - 제목 옵션
   * @returns {HTMLElement} 제목 요소
   */
  static createTitle(title, options = {}) {
    const titleElement = document.createElement('h2');
    titleElement.className = cn(
      'text-lg font-semibold leading-none tracking-tight',
      options.className || ''
    );
    titleElement.textContent = title;
    titleElement.setAttribute('id', options.id || 'modal-title');

    return titleElement;
  }

  /**
   * 모달 설명 생성
   * @param {string} description - 설명 텍스트
   * @param {Object} options - 설명 옵션
   * @returns {HTMLElement} 설명 요소
   */
  static createDescription(description, options = {}) {
    const descElement = document.createElement('p');
    descElement.className = cn(
      'text-sm text-muted-foreground',
      options.className || ''
    );
    descElement.textContent = description;
    descElement.setAttribute('id', options.id || 'modal-description');

    return descElement;
  }

  /**
   * 모달 푸터 생성
   * @param {Object} options - 푸터 옵션
   * @returns {HTMLElement} 푸터 요소
   */
  static createFooter(options = {}) {
    const footer = document.createElement('div');
    footer.className = cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      options.className || ''
    );

    return footer;
  }

  /**
   * 모달 열기
   */
  open() {
    if (this.isOpen) return;

    this.isOpen = true;

    // body 스크롤 잠금
    document.body.style.overflow = 'hidden';

    // DOM에 추가
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.content);

    // 애니메이션을 위한 지연
    requestAnimationFrame(() => {
      this.overlay.style.display = 'block';
      this.content.style.display = 'grid';
      this.overlay.setAttribute('data-state', 'open');
      this.content.setAttribute('data-state', 'open');
    });

    // 키보드 이벤트 등록
    if (this.options.closeOnEscape) {
      document.addEventListener('keydown', this.boundKeyHandler);
    }

    // 포커스 관리
    const focusableElement = this.content.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElement) {
      focusableElement.focus();
    }

    this.onOpenChange(true);
  }

  /**
   * 모달 닫기
   */
  close() {
    if (!this.isOpen) return;

    this.isOpen = false;

    // 애니메이션
    this.overlay.setAttribute('data-state', 'closed');
    this.content.setAttribute('data-state', 'closed');

    // 애니메이션 완료 후 DOM에서 제거
    setTimeout(() => {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      if (this.content && this.content.parentNode) {
        this.content.parentNode.removeChild(this.content);
      }

      // body 스크롤 복원
      document.body.style.overflow = '';
    }, 200);

    // 키보드 이벤트 제거
    document.removeEventListener('keydown', this.boundKeyHandler);

    this.onOpenChange(false);
  }

  /**
   * 키보드 이벤트 핸들러
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  /**
   * 백드롭 클릭 핸들러
   * @param {MouseEvent} event
   */
  handleBackdropClick(event) {
    if (event.target === this.overlay) {
      this.close();
    }
  }

  /**
   * 버튼 variant 스타일 반환
   * @param {string} variant
   * @returns {string}
   */
  static getButtonVariant(variant) {
    const variants = {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline'
    };

    return variants[variant] || variants.default;
  }

  /**
   * 버튼 size 스타일 반환
   * @param {string} size
   * @returns {string}
   */
  static getButtonSize(size) {
    const sizes = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 rounded-md px-3',
      lg: 'h-11 rounded-md px-8',
      icon: 'h-10 w-10'
    };

    return sizes[size] || sizes.default;
  }

  /**
   * 완전한 모달 생성 (편의 메서드)
   * @param {Object} options - 모달 설정
   * @returns {Modal} 모달 인스턴스
   */
  static create(options = {}) {
    const {
      trigger,
      title,
      description,
      content,
      footer,
      triggerOptions = {},
      contentOptions = {},
      ...modalOptions
    } = options;

    const modal = new Modal(modalOptions);

    // 트리거 설정
    if (trigger) {
      const triggerElement = Modal.createTrigger(trigger, triggerOptions);
      if (triggerElement) {
        triggerElement.addEventListener('click', () => modal.open());
        modal.trigger = triggerElement;
      }
    }

    // 콘텐츠 생성
    const contentContainer = modal.createContent(contentOptions);

    // 헤더 추가
    if (title || description) {
      const header = Modal.createHeader();

      if (title) {
        const titleElement = Modal.createTitle(title);
        header.appendChild(titleElement);
        contentContainer.setAttribute('aria-labelledby', 'modal-title');
      }

      if (description) {
        const descElement = Modal.createDescription(description);
        header.appendChild(descElement);
        contentContainer.setAttribute('aria-describedby', 'modal-description');
      }

      contentContainer.appendChild(header);
    }

    // 본문 콘텐츠 추가
    if (content) {
      const contentElement = document.createElement('div');
      contentElement.className = 'py-4';

      if (typeof content === 'string') {
        contentElement.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        contentElement.appendChild(content);
      }

      contentContainer.appendChild(contentElement);
    }

    // 푸터 추가
    if (footer) {
      const footerElement = Modal.createFooter();

      if (Array.isArray(footer)) {
        footer.forEach(button => {
          if (button instanceof HTMLElement) {
            footerElement.appendChild(button);
          }
        });
      } else if (footer instanceof HTMLElement) {
        footerElement.appendChild(footer);
      }

      contentContainer.appendChild(footerElement);
    }

    return modal;
  }

  /**
   * 간단한 확인 모달 생성
   * @param {Object} options - 확인 모달 옵션
   * @returns {Promise<boolean>} 사용자 선택 결과
   */
  static confirm(options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Confirm',
        description = 'Are you sure?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        confirmVariant = 'default',
        ...otherOptions
      } = options;

      // 버튼 생성
      const cancelButton = document.createElement('button');
      cancelButton.className = cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        Modal.getButtonVariant('outline'),
        Modal.getButtonSize('default'),
        'mt-2 sm:mt-0'
      );
      cancelButton.textContent = cancelText;

      const confirmButton = document.createElement('button');
      confirmButton.className = cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        Modal.getButtonVariant(confirmVariant),
        Modal.getButtonSize('default')
      );
      confirmButton.textContent = confirmText;

      const modal = Modal.create({
        title,
        description,
        footer: [cancelButton, confirmButton],
        closeOnBackdrop: false,
        contentOptions: { showCloseButton: false },
        ...otherOptions
      });

      // 이벤트 리스너
      cancelButton.addEventListener('click', () => {
        modal.close();
        resolve(false);
      });

      confirmButton.addEventListener('click', () => {
        modal.close();
        resolve(true);
      });

      modal.open();
    });
  }

  /**
   * 정리 메서드
   */
  destroy() {
    this.close();
    document.removeEventListener('keydown', this.boundKeyHandler);

    if (this.trigger) {
      this.trigger.removeEventListener('click', () => this.open());
    }
  }
}

export { Modal };
export default Modal;