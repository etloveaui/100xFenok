import { cn } from '../core/utils.js';

/**
 * Tooltip Component System (바닐라 JS 변환 - Shadcn Tooltip 기반)
 *
 * Shadcn Tooltip 컴포넌트를 바닐라 JavaScript로 변환
 * - 호버/포커스 시 툴팁 표시
 * - 포지셔닝 및 방향 자동 조정
 * - 접근성 지원 (ARIA 속성)
 * - 키보드 네비게이션 지원
 * - 다양한 툴팁 스타일 및 위치
 * - 지연 시간 설정 가능
 */

class Tooltip {
  constructor(triggerElement, options = {}) {
    this.trigger = typeof triggerElement === 'string' ?
      document.querySelector(triggerElement) : triggerElement;

    if (!this.trigger) {
      throw new Error('Tooltip trigger element not found');
    }

    this.options = {
      content: '',
      position: 'top', // top, bottom, left, right, auto
      offset: 8,
      delay: 0,
      duration: 300,
      arrow: true,
      className: '',
      interactive: false,
      maxWidth: '200px',
      zIndex: 9999,
      trigger: 'hover', // hover, click, focus, manual
      hideOnClick: true,
      animation: 'fade', // fade, scale, slide
      theme: 'dark', // dark, light, custom
      ...options
    };

    this.state = {
      isVisible: false,
      isAnimating: false,
      timeoutId: null,
      position: this.options.position
    };

    this.tooltip = null;
    this.arrow = null;
    this.boundHandlers = {};

    this.init();
  }

  /**
   * 컴포넌트 초기화
   */
  init() {
    this.createTooltip();
    this.setupTrigger();
    this.bindEvents();
  }

  /**
   * 툴팁 요소 생성
   */
  createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = this.getTooltipClasses();
    this.tooltip.style.cssText = this.getBaseStyles();
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.setAttribute('data-state', 'closed');

    // 콘텐츠 설정
    this.setContent(this.options.content);

    // 화살표 생성
    if (this.options.arrow) {
      this.createArrow();
    }

