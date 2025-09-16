import { cn, cva } from '../core/utils.js';

/**
 * Badge Component System (바닐라 JS 변환 - Shadcn Badge 기반)
 *
 * Shadcn Badge 컴포넌트를 바닐라 JavaScript로 변환
 * - 다양한 배지 variant 지원 (default, secondary, destructive, outline)
 * - 크기 조정 및 커스텀 스타일 지원
 * - 링크나 다른 요소에 배지 스타일 적용 가능
 * - 접근성 지원 및 시맨틱 마크업
 */

/**
 * Badge variant 스타일 정의
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

class Badge {
  constructor(element, options = {}) {
    this.element = typeof element === 'string' ? document.querySelector(element) : element;

    if (!this.element) {
      throw new Error('Badge element not found');
    }

    this.options = {
      variant: 'default',
      className: '',
      text: '',
      href: null,
      target: null,
      onClick: null,
      ...options
    };

    this.init();
  }

  /**
   * 컴포넌트 초기화
   */
  init() {
    this.setupElement();
    this.bindEvents();
  }

  /**
   * 기본 요소 설정
   */
  setupElement() {
    // 배지 스타일 적용
    const badgeClasses = badgeVariants({
      variant: this.options.variant
    });

    this.element.className = cn(badgeClasses, this.options.className);

    // 텍스트 설정
    if (this.options.text) {
      this.element.textContent = this.options.text;
    }

    // 링크로 사용하는 경우
    if (this.options.href) {
      if (this.element.tagName !== 'A') {
        // 기존 요소를 링크로 감싸기
        const link = document.createElement('a');
        link.href = this.options.href;
        if (this.options.target) {
          link.target = this.options.target;
        }
        link.className = this.element.className;
        link.textContent = this.element.textContent;

        // 기존 요소 교체
        this.element.parentNode.replaceChild(link, this.element);
        this.element = link;
      } else {
        this.element.href = this.options.href;
        if (this.options.target) {
          this.element.target = this.options.target;
        }
      }
    }

    // 접근성 속성
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    if (this.options.onClick) {
      this.element.addEventListener('click', (event) => {
        this.options.onClick(event, this);
      });
    }
  }

  /**
   * 배지 텍스트 업데이트
   * @param {string} text
   */
  setText(text) {
    this.element.textContent = text;
    this.options.text = text;
  }

  /**
   * 배지 variant 변경
   * @param {string} variant
   */
  setVariant(variant) {
    const oldClasses = badgeVariants({ variant: this.options.variant });
    const newClasses = badgeVariants({ variant });

    // 기존 variant 클래스 제거
    oldClasses.split(' ').forEach(cls => {
      this.element.classList.remove(cls);
    });

    // 새 variant 클래스 추가
    newClasses.split(' ').forEach(cls => {
      this.element.classList.add(cls);
    });

    this.options.variant = variant;
  }

  /**
   * 배지 숨기기
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * 배지 보이기
   */
  show() {
    this.element.style.display = 'inline-flex';
  }

  /**
   * 배지 제거
   */
  remove() {
    this.element.remove();
  }

  /**
   * 정리
   */
  destroy() {
    if (this.options.onClick) {
      this.element.removeEventListener('click', this.options.onClick);
    }
  }

  /**
   * 정적 메서드: 배지 요소 생성
   * @param {Object} options
   * @returns {HTMLElement}
   */
  static create(options = {}) {
    const {
      tag = 'span',
      variant = 'default',
      text = '',
      className = '',
      href = null,
      target = null,
      id = null,
      ...otherOptions
    } = options;

    // 태그 결정 (href가 있으면 링크)
    const tagName = href ? 'a' : tag;
    const element = document.createElement(tagName);

    // 기본 속성 설정
    if (id) element.id = id;
    if (href) {
      element.href = href;
      if (target) element.target = target;
    }

    // 배지 스타일 적용
    const badgeClasses = badgeVariants({ variant });
    element.className = cn(badgeClasses, className);
    element.textContent = text;

    // 접근성 속성
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');

    return element;
  }

  /**
   * 정적 메서드: 기존 요소에 배지 스타일 적용
   * @param {HTMLElement|string} element
   * @param {Object} options
   * @returns {HTMLElement}
   */
  static applyTo(element, options = {}) {
    const targetElement = typeof element === 'string' ? document.querySelector(element) : element;

    if (!targetElement) {
      throw new Error('Target element not found');
    }

    const { variant = 'default', className = '' } = options;
    const badgeClasses = badgeVariants({ variant });

    targetElement.className = cn(badgeClasses, className);
    targetElement.setAttribute('role', 'status');
    targetElement.setAttribute('aria-live', 'polite');

    return targetElement;
  }
}

/**
 * Badge 헬퍼 함수들
 */
const BadgeHelpers = {
  /**
   * 상태 배지 생성
   */
  createStatus(status, options = {}) {
    const statusVariants = {
      success: 'default',
      warning: 'secondary',
      error: 'destructive',
      info: 'outline'
    };

    return Badge.create({
      text: status.charAt(0).toUpperCase() + status.slice(1),
      variant: statusVariants[status] || 'default',
      ...options
    });
  },

  /**
   * 카운트 배지 생성
   */
  createCount(count, options = {}) {
    const displayCount = count > 99 ? '99+' : count.toString();

    return Badge.create({
      text: displayCount,
      variant: 'destructive',
      className: 'min-w-[1.25rem] h-5 px-1 text-[10px]',
      ...options
    });
  },

  /**
   * 카테고리 배지 생성
   */
  createCategory(category, options = {}) {
    return Badge.create({
      text: category,
      variant: 'secondary',
      ...options
    });
  },

  /**
   * 링크 배지 생성
   */
  createLink(text, href, options = {}) {
    return Badge.create({
      text,
      href,
      variant: 'outline',
      target: '_blank',
      ...options
    });
  },

  /**
   * 제거 가능한 배지 생성
   */
  createRemovable(text, onRemove, options = {}) {
    const badge = Badge.create({
      text: `${text} ×`,
      variant: 'secondary',
      className: 'cursor-pointer hover:bg-secondary/60',
      ...options
    });

    badge.addEventListener('click', (event) => {
      event.preventDefault();
      if (onRemove) {
        onRemove(badge);
      } else {
        badge.remove();
      }
    });

    return badge;
  },

  /**
   * 애니메이션 배지 생성
   */
  createAnimated(text, options = {}) {
    const badge = Badge.create({
      text,
      className: 'animate-pulse',
      ...options
    });

    // 3초 후 애니메이션 중지
    setTimeout(() => {
      badge.classList.remove('animate-pulse');
    }, 3000);

    return badge;
  }
};

/**
 * badgeVariants 헬퍼 함수 export
 * 다른 컴포넌트에서 배지 스타일을 적용할 때 사용
 */
export { Badge, BadgeHelpers, badgeVariants };
export default Badge;