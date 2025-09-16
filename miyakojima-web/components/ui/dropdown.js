import { cn } from '../core/utils.js';

/**
 * Dropdown Menu Component System (바닐라 JS 변환 - Shadcn DropdownMenu 기반)
 *
 * Shadcn DropdownMenu 컴포넌트를 바닐라 JavaScript로 변환
 * - 트리거 기반 드롭다운 메뉴
 * - 키보드 네비게이션 (방향키, Enter, Esc)
 * - 포지셔닝 시스템 (top, bottom, left, right)
 * - 메뉴 아이템 지원 (label, separator, checkbox, radio)
 * - 서브메뉴 지원
 * - 접근성 지원 (ARIA 속성)
 * - 외부 클릭으로 닫기
 */

/**
 * Dropdown Menu 메인 클래스
 */
class DropdownMenu {
  constructor(trigger, options = {}) {
    this.trigger = typeof trigger === 'string' ? document.querySelector(trigger) : trigger;

    if (!this.trigger) {
      throw new Error('Dropdown trigger element not found');
    }

    this.options = {
      position: 'bottom-start', // top-start, top-end, bottom-start, bottom-end, left-start, etc.
      offset: 8,
      className: '',
      closeOnSelect: true,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      maxHeight: '300px',
      width: 'auto',
      ...options
    };

    this.isOpen = false;
    this.content = null;
    this.items = [];
    this.currentIndex = -1;
    this.subMenus = new Map();

    this.boundOutsideClick = this.handleOutsideClick.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);

