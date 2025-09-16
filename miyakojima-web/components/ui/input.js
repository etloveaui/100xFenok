import { cn } from '../core/utils.js';

/**
 * Input Component System (바닐라 JS 변환 - Shadcn Input 기반)
 *
 * Shadcn Input 컴포넌트를 바닐라 JavaScript로 변환
 * - 다양한 input 타입 지원 (text, email, password, number 등)
 * - 상태 관리 (focus, disabled, error)
 * - 라벨 및 설명 통합
 * - 접근성 지원 (ARIA 속성)
 * - 유효성 검증 시스템
 * - 폼 필드 그룹화
 */

class Input {
  constructor(element, options = {}) {
    this.element = typeof element === 'string' ? document.querySelector(element) : element;

    if (!this.element) {
      throw new Error('Input element not found');
    }

    this.options = {
      type: 'text',
      className: '',
      placeholder: '',
      disabled: false,
      required: false,
      validation: null,
      onValidation: null,
      onChange: null,
      onFocus: null,
      onBlur: null,
      ...options
    };

    this.state = {
      value: this.element.value || '',
      isValid: true,
      isFocused: false,
      isDirty: false,
      errors: []
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
   * 기본 Input 요소 설정
   */
  setupElement() {
    // 기본 클래스 적용
    const baseClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

    this.element.className = cn(
      baseClasses,
      this.options.className
    );

    // 속성 설정
    if (this.options.type) {
      this.element.type = this.options.type;
    }

    if (this.options.placeholder) {
      this.element.placeholder = this.options.placeholder;
    }

    if (this.options.disabled) {
      this.element.disabled = true;
    }

    if (this.options.required) {
      this.element.required = true;
    }

    // ARIA 속성 설정
    if (this.options.required) {
      this.element.setAttribute('aria-required', 'true');
    }

    this.element.setAttribute('aria-invalid', 'false');
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    this.element.addEventListener('input', this.handleInput.bind(this));
    this.element.addEventListener('focus', this.handleFocus.bind(this));
    this.element.addEventListener('blur', this.handleBlur.bind(this));
  }

  /**
   * Input 이벤트 핸들러
   * @param {Event} event
   */
  handleInput(event) {
    const value = event.target.value;
    this.state.value = value;
    this.state.isDirty = true;

    // 유효성 검증
    if (this.options.validation) {
      this.validate(value);
    }

    // 콜백 실행
    if (this.options.onChange) {
      this.options.onChange(value, this.state);
    }
  }

  /**
   * Focus 이벤트 핸들러
   * @param {Event} event
   */
  handleFocus(event) {
    this.state.isFocused = true;
    this.updateClasses();

    if (this.options.onFocus) {
      this.options.onFocus(event, this.state);
    }
  }

  /**
   * Blur 이벤트 핸들러
   * @param {Event} event
   */
  handleBlur(event) {
    this.state.isFocused = false;
    this.updateClasses();

    // Blur 시 유효성 검증
    if (this.options.validation && this.state.isDirty) {
      this.validate(this.state.value);
    }

    if (this.options.onBlur) {
      this.options.onBlur(event, this.state);
    }
  }

  /**
   * 유효성 검증
   * @param {string} value
   */
  validate(value) {
    const errors = [];

    // 기본 required 검증
    if (this.options.required && !value.trim()) {
      errors.push('This field is required');
    }

    // 커스텀 검증
    if (this.options.validation) {
      if (typeof this.options.validation === 'function') {
        const result = this.options.validation(value);
        if (result !== true && result) {
          errors.push(result);
        }
      } else if (this.options.validation instanceof RegExp) {
        if (!this.options.validation.test(value) && value) {
          errors.push('Invalid format');
        }
      }
    }

    // 타입별 기본 검증
    if (value && this.element.type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        errors.push('Please enter a valid email address');
      }
    }

    this.state.errors = errors;
    this.state.isValid = errors.length === 0;

    // UI 업데이트
    this.updateValidationState();

    // 콜백 실행
    if (this.options.onValidation) {
      this.options.onValidation(this.state.isValid, errors, this.state);
    }

    return this.state.isValid;
  }

  /**
   * 유효성 검증 상태 UI 업데이트
   */
  updateValidationState() {
    if (this.state.isDirty) {
      if (this.state.isValid) {
        this.element.classList.remove('border-destructive');
        this.element.setAttribute('aria-invalid', 'false');
      } else {
        this.element.classList.add('border-destructive');
        this.element.setAttribute('aria-invalid', 'true');
      }
    }
  }

  /**
   * 클래스 업데이트
   */
  updateClasses() {
    // Focus 상태에 따른 클래스 업데이트는 CSS에서 처리됨
  }

  /**
   * 값 설정
   * @param {string} value
   */
  setValue(value) {
    this.element.value = value;
    this.state.value = value;

    // 유효성 검증
    if (this.options.validation) {
      this.validate(value);
    }
  }

  /**
   * 값 가져오기
   * @returns {string}
   */
  getValue() {
    return this.state.value;
  }

  /**
   * 유효성 상태 가져오기
   * @returns {boolean}
   */
  isValid() {
    return this.state.isValid;
  }

  /**
   * 오류 메시지 가져오기
   * @returns {string[]}
   */
  getErrors() {
    return this.state.errors;
  }

  /**
   * 포커스 설정
   */
  focus() {
    this.element.focus();
  }

  /**
   * 비활성화
   */
  disable() {
    this.element.disabled = true;
    this.options.disabled = true;
  }

  /**
   * 활성화
   */
  enable() {
    this.element.disabled = false;
    this.options.disabled = false;
  }

  /**
   * 정리
   */
  destroy() {
    this.element.removeEventListener('input', this.handleInput);
    this.element.removeEventListener('focus', this.handleFocus);
    this.element.removeEventListener('blur', this.handleBlur);
  }

  /**
   * 정적 메서드: 기본 Input 요소 생성
   * @param {Object} options - Input 옵션
   * @returns {HTMLInputElement}
   */
  static create(options = {}) {
    const {
      type = 'text',
      placeholder = '',
      className = '',
      id,
      name,
      value = '',
      required = false,
      disabled = false,
      ...otherOptions
    } = options;

    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    input.value = value;
    input.required = required;
    input.disabled = disabled;

    if (id) input.id = id;
    if (name) input.name = name;

    // 기본 스타일 적용
    const baseClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

    input.className = cn(baseClasses, className);

    // Input 인스턴스와 연결
    if (Object.keys(otherOptions).length > 0) {
      return new Input(input, otherOptions);
    }

    return input;
  }
}

/**
 * Form Field 컴포넌트
 * Input과 Label, Description, Message를 그룹화
 */
class FormField {
  constructor(options = {}) {
    this.options = {
      label: '',
      description: '',
      required: false,
      className: '',
      ...options
    };

    this.container = null;
    this.labelElement = null;
    this.inputWrapper = null;
    this.input = null;
    this.descriptionElement = null;
    this.messageElement = null;

    this.create();
  }

