import { cn } from '../core/utils.js';

/**
 * Tabs Component System (바닐라 JS 변환 - Shadcn Tabs 기반)
 *
 * Shadcn Tabs 컴포넌트를 바닐라 JavaScript로 변환
 * - Tabs, TabsList, TabsTrigger, TabsContent 컴포넌트 구조
 * - 키보드 네비게이션 (Arrow 키, Home, End)
 * - 접근성 지원 (ARIA 속성)
 * - 탭 상태 관리 및 콘텐츠 표시
 * - 동적 탭 추가/제거 지원
 */

class Tabs {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;

    if (!this.container) {
      throw new Error('Tabs container not found');
    }

    this.options = {
      defaultValue: '',
      value: '',
      orientation: 'horizontal',
      activationMode: 'automatic',
      className: '',
      onValueChange: null,
      ...options
    };

    this.state = {
      value: this.options.value || this.options.defaultValue,
      isUncontrolled: !this.options.value
    };

    this.tabsList = null;
    this.triggers = new Map();
    this.contents = new Map();

    this.init();
  }

  /**
   * 컴포넌트 초기화
   */
  init() {
    this.setupContainer();
    this.bindEvents();
    this.updateActiveTab();
  }

  /**
   * 기본 컨테이너 설정
   */
  setupContainer() {
    const baseClasses = 'tabs-root';
    this.container.className = cn(baseClasses, this.options.className);
    this.container.setAttribute('data-orientation', this.options.orientation);
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    this.container.addEventListener('click', this.handleClick.bind(this));
    this.container.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  /**
   * 클릭 이벤트 핸들러
   * @param {Event} event
   */
  handleClick(event) {
    const trigger = event.target.closest('[data-tabs-trigger]');
    if (trigger) {
      const value = trigger.getAttribute('data-value');
      if (value) {
        this.setValue(value);
      }
    }
  }

  /**
   * 키보드 이벤트 핸들러
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    const trigger = event.target.closest('[data-tabs-trigger]');
    if (!trigger) return;

    const triggers = Array.from(this.triggers.values());
    const currentIndex = triggers.findIndex(t => t.element === trigger);

    let targetIndex = currentIndex;
    let shouldPreventDefault = true;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        targetIndex = currentIndex > 0 ? currentIndex - 1 : triggers.length - 1;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        targetIndex = currentIndex < triggers.length - 1 ? currentIndex + 1 : 0;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = triggers.length - 1;
        break;
      case 'Enter':
      case ' ':
        this.setValue(trigger.getAttribute('data-value'));
        break;
      default:
        shouldPreventDefault = false;
    }

    if (shouldPreventDefault) {
      event.preventDefault();

      if (targetIndex !== currentIndex) {
        const targetTrigger = triggers[targetIndex].element;
        targetTrigger.focus();

        if (this.options.activationMode === 'automatic') {
          this.setValue(targetTrigger.getAttribute('data-value'));
        }
      }
    }
  }

  /**
   * 탭 값 설정
   * @param {string} value
   */
  setValue(value) {
    if (this.state.value === value) return;

    const oldValue = this.state.value;
    this.state.value = value;

    this.updateActiveTab();

    if (this.options.onValueChange) {
      this.options.onValueChange(value, oldValue);
    }
  }

  /**
   * 현재 활성 탭 값 반환
   * @returns {string}
   */
  getValue() {
    return this.state.value;
  }

  /**
   * 활성 탭 UI 업데이트
   */
  updateActiveTab() {
    // 모든 트리거 비활성화
    this.triggers.forEach((trigger, value) => {
      const isActive = value === this.state.value;
      trigger.element.setAttribute('data-state', isActive ? 'active' : 'inactive');
      trigger.element.setAttribute('aria-selected', isActive);
      trigger.element.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    // 모든 콘텐츠 숨김/표시
    this.contents.forEach((content, value) => {
      const isActive = value === this.state.value;
      content.element.setAttribute('data-state', isActive ? 'active' : 'inactive');
      content.element.style.display = isActive ? 'block' : 'none';
    });
  }

  /**
   * TabsList 생성
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createTabsList(options = {}) {
    const { className = '', ...otherOptions } = options;

    this.tabsList = document.createElement('div');
    this.tabsList.className = cn(
      'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
      className
    );
    this.tabsList.setAttribute('role', 'tablist');
    this.tabsList.setAttribute('aria-orientation', this.options.orientation);
    this.tabsList.setAttribute('data-tabs-list', '');

    this.container.appendChild(this.tabsList);
    return this.tabsList;
  }

  /**
   * TabsTrigger 생성
   * @param {string} value
   * @param {string} label
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createTabsTrigger(value, label, options = {}) {
    const { className = '', disabled = false, ...otherOptions } = options;

    const trigger = document.createElement('button');
    trigger.className = cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className
    );

    trigger.textContent = label;
    trigger.setAttribute('role', 'tab');
    trigger.setAttribute('data-tabs-trigger', '');
    trigger.setAttribute('data-value', value);
    trigger.setAttribute('data-state', 'inactive');
    trigger.setAttribute('aria-selected', 'false');
    trigger.setAttribute('tabindex', '-1');
    trigger.disabled = disabled;

    if (this.tabsList) {
      this.tabsList.appendChild(trigger);
    } else {
      this.container.appendChild(trigger);
    }

    // 트리거 등록
    this.triggers.set(value, {
      element: trigger,
      label,
      disabled
    });

    return trigger;
  }

  /**
   * TabsContent 생성
   * @param {string} value
   * @param {string|HTMLElement} content
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createTabsContent(value, content, options = {}) {
    const { className = '', ...otherOptions } = options;

    const contentElement = document.createElement('div');
    contentElement.className = cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    );

    contentElement.setAttribute('role', 'tabpanel');
    contentElement.setAttribute('data-tabs-content', '');
    contentElement.setAttribute('data-value', value);
    contentElement.setAttribute('data-state', 'inactive');
    contentElement.setAttribute('tabindex', '0');
    contentElement.style.display = 'none';

    // 콘텐츠 설정
    if (typeof content === 'string') {
      contentElement.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      contentElement.appendChild(content);
    }

    this.container.appendChild(contentElement);

    // 콘텐츠 등록
    this.contents.set(value, {
      element: contentElement,
      content
    });

    return contentElement;
  }

  /**
   * 탭 추가
   * @param {string} value
   * @param {string} label
   * @param {string|HTMLElement} content
   * @param {Object} options
   */
  addTab(value, label, content, options = {}) {
    if (this.triggers.has(value)) {
      console.warn(`Tab with value "${value}" already exists`);
      return;
    }

    this.createTabsTrigger(value, label, options.trigger);
    this.createTabsContent(value, content, options.content);

    // 첫 번째 탭이라면 활성화
    if (this.triggers.size === 1 && !this.state.value) {
      this.setValue(value);
    }
  }

  /**
   * 탭 제거
   * @param {string} value
   */
  removeTab(value) {
    const trigger = this.triggers.get(value);
    const content = this.contents.get(value);

    if (trigger) {
      trigger.element.remove();
      this.triggers.delete(value);
    }

    if (content) {
      content.element.remove();
      this.contents.delete(value);
    }

    // 활성 탭이 제거된 경우 다른 탭으로 전환
    if (this.state.value === value) {
      const remainingTriggers = Array.from(this.triggers.keys());
      if (remainingTriggers.length > 0) {
        this.setValue(remainingTriggers[0]);
      } else {
        this.state.value = '';
      }
    }
  }

  /**
   * 모든 탭 제거
   */
  clearTabs() {
    this.triggers.forEach((trigger, value) => {
      trigger.element.remove();
    });
    this.contents.forEach((content, value) => {
      content.element.remove();
    });

    this.triggers.clear();
    this.contents.clear();
    this.state.value = '';
  }

  /**
   * 탭 활성화/비활성화
   * @param {string} value
   * @param {boolean} disabled
   */
  setTabDisabled(value, disabled) {
    const trigger = this.triggers.get(value);
    if (trigger) {
      trigger.element.disabled = disabled;
      trigger.disabled = disabled;

      if (disabled && this.state.value === value) {
        // 비활성화된 탭이 현재 활성 탭이면 다른 활성 탭으로 전환
        const enabledTriggers = Array.from(this.triggers.entries())
          .filter(([_, trigger]) => !trigger.disabled)
          .map(([value, _]) => value);

        if (enabledTriggers.length > 0) {
          this.setValue(enabledTriggers[0]);
        }
      }
    }
  }

  /**
   * 정리
   */
  destroy() {
    this.container.removeEventListener('click', this.handleClick);
    this.container.removeEventListener('keydown', this.handleKeydown);

    this.clearTabs();

    if (this.tabsList) {
      this.tabsList.remove();
    }
  }

  /**
   * 정적 메서드: 완전한 Tabs 생성
   * @param {Object} options
   * @returns {Tabs}
   */
  static create(options = {}) {
    const {
      container,
      tabs = [],
      tabsListOptions = {},
      ...tabsOptions
    } = options;

    // 컨테이너 생성 또는 선택
    let containerElement;
    if (typeof container === 'string') {
      containerElement = document.querySelector(container);
    } else if (container instanceof HTMLElement) {
      containerElement = container;
    } else {
      containerElement = document.createElement('div');
      document.body.appendChild(containerElement);
    }

    // Tabs 인스턴스 생성
    const tabsInstance = new Tabs(containerElement, tabsOptions);

    // TabsList 생성
    tabsInstance.createTabsList(tabsListOptions);

    // 탭들 추가
    tabs.forEach(tab => {
      const { value, label, content, ...tabOptions } = tab;
      tabsInstance.addTab(value, label, content, tabOptions);
    });

    return tabsInstance;
  }
}

/**
 * 간편한 탭 생성 헬퍼 함수들
 */
const TabsHelpers = {
  /**
   * 기본 탭 세트 생성
   */
  createBasicTabs(container, tabs, options = {}) {
    return Tabs.create({
      container,
      tabs,
      ...options
    });
  },

  /**
   * 카드 스타일 탭 생성
   */
  createCardTabs(container, tabs, options = {}) {
    return Tabs.create({
      container,
      tabs,
      tabsListOptions: {
        className: 'grid w-full grid-cols-2'
      },
      ...options
    });
  },

  /**
   * 세로 탭 생성
   */
  createVerticalTabs(container, tabs, options = {}) {
    return Tabs.create({
      container,
      tabs,
      orientation: 'vertical',
      tabsListOptions: {
        className: 'flex-col h-auto'
      },
      ...options
    });
  }
};

export { Tabs, TabsHelpers };
export default Tabs;