    // DOM에 추가
    document.body.appendChild(this.tooltip);
  }

  /**
   * 툴팁 클래스 반환
   */
  getTooltipClasses() {
    const themeClasses = {
      dark: 'bg-popover text-popover-foreground border border-border',
      light: 'bg-background text-foreground border border-border shadow-md',
      custom: ''
    };

    const animationClasses = {
      fade: 'transition-opacity duration-300',
      scale: 'transition-all duration-300 origin-center',
      slide: 'transition-all duration-300'
    };

    return cn(
      'absolute px-3 py-1.5 text-sm rounded-md pointer-events-none z-50',
      'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      themeClasses[this.options.theme] || themeClasses.dark,
      animationClasses[this.options.animation] || animationClasses.fade,
      this.options.className
    );
  }

  /**
   * 기본 스타일 반환
   */
  getBaseStyles() {
    return `
      position: absolute;
      max-width: ${this.options.maxWidth};
      z-index: ${this.options.zIndex};
      opacity: 0;
      visibility: hidden;
      pointer-events: ${this.options.interactive ? 'auto' : 'none'};
      white-space: nowrap;
      overflow-wrap: break-word;
    `;
  }

  /**
   * 화살표 생성
   */
  createArrow() {
    this.arrow = document.createElement('div');
    this.arrow.className = 'absolute w-2 h-2 bg-inherit border-inherit transform rotate-45';
    this.tooltip.appendChild(this.arrow);
  }

  /**
   * 트리거 설정
   */
  setupTrigger() {
    const triggerId = this.trigger.id || `tooltip-trigger-${Date.now()}`;
    const tooltipId = `tooltip-${Date.now()}`;

    this.trigger.id = triggerId;
    this.trigger.setAttribute('aria-describedby', tooltipId);
    this.tooltip.id = tooltipId;
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    this.boundHandlers = {
      mouseenter: this.handleMouseEnter.bind(this),
      mouseleave: this.handleMouseLeave.bind(this),
      focus: this.handleFocus.bind(this),
      blur: this.handleBlur.bind(this),
      click: this.handleClick.bind(this),
      keydown: this.handleKeydown.bind(this),
      scroll: this.handleScroll.bind(this),
      resize: this.handleResize.bind(this)
    };

    // 트리거별 이벤트 설정
    if (this.options.trigger === 'hover' || this.options.trigger === 'focus') {
      this.trigger.addEventListener('mouseenter', this.boundHandlers.mouseenter);
      this.trigger.addEventListener('mouseleave', this.boundHandlers.mouseleave);
      this.trigger.addEventListener('focus', this.boundHandlers.focus);
      this.trigger.addEventListener('blur', this.boundHandlers.blur);
    }

    if (this.options.trigger === 'click') {
      this.trigger.addEventListener('click', this.boundHandlers.click);
    }

    // 키보드 지원
    this.trigger.addEventListener('keydown', this.boundHandlers.keydown);

    // 스크롤/리사이즈 시 위치 조정
    window.addEventListener('scroll', this.boundHandlers.scroll, true);
    window.addEventListener('resize', this.boundHandlers.resize);

    // 인터랙티브 툴팁 지원
    if (this.options.interactive) {
      this.tooltip.addEventListener('mouseenter', () => {
        this.clearTimeout();
      });
      this.tooltip.addEventListener('mouseleave', this.boundHandlers.mouseleave);
    }
  }

  /**
   * 마우스 엔터 핸들러
   */
  handleMouseEnter() {
    this.clearTimeout();
    this.show();
  }

  /**
   * 마우스 리브 핸들러
   */
  handleMouseLeave() {
    if (!this.options.interactive) {
      this.hide();
    } else {
      // 인터랙티브 툴팁의 경우 지연 후 숨김
      this.state.timeoutId = setTimeout(() => {
        if (!this.tooltip.matches(':hover')) {
          this.hide();
        }
      }, 100);
    }
  }

  /**
   * 포커스 핸들러
   */
  handleFocus() {
    this.show();
  }

  /**
   * 블러 핸들러
   */
  handleBlur() {
    this.hide();
  }

  /**
   * 클릭 핸들러
   */
  handleClick(event) {
    event.preventDefault();
    this.toggle();
  }

  /**
   * 키보드 핸들러
   */
  handleKeydown(event) {
    if (event.key === 'Escape' && this.state.isVisible) {
      this.hide();
    }
  }

  /**
   * 스크롤 핸들러
   */
  handleScroll() {
    if (this.state.isVisible) {
      this.updatePosition();
    }
  }

  /**
   * 리사이즈 핸들러
   */
  handleResize() {
    if (this.state.isVisible) {
      this.updatePosition();
    }
  }

  /**
   * 툴팁 표시
   */
  show() {
    if (this.state.isVisible || this.state.isAnimating) return;

    this.clearTimeout();

    const showTooltip = () => {
      this.state.isVisible = true;
      this.state.isAnimating = true;

      this.updatePosition();
      this.tooltip.setAttribute('data-state', 'open');
      this.tooltip.style.visibility = 'visible';
      this.tooltip.style.opacity = '1';

      // 애니메이션 완료 후
      setTimeout(() => {
        this.state.isAnimating = false;
      }, this.options.duration);
    };

    if (this.options.delay > 0) {
      this.state.timeoutId = setTimeout(showTooltip, this.options.delay);
    } else {
      showTooltip();
    }
  }

  /**
   * 툴팁 숨김
   */
  hide() {
    if (!this.state.isVisible) return;

    this.clearTimeout();
    this.state.isVisible = false;
    this.state.isAnimating = true;

    this.tooltip.setAttribute('data-state', 'closed');
    this.tooltip.style.opacity = '0';

    setTimeout(() => {
      this.tooltip.style.visibility = 'hidden';
      this.state.isAnimating = false;
    }, this.options.duration);
  }

  /**
   * 툴팁 토글
   */
  toggle() {
    if (this.state.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 위치 업데이트
   */
  updatePosition() {
    if (!this.state.isVisible) return;

    const triggerRect = this.trigger.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let position = this.options.position;

    // 자동 위치 조정
    if (position === 'auto') {
      position = this.calculateBestPosition(triggerRect, tooltipRect, viewportWidth, viewportHeight);
    }

    const coords = this.calculatePosition(triggerRect, tooltipRect, position);

    // 뷰포트 경계 확인 및 조정
    const adjustedCoords = this.adjustForViewport(coords, tooltipRect, viewportWidth, viewportHeight);

    this.tooltip.style.left = `${adjustedCoords.x}px`;
    this.tooltip.style.top = `${adjustedCoords.y}px`;

    // 화살표 위치 조정
    if (this.arrow) {
      this.updateArrowPosition(position, triggerRect, adjustedCoords);
    }

    this.state.position = position;
  }

  /**
   * 최적 위치 계산
   */
  calculateBestPosition(triggerRect, tooltipRect, viewportWidth, viewportHeight) {
    const positions = ['top', 'bottom', 'left', 'right'];
    const scores = {};

    positions.forEach(pos => {
      const coords = this.calculatePosition(triggerRect, tooltipRect, pos);
      scores[pos] = this.calculatePositionScore(coords, tooltipRect, viewportWidth, viewportHeight);
    });

    return Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
  }

  /**
   * 위치별 좌표 계산
   */
  calculatePosition(triggerRect, tooltipRect, position) {
    const offset = this.options.offset;
    let x, y;

    switch (position) {
      case 'top':
        x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        y = triggerRect.top - tooltipRect.height - offset;
        break;
      case 'bottom':
        x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        y = triggerRect.bottom + offset;
        break;
      case 'left':
        x = triggerRect.left - tooltipRect.width - offset;
        y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        break;
      case 'right':
        x = triggerRect.right + offset;
        y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        break;
      default:
        x = triggerRect.left;
        y = triggerRect.bottom + offset;
    }

    return { x: x + window.scrollX, y: y + window.scrollY };
  }

  /**
   * 위치 점수 계산
   */
  calculatePositionScore(coords, tooltipRect, viewportWidth, viewportHeight) {
    const { x, y } = coords;
    let score = 100;

    // 뷰포트 경계 벗어남 패널티
    if (x < 0) score -= Math.abs(x);
    if (y < 0) score -= Math.abs(y);
    if (x + tooltipRect.width > viewportWidth) score -= (x + tooltipRect.width - viewportWidth);
    if (y + tooltipRect.height > viewportHeight) score -= (y + tooltipRect.height - viewportHeight);

    return score;
  }

  /**
   * 뷰포트 경계 조정
   */
  adjustForViewport(coords, tooltipRect, viewportWidth, viewportHeight) {
    let { x, y } = coords;

    // 좌우 경계 조정
    if (x < 0) x = 8;
    if (x + tooltipRect.width > viewportWidth) {
      x = viewportWidth - tooltipRect.width - 8;
    }

    // 상하 경계 조정
    if (y < 0) y = 8;
    if (y + tooltipRect.height > viewportHeight) {
      y = viewportHeight - tooltipRect.height - 8;
    }

    return { x, y };
  }

  /**
   * 화살표 위치 업데이트
   */
  updateArrowPosition(position, triggerRect, tooltipCoords) {
    if (!this.arrow) return;

    const arrowSize = 8;
    let arrowX, arrowY;

    switch (position) {
      case 'top':
        arrowX = (triggerRect.left + triggerRect.width / 2) - tooltipCoords.x - arrowSize / 2;
        arrowY = this.tooltip.offsetHeight - arrowSize / 2;
        this.arrow.style.left = `${Math.max(arrowSize, Math.min(arrowX, this.tooltip.offsetWidth - arrowSize * 2))}px`;
        this.arrow.style.top = `${arrowY}px`;
        this.arrow.style.borderTop = 'none';
        this.arrow.style.borderLeft = 'none';
        break;
      case 'bottom':
        arrowX = (triggerRect.left + triggerRect.width / 2) - tooltipCoords.x - arrowSize / 2;
        arrowY = -arrowSize / 2;
        this.arrow.style.left = `${Math.max(arrowSize, Math.min(arrowX, this.tooltip.offsetWidth - arrowSize * 2))}px`;
        this.arrow.style.top = `${arrowY}px`;
        this.arrow.style.borderBottom = 'none';
        this.arrow.style.borderRight = 'none';
        break;
      case 'left':
        arrowX = this.tooltip.offsetWidth - arrowSize / 2;
        arrowY = (triggerRect.top + triggerRect.height / 2) - tooltipCoords.y - arrowSize / 2;
        this.arrow.style.left = `${arrowX}px`;
        this.arrow.style.top = `${Math.max(arrowSize, Math.min(arrowY, this.tooltip.offsetHeight - arrowSize * 2))}px`;
        this.arrow.style.borderLeft = 'none';
        this.arrow.style.borderTop = 'none';
        break;
      case 'right':
        arrowX = -arrowSize / 2;
        arrowY = (triggerRect.top + triggerRect.height / 2) - tooltipCoords.y - arrowSize / 2;
        this.arrow.style.left = `${arrowX}px`;
        this.arrow.style.top = `${Math.max(arrowSize, Math.min(arrowY, this.tooltip.offsetHeight - arrowSize * 2))}px`;
        this.arrow.style.borderRight = 'none';
        this.arrow.style.borderBottom = 'none';
        break;
    }
  }

  /**
   * 타이머 클리어
   */
  clearTimeout() {
    if (this.state.timeoutId) {
      clearTimeout(this.state.timeoutId);
      this.state.timeoutId = null;
    }
  }

  /**
   * 콘텐츠 설정
   * @param {string|HTMLElement} content
   */
  setContent(content) {
    if (typeof content === 'string') {
      this.tooltip.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      this.tooltip.innerHTML = '';
      this.tooltip.appendChild(content);
    }
    this.options.content = content;
  }

  /**
   * 위치 변경
   * @param {string} position
   */
  setPosition(position) {
    this.options.position = position;
    if (this.state.isVisible) {
      this.updatePosition();
    }
  }

  /**
   * 정리
   */
  destroy() {
    this.hide();

    // 이벤트 리스너 제거
    Object.entries(this.boundHandlers).forEach(([event, handler]) => {
      if (event === 'scroll' || event === 'resize') {
        window.removeEventListener(event, handler, true);
      } else {
        this.trigger.removeEventListener(event, handler);
      }
    });

    if (this.options.interactive) {
      this.tooltip.removeEventListener('mouseenter', this.boundHandlers.mouseenter);
      this.tooltip.removeEventListener('mouseleave', this.boundHandlers.mouseleave);
    }

    // DOM에서 제거
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
    }

    this.clearTimeout();
  }

  /**
   * 정적 메서드: 간단한 툴팁 생성
   * @param {HTMLElement|string} trigger
   * @param {string} content
   * @param {Object} options
   * @returns {Tooltip}
   */
  static create(trigger, content, options = {}) {
    return new Tooltip(trigger, { content, ...options });
  }

  /**
   * 정적 메서드: 여러 요소에 툴팁 적용
   * @param {string} selector
   * @param {Object} options
   * @returns {Tooltip[]}
   */
  static createForAll(selector, options = {}) {
    const elements = document.querySelectorAll(selector);
    return Array.from(elements).map(element => {
      const content = element.getAttribute('data-tooltip') ||
                     element.getAttribute('title') ||
                     options.content || '';

      // title 속성 제거 (브라우저 기본 툴팁 방지)
      if (element.hasAttribute('title')) {
        element.removeAttribute('title');
      }

      return new Tooltip(element, { content, ...options });
    });
  }
}

