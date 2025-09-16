import { cn } from '../core/utils.js';

/**
 * Switch Component System (바닐라 JS 변환 - Shadcn Switch 기반)
 *
 * Shadcn Switch 컴포넌트를 바닐라 JavaScript로 변환
 * - 스위치 온/오프 토글 기능
 * - 다양한 크기 및 스타일 지원
 * - 접근성 지원 (ARIA 속성, 키보드 네비게이션)
 * - 애니메이션 및 트랜지션 효과
 * - 비활성화 상태 지원
 * - 폼 통합 및 값 관리
 */

class Switch {
  constructor(element, options = {}) {
    this.element = typeof element === 'string' ? document.querySelector(element) : element;

    if (!this.element) {
      throw new Error('Switch element not found');
    }

    this.options = {
      checked: false,
      disabled: false,
      size: 'default', // default, sm, lg
      variant: 'default', // default, destructive
      className: '',
      name: '',
      value: '',
      required: false,
      onChange: null,
      onCheckedChange: null,
      ...options
    };

    this.state = {
      checked: this.options.checked,
      disabled: this.options.disabled,
      focused: false
    };

    this.hiddenInput = null;
    this.thumb = null;

    this.init();
  }

  /**
   * 컴포넌트 초기화
   */
  init() {
    this.setupElement();
    this.createHiddenInput();
    this.createThumb();
    this.bindEvents();
    this.updateState();
  }