  /**
   * Form Field 생성
   */
  create() {
    // 컨테이너 생성
    this.container = document.createElement('div');
    this.container.className = cn('space-y-2', this.options.className);

    // 라벨 생성
    if (this.options.label) {
      this.labelElement = FormLabel.create(this.options.label, {
        required: this.options.required
      });
      this.container.appendChild(this.labelElement);
    }

    // Input 래퍼 생성
    this.inputWrapper = document.createElement('div');
    this.inputWrapper.className = 'relative';

    // Input 생성
    this.input = Input.create({
      ...this.options.input,
      required: this.options.required
    });

    this.inputWrapper.appendChild(this.input);
    this.container.appendChild(this.inputWrapper);

    // 설명 생성
    if (this.options.description) {
      this.descriptionElement = FormDescription.create(this.options.description);
      this.container.appendChild(this.descriptionElement);
    }

    // 메시지 요소 생성 (처음에는 숨김)
    this.messageElement = FormMessage.create();
    this.messageElement.style.display = 'none';
    this.container.appendChild(this.messageElement);

    // Input에 유효성 검증 콜백 설정
    if (this.input instanceof Input) {
      this.input.options.onValidation = (isValid, errors) => {
        this.updateMessage(isValid, errors);
      };
    }

    // 라벨과 Input 연결
    this.linkLabelToInput();
  }