/**
 * Tooltip 헬퍼 함수들
 */
const TooltipHelpers = {
  /**
   * 데이터 속성 기반 툴팁 초기화
   */
  initDataTooltips() {
    return Tooltip.createForAll('[data-tooltip]');
  },

  /**
   * 확인 툴팁 생성
   */
  createConfirm(trigger, message, onConfirm, options = {}) {
    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirm';
    confirmButton.className = 'px-2 py-1 bg-destructive text-destructive-foreground rounded text-xs mr-1';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs';

    const content = document.createElement('div');
    content.innerHTML = `<div class="mb-2 text-xs">${message}</div>`;
    content.appendChild(confirmButton);
    content.appendChild(cancelButton);

    const tooltip = new Tooltip(trigger, {
      content,
      trigger: 'click',
      interactive: true,
      theme: 'light',
      position: 'bottom',
      ...options
    });

    confirmButton.addEventListener('click', () => {
      tooltip.hide();
      if (onConfirm) onConfirm();
    });

    cancelButton.addEventListener('click', () => {
      tooltip.hide();
    });

    return tooltip;
  },

  /**
   * 로딩 툴팁 생성
   */
  createLoading(trigger, message = 'Loading...', options = {}) {
    const content = document.createElement('div');
    content.className = 'flex items-center';
    content.innerHTML = `
      <div class="animate-spin mr-2 w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
      ${message}
    `;

    return new Tooltip(trigger, {
      content,
      trigger: 'manual',
      ...options
    });
  },

  /**
   * 리치 콘텐츠 툴팁 생성
   */
  createRich(trigger, options = {}) {
    const { title, description, image, actions = [] } = options;

    const content = document.createElement('div');
    content.className = 'max-w-xs';

    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.className = 'w-full h-24 object-cover rounded mb-2';
      content.appendChild(img);
    }

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'font-semibold mb-1';
      titleEl.textContent = title;
      content.appendChild(titleEl);
    }

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'text-sm text-muted-foreground mb-2';
      descEl.textContent = description;
      content.appendChild(descEl);
    }

    if (actions.length > 0) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'flex space-x-2';

      actions.forEach(action => {
        const button = document.createElement('button');
        button.textContent = action.label;
        button.className = 'px-2 py-1 bg-primary text-primary-foreground rounded text-xs';
        button.addEventListener('click', action.onClick);
        actionsEl.appendChild(button);
      });

      content.appendChild(actionsEl);
    }

    return new Tooltip(trigger, {
      content,
      interactive: true,
      theme: 'light',
      maxWidth: '300px',
      ...options
    });
  }
};

export { Tooltip, TooltipHelpers };
export default Tooltip;