  /**
   * 기본 요소 설정
   */
  setupElement() {
    // 스위치 컨테이너 스타일
    const baseClasses = this.getBaseClasses();
    this.element.className = cn(baseClasses, this.options.className);

    // ARIA 속성 설정
    this.element.setAttribute('role', 'switch');
    this.element.setAttribute('aria-checked', this.state.checked);
    this.element.setAttribute('aria-disabled', this.state.disabled);
    this.element.setAttribute('tabindex', this.state.disabled ? '-1' : '0');

    // 데이터 속성
    this.element.setAttribute('data-state', this.state.checked ? 'checked' : 'unchecked');
    this.element.setAttribute('data-disabled', this.state.disabled);

    // ID 설정 (없으면 생성)
    if (!this.element.id) {
      this.element.id = `switch-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  /**
   * 기본 클래스 반환
   */
  getBaseClasses() {
    const sizeClasses = {
      sm: 'h-4 w-7',
      default: 'h-5 w-9',
      lg: 'h-6 w-11'
    };

    const variantClasses = {
      default: 'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      destructive: 'data-[state=checked]:bg-destructive data-[state=unchecked]:bg-input'
    };

    return cn(
      'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
      sizeClasses[this.options.size] || sizeClasses.default,
      variantClasses[this.options.variant] || variantClasses.default
    );
  }

  /**
   * 숨겨진 input 요소 생성 (폼 통합용)
   */
  createHiddenInput() {
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'checkbox';
    this.hiddenInput.style.display = 'none';
    this.hiddenInput.checked = this.state.checked;
    this.hiddenInput.disabled = this.state.disabled;

    if (this.options.name) {
      this.hiddenInput.name = this.options.name;
    }
    if (this.options.value) {
      this.hiddenInput.value = this.options.value;
    }
    if (this.options.required) {
      this.hiddenInput.required = this.options.required;
    }

    // 부모 요소에 추가 (폼 제출을 위해)
    if (this.element.parentNode) {
      this.element.parentNode.insertBefore(this.hiddenInput, this.element.nextSibling);
    }
  }

  /**
   * 스위치 썸(thumb) 생성
   */
  createThumb() {
    this.thumb = document.createElement('div');
    this.thumb.className = this.getThumbClasses();
    this.thumb.setAttribute('data-state', this.state.checked ? 'checked' : 'unchecked');

    this.element.appendChild(this.thumb);
  }

  /**
   * 썸 클래스 반환
   */
  getThumbClasses() {
    const sizeClasses = {
      sm: 'h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0',
      default: 'h-4 w-4 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      lg: 'h-5 w-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0'
    };

    return cn(
      'pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform',
      sizeClasses[this.options.size] || sizeClasses.default
    );
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    // 클릭 이벤트
    this.element.addEventListener('click', this.handleClick.bind(this));

    // 키보드 이벤트
    this.element.addEventListener('keydown', this.handleKeydown.bind(this));

    // 포커스 이벤트
    this.element.addEventListener('focus', this.handleFocus.bind(this));
    this.element.addEventListener('blur', this.handleBlur.bind(this));
  }

  /**
   * 클릭 이벤트 핸들러
   * @param {Event} event
   */
  handleClick(event) {
    event.preventDefault();
    if (!this.state.disabled) {
      this.toggle();
    }
  }

  /**
   * 키보드 이벤트 핸들러
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    if (this.state.disabled) return;

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.toggle();
    }
  }

  /**
   * 포커스 이벤트 핸들러
   */
  handleFocus() {
    this.state.focused = true;
    this.element.setAttribute('data-focused', 'true');
  }

  /**
   * 블러 이벤트 핸들러
   */
  handleBlur() {
    this.state.focused = false;
    this.element.removeAttribute('data-focused');
  }

  /**
   * 스위치 토글
   */
  toggle() {
    this.setChecked(!this.state.checked);
  }

  /**
   * 체크 상태 설정
   * @param {boolean} checked
   */
  setChecked(checked) {
    if (this.state.disabled || this.state.checked === checked) return;

    const oldValue = this.state.checked;
    this.state.checked = checked;

    this.updateState();

    // 콜백 실행
    if (this.options.onChange) {
      this.options.onChange(checked, oldValue);
    }
    if (this.options.onCheckedChange) {
      this.options.onCheckedChange(checked);
    }

    // 커스텀 이벤트 발생
    const changeEvent = new CustomEvent('switch:change', {
      detail: { checked, oldValue }
    });
    this.element.dispatchEvent(changeEvent);
  }

  /**
   * 비활성화 상태 설정
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this.state.disabled = disabled;
    this.updateState();
  }

  /**
   * 현재 체크 상태 반환
   * @returns {boolean}
   */
  isChecked() {
    return this.state.checked;
  }

  /**
   * 현재 비활성화 상태 반환
   * @returns {boolean}
   */
  isDisabled() {
    return this.state.disabled;
  }

  /**
   * 상태 업데이트
   */
  updateState() {
    // 요소 속성 업데이트
    this.element.setAttribute('aria-checked', this.state.checked);
    this.element.setAttribute('aria-disabled', this.state.disabled);
    this.element.setAttribute('data-state', this.state.checked ? 'checked' : 'unchecked');
    this.element.setAttribute('data-disabled', this.state.disabled);
    this.element.setAttribute('tabindex', this.state.disabled ? '-1' : '0');

    // 썸 상태 업데이트
    if (this.thumb) {
      this.thumb.setAttribute('data-state', this.state.checked ? 'checked' : 'unchecked');
    }

    // 숨겨진 입력 요소 업데이트
    if (this.hiddenInput) {
      this.hiddenInput.checked = this.state.checked;
      this.hiddenInput.disabled = this.state.disabled;
    }

    // 스타일 클래스 업데이트
    if (this.state.disabled) {
      this.element.style.opacity = '0.5';
      this.element.style.cursor = 'not-allowed';
    } else {
      this.element.style.opacity = '';
      this.element.style.cursor = 'pointer';
    }
  }

  /**
   * 레이블과 연결
   * @param {HTMLElement|string} label
   */
  connectLabel(label) {
    const labelElement = typeof label === 'string' ? document.querySelector(label) : label;

    if (labelElement) {
      labelElement.setAttribute('for', this.element.id);
      labelElement.addEventListener('click', () => {
        if (!this.state.disabled) {
          this.toggle();
        }
      });
    }
  }

  /**
   * 폼 유효성 검사
   * @returns {boolean}
   */
  checkValidity() {
    if (this.hiddenInput) {
      return this.hiddenInput.checkValidity();
    }
    return true;
  }

  /**
   * 폼 리셋
   */
  reset() {
    this.setChecked(this.options.checked);
  }

  /**
   * 정리
   */
  destroy() {
    // 이벤트 리스너 제거
    this.element.removeEventListener('click', this.handleClick);
    this.element.removeEventListener('keydown', this.handleKeydown);
    this.element.removeEventListener('focus', this.handleFocus);
    this.element.removeEventListener('blur', this.handleBlur);

    // 숨겨진 입력 요소 제거
    if (this.hiddenInput && this.hiddenInput.parentNode) {
      this.hiddenInput.parentNode.removeChild(this.hiddenInput);
    }

    // 썸 제거
    if (this.thumb) {
      this.thumb.remove();
    }
  }

  /**
   * 정적 메서드: 스위치 요소 생성
   * @param {Object} options
   * @returns {HTMLElement}
   */
  static create(options = {}) {
    const {
      container = null,
      className = '',
      id = null,
      label = null,
      ...switchOptions
    } = options;

    const element = document.createElement('div');
    if (id) element.id = id;

    // Switch 인스턴스 생성
    const switchInstance = new Switch(element, switchOptions);

    // 컨테이너에 추가
    if (container) {
      const containerElement = typeof container === 'string' ?
        document.querySelector(container) : container;
      if (containerElement) {
        containerElement.appendChild(element);
      }
    }

    // 레이블 연결
    if (label) {
      switchInstance.connectLabel(label);
    }

    return switchInstance;
  }
}

/**
 * Switch 헬퍼 함수들
 */
const SwitchHelpers = {
  /**
   * 레이블과 함께 스위치 생성
   */
  createWithLabel(container, labelText, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center space-x-2';

    const switchInstance = Switch.create({
      ...options,
      container: wrapper
    });

    const label = document.createElement('label');
    label.textContent = labelText;
    label.className = 'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70';

    wrapper.appendChild(label);
    switchInstance.connectLabel(label);

    const containerElement = typeof container === 'string' ?
      document.querySelector(container) : container;
    if (containerElement) {
      containerElement.appendChild(wrapper);
    }

    return { switchInstance, wrapper, label };
  },

  /**
   * 설정 스위치 생성
   */
  createSettingSwitch(container, setting, options = {}) {
    const { title, description, ...switchOptions } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center justify-between';

    const textContainer = document.createElement('div');
    textContainer.className = 'space-y-0.5';

    const titleElement = document.createElement('label');
    titleElement.textContent = title || setting;
    titleElement.className = 'text-base font-medium';

    if (description) {
      const descElement = document.createElement('div');
      descElement.textContent = description;
      descElement.className = 'text-[0.8rem] text-muted-foreground';
      textContainer.appendChild(titleElement);
      textContainer.appendChild(descElement);
    } else {
      textContainer.appendChild(titleElement);
    }

    const switchInstance = Switch.create({
      ...switchOptions,
      container: wrapper
    });

    wrapper.appendChild(textContainer);
    switchInstance.connectLabel(titleElement);

    const containerElement = typeof container === 'string' ?
      document.querySelector(container) : container;
    if (containerElement) {
      containerElement.appendChild(wrapper);
    }

    return { switchInstance, wrapper, titleElement };
  },

  /**
   * 테마 토글 스위치 생성
   */
  createThemeToggle(container, options = {}) {
    const switchInstance = Switch.create({
      checked: document.documentElement.classList.contains('dark'),
      onCheckedChange: (checked) => {
        if (checked) {
          document.documentElement.classList.add('dark');
          localStorage.setItem('theme', 'dark');
        } else {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('theme', 'light');
        }
      },
      ...options,
      container
    });

    return switchInstance;
  },

  /**
   * 폼 필드 스위치 생성
   */
  createFormField(container, fieldName, options = {}) {
    const { label, description, required = false, ...switchOptions } = options;

    const fieldWrapper = document.createElement('div');
    fieldWrapper.className = 'space-y-2';

    const switchInstance = Switch.create({
      name: fieldName,
      required,
      ...switchOptions,
      container: fieldWrapper
    });

    if (label) {
      const labelElement = document.createElement('label');
      labelElement.textContent = label;
      labelElement.className = 'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70';
      fieldWrapper.insertBefore(labelElement, switchInstance.element);
      switchInstance.connectLabel(labelElement);
    }

    if (description) {
      const descElement = document.createElement('div');
      descElement.textContent = description;
      descElement.className = 'text-[0.8rem] text-muted-foreground';
      fieldWrapper.appendChild(descElement);
    }

    const containerElement = typeof container === 'string' ?
      document.querySelector(container) : container;
    if (containerElement) {
      containerElement.appendChild(fieldWrapper);
    }

    return { switchInstance, fieldWrapper };
  }
};

export { Switch, SwitchHelpers };
export default Switch;