  /**
   * 라벨과 Input 연결
   */
  linkLabelToInput() {
    if (this.labelElement && this.input) {
      const inputId = this.input.id || `input-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.input.id = inputId;
      this.labelElement.setAttribute('for', inputId);
    }
  }

  /**
   * 메시지 업데이트
   * @param {boolean} isValid
   * @param {string[]} errors
   */
  updateMessage(isValid, errors) {
    if (!isValid && errors.length > 0) {
      this.messageElement.textContent = errors[0];
      this.messageElement.style.display = 'block';
    } else {
      this.messageElement.style.display = 'none';
    }
  }

  /**
   * Form Field 요소 반환
   * @returns {HTMLElement}
   */
  getElement() {
    return this.container;
  }

  /**
   * Input 인스턴스 반환
   * @returns {Input|HTMLInputElement}
   */
  getInput() {
    return this.input;
  }
}

/**
 * Form Label 컴포넌트
 */
class FormLabel {
  /**
   * Label 생성
   * @param {string} text - 라벨 텍스트
   * @param {Object} options - 라벨 옵션
   * @returns {HTMLLabelElement}
   */
  static create(text, options = {}) {
    const { required = false, className = '' } = options;

    const label = document.createElement('label');
    label.className = cn(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    );

    label.innerHTML = text + (required ? ' <span class="text-destructive">*</span>' : '');

    return label;
  }
}

/**
 * Form Description 컴포넌트
 */
class FormDescription {
  /**
   * Description 생성
   * @param {string} text - 설명 텍스트
   * @param {Object} options - 설명 옵션
   * @returns {HTMLParagraphElement}
   */
  static create(text, options = {}) {
    const { className = '' } = options;

    const description = document.createElement('p');
    description.className = cn('text-sm text-muted-foreground', className);
    description.textContent = text;

    return description;
  }
}

/**
 * Form Message 컴포넌트
 */
class FormMessage {
  /**
   * Message 생성
   * @param {string} text - 메시지 텍스트
   * @param {Object} options - 메시지 옵션
   * @returns {HTMLParagraphElement}
   */
  static create(text = '', options = {}) {
    const { className = '', type = 'error' } = options;

    const message = document.createElement('p');
    const typeClasses = {
      error: 'text-destructive',
      success: 'text-green-600',
      warning: 'text-yellow-600',
      info: 'text-blue-600'
    };

    message.className = cn(
      'text-sm font-medium',
      typeClasses[type] || typeClasses.error,
      className
    );

    if (text) {
      message.textContent = text;
    }

    return message;
  }
}

/**
 * 일반적인 Input 유형들에 대한 헬퍼 함수들
 */
const InputHelpers = {
  /**
   * 이메일 Input 생성
   */
  createEmail(options = {}) {
    return Input.create({
      type: 'email',
      placeholder: 'Enter your email',
      validation: (value) => {
        if (!value) return true;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value) || 'Please enter a valid email address';
      },
      ...options
    });
  },

  /**
   * 비밀번호 Input 생성
   */
  createPassword(options = {}) {
    return Input.create({
      type: 'password',
      placeholder: 'Enter your password',
      validation: (value) => {
        if (!value) return true;
        if (value.length < 6) return 'Password must be at least 6 characters';
        return true;
      },
      ...options
    });
  },

  /**
   * 숫자 Input 생성
   */
  createNumber(options = {}) {
    const { min, max, step, ...otherOptions } = options;
    const input = Input.create({
      type: 'number',
      ...otherOptions
    });

    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;

    return input;
  },

  /**
   * 검색 Input 생성
   */
  createSearch(options = {}) {
    return Input.create({
      type: 'search',
      placeholder: 'Search...',
      ...options
    });
  },

  /**
   * 전화번호 Input 생성
   */
  createTel(options = {}) {
    return Input.create({
      type: 'tel',
      placeholder: 'Enter your phone number',
      validation: (value) => {
        if (!value) return true;
        const telRegex = /^[\+]?[\d\s\-\(\)]{10,}$/;
        return telRegex.test(value) || 'Please enter a valid phone number';
      },
      ...options
    });
  },

  /**
   * URL Input 생성
   */
  createUrl(options = {}) {
    return Input.create({
      type: 'url',
      placeholder: 'https://example.com',
      validation: (value) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
      ...options
    });
  }
};

export { Input, FormField, FormLabel, FormDescription, FormMessage, InputHelpers };
export default Input;