    this.init();
  }

  /**
   * 초기화
   */
  init() {
    this.setupTrigger();
    this.createContent();
  }

  /**
   * 트리거 설정
   */
  setupTrigger() {
    this.trigger.className = cn(
      this.trigger.className,
      'cursor-pointer'
    );

    this.trigger.setAttribute('aria-haspopup', 'menu');
    this.trigger.setAttribute('aria-expanded', 'false');

    this.trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
  }

  /**
   * 드롭다운 콘텐츠 생성
   */
  createContent() {
    this.content = document.createElement('div');
    this.content.className = cn(
      'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      this.options.className
    );

    this.content.setAttribute('role', 'menu');
    this.content.setAttribute('data-state', 'closed');
    this.content.style.display = 'none';
    this.content.style.maxHeight = this.options.maxHeight;

    if (this.options.width !== 'auto') {
      this.content.style.width = this.options.width;
    }

    // 스크롤 가능하도록 설정
    this.content.style.overflowY = 'auto';

    document.body.appendChild(this.content);
  }

  /**
   * 메뉴 아이템 추가
   * @param {Object} itemOptions - 아이템 옵션
   * @returns {HTMLElement} 생성된 아이템 요소
   */
  addItem(itemOptions) {
    const item = DropdownMenuItem.create(itemOptions, this);
    this.content.appendChild(item.element);
    this.items.push(item);
    return item.element;
  }

  /**
   * 라벨 추가
   * @param {string} text - 라벨 텍스트
   * @param {Object} options - 옵션
   * @returns {HTMLElement}
   */
  addLabel(text, options = {}) {
    const label = DropdownMenuLabel.create(text, options);
    this.content.appendChild(label);
    return label;
  }

  /**
   * 구분자 추가
   * @param {Object} options - 옵션
   * @returns {HTMLElement}
   */
  addSeparator(options = {}) {
    const separator = DropdownMenuSeparator.create(options);
    this.content.appendChild(separator);
    return separator;
  }

  /**
   * 서브메뉴 추가
   * @param {Object} submenuOptions - 서브메뉴 옵션
   * @returns {DropdownSubMenu}
   */
  addSubMenu(submenuOptions) {
    const submenu = new DropdownSubMenu(submenuOptions, this);
    this.content.appendChild(submenu.element);
    this.subMenus.set(submenu.id, submenu);
    return submenu;
  }

  /**
   * 드롭다운 열기
   */
  open() {
    if (this.isOpen) return;

    this.isOpen = true;
    this.content.style.display = 'block';
    this.content.setAttribute('data-state', 'open');
    this.trigger.setAttribute('aria-expanded', 'true');

    this.positionContent();

    // 이벤트 리스너 등록
    if (this.options.closeOnOutsideClick) {
      setTimeout(() => {
        document.addEventListener('click', this.boundOutsideClick);
      }, 0);
    }

    if (this.options.closeOnEscape) {
      document.addEventListener('keydown', this.boundKeyDown);
    }

    // 첫 번째 아이템에 포커스
    this.focusFirstItem();
  }

  /**
   * 드롭다운 닫기
   */
  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.content.setAttribute('data-state', 'closed');
    this.trigger.setAttribute('aria-expanded', 'false');

    // 애니메이션 후 숨김
    setTimeout(() => {
      this.content.style.display = 'none';
    }, 150);

    // 이벤트 리스너 제거
    document.removeEventListener('click', this.boundOutsideClick);
    document.removeEventListener('keydown', this.boundKeyDown);

    // 포커스 인덱스 리셋
    this.currentIndex = -1;
    this.updateFocus();

    // 서브메뉴 닫기
    this.subMenus.forEach(submenu => submenu.close());
  }

  /**
   * 토글
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * 콘텐츠 위치 조정
   */
  positionContent() {
    const triggerRect = this.trigger.getBoundingClientRect();
    const contentRect = this.content.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top, left;

    // 위치 계산
    switch (this.options.position) {
      case 'top-start':
        top = triggerRect.top - contentRect.height - this.options.offset;
        left = triggerRect.left;
        this.content.setAttribute('data-side', 'top');
        break;
      case 'top-end':
        top = triggerRect.top - contentRect.height - this.options.offset;
        left = triggerRect.right - contentRect.width;
        this.content.setAttribute('data-side', 'top');
        break;
      case 'bottom-start':
        top = triggerRect.bottom + this.options.offset;
        left = triggerRect.left;
        this.content.setAttribute('data-side', 'bottom');
        break;
      case 'bottom-end':
        top = triggerRect.bottom + this.options.offset;
        left = triggerRect.right - contentRect.width;
        this.content.setAttribute('data-side', 'bottom');
        break;
      case 'left-start':
        top = triggerRect.top;
        left = triggerRect.left - contentRect.width - this.options.offset;
        this.content.setAttribute('data-side', 'left');
        break;
      case 'right-start':
        top = triggerRect.top;
        left = triggerRect.right + this.options.offset;
        this.content.setAttribute('data-side', 'right');
        break;
      default:
        top = triggerRect.bottom + this.options.offset;
        left = triggerRect.left;
        this.content.setAttribute('data-side', 'bottom');
    }

    // 뷰포트 경계 확인 및 조정
    if (left + contentRect.width > viewportWidth) {
      left = viewportWidth - contentRect.width - 10;
    }
    if (left < 10) {
      left = 10;
    }

    if (top + contentRect.height > viewportHeight) {
      top = triggerRect.top - contentRect.height - this.options.offset;
      this.content.setAttribute('data-side', 'top');
    }
    if (top < 10) {
      top = 10;
    }

    this.content.style.left = `${left}px`;
    this.content.style.top = `${top}px`;
  }

  /**
   * 외부 클릭 핸들러
   * @param {Event} event
   */
  handleOutsideClick(event) {
    if (!this.content.contains(event.target) && !this.trigger.contains(event.target)) {
      this.close();
    }
  }

  /**
   * 키보드 이벤트 핸들러
   * @param {KeyboardEvent} event
   */
  handleKeyDown(event) {
    if (!this.isOpen) return;

    const focusableItems = this.items.filter(item => !item.options.disabled);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        this.trigger.focus();
        break;

      case 'ArrowDown':
        event.preventDefault();
        this.currentIndex = Math.min(this.currentIndex + 1, focusableItems.length - 1);
        this.updateFocus();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.currentIndex = Math.max(this.currentIndex - 1, 0);
        this.updateFocus();
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.currentIndex >= 0 && focusableItems[this.currentIndex]) {
          focusableItems[this.currentIndex].click();
        }
        break;

      case 'Home':
        event.preventDefault();
        this.currentIndex = 0;
        this.updateFocus();
        break;

      case 'End':
        event.preventDefault();
        this.currentIndex = focusableItems.length - 1;
        this.updateFocus();
        break;
    }
  }

  /**
   * 첫 번째 아이템에 포커스
   */
  focusFirstItem() {
    const focusableItems = this.items.filter(item => !item.options.disabled);
    if (focusableItems.length > 0) {
      this.currentIndex = 0;
      this.updateFocus();
    }
  }

  /**
   * 포커스 업데이트
   */
  updateFocus() {
    const focusableItems = this.items.filter(item => !item.options.disabled);

    // 모든 아이템의 포커스 제거
    this.items.forEach(item => {
      item.element.classList.remove('bg-accent', 'text-accent-foreground');
      item.element.setAttribute('aria-selected', 'false');
    });

    // 현재 아이템에 포커스
    if (this.currentIndex >= 0 && focusableItems[this.currentIndex]) {
      const currentItem = focusableItems[this.currentIndex];
      currentItem.element.classList.add('bg-accent', 'text-accent-foreground');
      currentItem.element.setAttribute('aria-selected', 'true');
      currentItem.element.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 정리
   */
  destroy() {
    this.close();
    document.removeEventListener('click', this.boundOutsideClick);
    document.removeEventListener('keydown', this.boundKeyDown);

    if (this.content && this.content.parentNode) {
      this.content.parentNode.removeChild(this.content);
    }

    this.subMenus.forEach(submenu => submenu.destroy());
    this.subMenus.clear();
  }
}

/**
 * Dropdown Menu Item 클래스
 */
class DropdownMenuItem {
  constructor(options = {}, dropdownInstance) {
    this.options = {
      text: '',
      icon: null,
      shortcut: null,
      disabled: false,
      type: 'item', // item, checkbox, radio
      checked: false,
      value: null,
      onClick: null,
      className: '',
      ...options
    };

    this.dropdown = dropdownInstance;
    this.element = null;

    this.createElement();
  }

  /**
   * 아이템 요소 생성
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = cn(
      'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      this.options.className
    );

    this.element.setAttribute('role', 'menuitem');
    this.element.setAttribute('tabindex', '-1');

    if (this.options.disabled) {
      this.element.setAttribute('data-disabled', 'true');
    }

    // 아이콘
    if (this.options.icon) {
      const iconElement = document.createElement('span');
      iconElement.className = 'mr-2 h-4 w-4 flex-shrink-0';

      if (typeof this.options.icon === 'string') {
        iconElement.innerHTML = this.options.icon;
      } else if (this.options.icon instanceof HTMLElement) {
        iconElement.appendChild(this.options.icon);
      }

      this.element.appendChild(iconElement);
    }

    // 체크박스/라디오 아이콘
    if (this.options.type === 'checkbox' || this.options.type === 'radio') {
      const checkIcon = document.createElement('span');
      checkIcon.className = 'mr-2 h-4 w-4 flex-shrink-0';

      if (this.options.checked) {
        if (this.options.type === 'checkbox') {
          checkIcon.innerHTML = '<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>';
        } else {
          checkIcon.innerHTML = '<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"></circle></svg>';
        }
      }

      this.element.appendChild(checkIcon);
    }

    // 텍스트
    const textElement = document.createElement('span');
    textElement.className = 'flex-1';
    textElement.textContent = this.options.text;
    this.element.appendChild(textElement);

    // 단축키
    if (this.options.shortcut) {
      const shortcutElement = document.createElement('span');
      shortcutElement.className = 'ml-auto text-xs tracking-widest opacity-60';
      shortcutElement.textContent = this.options.shortcut;
      this.element.appendChild(shortcutElement);
    }

    // 클릭 이벤트
    this.element.addEventListener('click', this.handleClick.bind(this));
  }

  /**
   * 클릭 핸들러
   * @param {Event} event
   */
  handleClick(event) {
    if (this.options.disabled) return;

    event.preventDefault();
    event.stopPropagation();

    // 체크박스/라디오 상태 변경
    if (this.options.type === 'checkbox') {
      this.options.checked = !this.options.checked;
      this.updateCheckState();
    } else if (this.options.type === 'radio') {
      // 같은 그룹의 다른 라디오 버튼 해제
      if (this.dropdown) {
        this.dropdown.items.forEach(item => {
          if (item.options.type === 'radio' && item.options.value !== this.options.value) {
            item.options.checked = false;
            item.updateCheckState();
          }
        });
      }
      this.options.checked = true;
      this.updateCheckState();
    }

    // 콜백 실행
    if (this.options.onClick) {
      this.options.onClick({
        value: this.options.value,
        checked: this.options.checked,
        type: this.options.type
      });
    }

    // 드롭다운 닫기 (옵션에 따라)
    if (this.dropdown && this.dropdown.options.closeOnSelect) {
      this.dropdown.close();
    }
  }

  /**
   * 체크 상태 업데이트
   */
  updateCheckState() {
    const checkIcon = this.element.querySelector('.mr-2');
    if (!checkIcon) return;

    if (this.options.checked) {
      if (this.options.type === 'checkbox') {
        checkIcon.innerHTML = '<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>';
      } else {
        checkIcon.innerHTML = '<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"></circle></svg>';
      }
    } else {
      checkIcon.innerHTML = '';
    }
  }

  /**
   * 클릭 (프로그래밍 방식)
   */
  click() {
    this.handleClick({ preventDefault: () => {}, stopPropagation: () => {} });
  }

  /**
   * 정적 메서드: 아이템 생성
   * @param {Object} options
   * @param {DropdownMenu} dropdownInstance
   * @returns {DropdownMenuItem}
   */
  static create(options, dropdownInstance) {
    return new DropdownMenuItem(options, dropdownInstance);
  }
}

/**
 * Dropdown Menu Label 클래스
 */
class DropdownMenuLabel {
  /**
   * 라벨 생성
   * @param {string} text - 라벨 텍스트
   * @param {Object} options - 옵션
   * @returns {HTMLElement}
   */
  static create(text, options = {}) {
    const { className = '' } = options;

    const label = document.createElement('div');
    label.className = cn(
      'px-2 py-1.5 text-sm font-semibold text-foreground',
      className
    );
    label.textContent = text;

    return label;
  }
}

/**
 * Dropdown Menu Separator 클래스
 */
class DropdownMenuSeparator {
  /**
   * 구분자 생성
   * @param {Object} options - 옵션
   * @returns {HTMLElement}
   */
  static create(options = {}) {
    const { className = '' } = options;

    const separator = document.createElement('div');
    separator.className = cn(
      '-mx-1 my-1 h-px bg-muted',
      className
    );

    return separator;
  }
}

/**
 * Dropdown Sub Menu 클래스
 */
class DropdownSubMenu {
  constructor(options = {}, parentDropdown) {
    this.options = {
      label: '',
      icon: null,
      className: '',
      ...options
    };

    this.id = `submenu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.parent = parentDropdown;
    this.element = null;
    this.content = null;
    this.items = [];
    this.isOpen = false;

    this.createElement();
  }

  /**
   * 서브메뉴 요소 생성
   */
  createElement() {
    // 트리거 요소
    this.element = document.createElement('div');
    this.element.className = cn(
      'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      this.options.className
    );

    this.element.setAttribute('role', 'menuitem');
    this.element.setAttribute('aria-haspopup', 'menu');
    this.element.setAttribute('aria-expanded', 'false');

    // 아이콘
    if (this.options.icon) {
      const iconElement = document.createElement('span');
      iconElement.className = 'mr-2 h-4 w-4 flex-shrink-0';

      if (typeof this.options.icon === 'string') {
        iconElement.innerHTML = this.options.icon;
      } else if (this.options.icon instanceof HTMLElement) {
        iconElement.appendChild(this.options.icon);
      }

      this.element.appendChild(iconElement);
    }

    // 라벨
    const labelElement = document.createElement('span');
    labelElement.className = 'flex-1';
    labelElement.textContent = this.options.label;
    this.element.appendChild(labelElement);

    // 화살표 아이콘
    const arrowElement = document.createElement('span');
    arrowElement.className = 'ml-auto h-4 w-4';
    arrowElement.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>';
    this.element.appendChild(arrowElement);

    // 서브메뉴 콘텐츠
    this.createContent();

    // 이벤트 리스너
    this.element.addEventListener('mouseenter', () => this.open());
    this.element.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!this.content.matches(':hover')) {
          this.close();
        }
      }, 100);
    });
  }

  /**
   * 서브메뉴 콘텐츠 생성
   */
  createContent() {
    this.content = document.createElement('div');
    this.content.className = cn(
      'absolute left-full top-0 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
    );

    this.content.setAttribute('role', 'menu');
    this.content.setAttribute('data-state', 'closed');
    this.content.style.display = 'none';

    this.content.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!this.element.matches(':hover')) {
          this.close();
        }
      }, 100);
    });

    document.body.appendChild(this.content);
  }

  /**
   * 서브메뉴 아이템 추가
   * @param {Object} itemOptions
   * @returns {HTMLElement}
   */
  addItem(itemOptions) {
    const item = DropdownMenuItem.create(itemOptions, this.parent);
    this.content.appendChild(item.element);
    this.items.push(item);
    return item.element;
  }

  /**
   * 서브메뉴 열기
   */
  open() {
    if (this.isOpen) return;

    this.isOpen = true;
    this.content.style.display = 'block';
    this.content.setAttribute('data-state', 'open');
    this.element.setAttribute('aria-expanded', 'true');

    this.positionContent();
  }

  /**
   * 서브메뉴 닫기
   */
  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.content.setAttribute('data-state', 'closed');
    this.element.setAttribute('aria-expanded', 'false');

    setTimeout(() => {
      this.content.style.display = 'none';
    }, 150);
  }

  /**
   * 서브메뉴 위치 조정
   */
  positionContent() {
    const elementRect = this.element.getBoundingClientRect();
    const contentRect = this.content.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let left = elementRect.right;
    let top = elementRect.top;

    // 오른쪽 공간이 부족하면 왼쪽에 표시
    if (left + contentRect.width > viewportWidth) {
      left = elementRect.left - contentRect.width;
    }

    this.content.style.left = `${left}px`;
    this.content.style.top = `${top}px`;
  }

  /**
   * 정리
   */
  destroy() {
    this.close();
    if (this.content && this.content.parentNode) {
      this.content.parentNode.removeChild(this.content);
    }
  }
}

/**
 * 편의 함수들
 */
const DropdownHelpers = {
  /**
   * 간단한 드롭다운 생성
   * @param {HTMLElement|string} trigger
   * @param {Array} items
   * @param {Object} options
   * @returns {DropdownMenu}
   */
  create(trigger, items = [], options = {}) {
    const dropdown = new DropdownMenu(trigger, options);

    items.forEach(item => {
      if (item.type === 'separator') {
        dropdown.addSeparator(item);
      } else if (item.type === 'label') {
        dropdown.addLabel(item.text, item);
      } else if (item.type === 'submenu') {
        const submenu = dropdown.addSubMenu(item);
        if (item.items) {
          item.items.forEach(subItem => {
            submenu.addItem(subItem);
          });
        }
      } else {
        dropdown.addItem(item);
      }
    });

    return dropdown;
  },

  /**
   * 컨텍스트 메뉴 생성
   * @param {HTMLElement|string} target
   * @param {Array} items
   * @param {Object} options
   * @returns {DropdownMenu}
   */
  createContextMenu(target, items = [], options = {}) {
    const targetElement = typeof target === 'string' ? document.querySelector(target) : target;

    if (!targetElement) {
      throw new Error('Context menu target element not found');
    }

    // 숨겨진 트리거 생성
    const hiddenTrigger = document.createElement('div');
    hiddenTrigger.style.display = 'none';
    document.body.appendChild(hiddenTrigger);

    const dropdown = new DropdownMenu(hiddenTrigger, {
      closeOnOutsideClick: true,
      closeOnEscape: true,
      ...options
    });

    // 컨텍스트 메뉴 이벤트
    targetElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // 위치 설정을 위해 임시로 트리거 위치 조정
      hiddenTrigger.style.position = 'fixed';
      hiddenTrigger.style.left = `${e.clientX}px`;
      hiddenTrigger.style.top = `${e.clientY}px`;
      hiddenTrigger.style.display = 'block';

      dropdown.open();

      hiddenTrigger.style.display = 'none';
    });

    // 아이템 추가
    items.forEach(item => {
      if (item.type === 'separator') {
        dropdown.addSeparator(item);
      } else if (item.type === 'label') {
        dropdown.addLabel(item.text, item);
      } else {
        dropdown.addItem(item);
      }
    });

    return dropdown;
  }
};

export { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownSubMenu, DropdownHelpers };
export default DropdownMenu;