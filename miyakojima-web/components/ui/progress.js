import { cn } from '../core/utils.js';

/**
 * Progress Component System (바닐라 JS 변환 - Shadcn Progress 기반)
 *
 * Shadcn Progress 컴포넌트를 바닐라 JavaScript로 변환
 * - 프로그레스 바 UI 및 애니메이션
 * - 값 기반 진행률 표시 (0-100)
 * - 다양한 스타일 및 크기 지원
 * - 접근성 지원 (ARIA 속성)
 * - 애니메이션 및 트랜지션 효과
 * - 원형/선형 프로그레스 바 지원
 */

class Progress {
  constructor(element, options = {}) {
    this.element = typeof element === 'string' ? document.querySelector(element) : element;

    if (!this.element) {
      throw new Error('Progress element not found');
    }

    this.options = {
      value: 0,
      max: 100,
      min: 0,
      variant: 'default', // default, secondary, destructive
      size: 'default', // default, sm, lg
      orientation: 'horizontal', // horizontal, vertical
      animated: true,
      showLabel: false,
      labelPosition: 'center', // center, start, end
      className: '',
      onValueChange: null,
      ...options
    };

    this.state = {
      value: Math.max(this.options.min, Math.min(this.options.max, this.options.value))
    };

    this.progressBar = null;
    this.label = null;

    this.init();
  }

  /**
   * 컴포넌트 초기화
   */
  init() {
    this.setupElement();
    this.updateProgress();
  }

  /**
   * 기본 요소 설정
   */
  setupElement() {
    // 프로그레스 컨테이너 스타일
    const baseClasses = this.getBaseClasses();
    this.element.className = cn(baseClasses, this.options.className);

    // ARIA 속성 설정
    this.element.setAttribute('role', 'progressbar');
    this.element.setAttribute('aria-valuemin', this.options.min);
    this.element.setAttribute('aria-valuemax', this.options.max);
    this.element.setAttribute('aria-valuenow', this.state.value);
    this.element.setAttribute('data-state', 'loading');
    this.element.setAttribute('data-value', this.state.value);
    this.element.setAttribute('data-max', this.options.max);

    // 프로그레스 바 생성
    this.createProgressBar();

    // 라벨 생성 (옵션)
    if (this.options.showLabel) {
      this.createLabel();
    }
  }

  /**
   * 기본 클래스 반환
   */
  getBaseClasses() {
    const sizeClasses = {
      sm: 'h-2',
      default: 'h-4',
      lg: 'h-6'
    };

    const orientationClasses = {
      horizontal: 'w-full',
      vertical: 'h-full w-4'
    };

    return cn(
      'relative overflow-hidden rounded-full bg-secondary',
      sizeClasses[this.options.size] || sizeClasses.default,
      orientationClasses[this.options.orientation] || orientationClasses.horizontal
    );
  }

  /**
   * 프로그레스 바 생성
   */
  createProgressBar() {
    this.progressBar = document.createElement('div');
    this.progressBar.className = this.getProgressBarClasses();
    this.progressBar.setAttribute('data-state', 'loading');

    this.element.appendChild(this.progressBar);
  }

  /**
   * 프로그레스 바 클래스 반환
   */
  getProgressBarClasses() {
    const variantClasses = {
      default: 'bg-primary',
      secondary: 'bg-secondary-foreground',
      destructive: 'bg-destructive'
    };

    const animationClasses = this.options.animated ?
      'transition-all duration-500 ease-in-out' : '';

    const orientationClasses = {
      horizontal: 'h-full w-full origin-left',
      vertical: 'w-full h-full origin-bottom'
    };

    return cn(
      'flex-1 transition-all',
      variantClasses[this.options.variant] || variantClasses.default,
      animationClasses,
      orientationClasses[this.options.orientation] || orientationClasses.horizontal
    );
  }

  /**
   * 라벨 생성
   */
  createLabel() {
    this.label = document.createElement('div');
    this.label.className = this.getLabelClasses();
    this.updateLabelText();

    this.element.appendChild(this.label);
  }

  /**
   * 라벨 클래스 반환
   */
  getLabelClasses() {
    const positionClasses = {
      center: 'absolute inset-0 flex items-center justify-center',
      start: 'absolute left-2 top-1/2 -translate-y-1/2',
      end: 'absolute right-2 top-1/2 -translate-y-1/2'
    };

    return cn(
      'text-xs font-medium text-primary-foreground z-10',
      positionClasses[this.options.labelPosition] || positionClasses.center
    );
  }

  /**
   * 라벨 텍스트 업데이트
   */
  updateLabelText() {
    if (this.label) {
      const percentage = this.getPercentage();
      this.label.textContent = `${Math.round(percentage)}%`;
    }
  }

  /**
   * 프로그레스 업데이트
   */
  updateProgress() {
    const percentage = this.getPercentage();

    // 프로그레스 바 스타일 업데이트
    if (this.progressBar) {
      if (this.options.orientation === 'horizontal') {
        this.progressBar.style.transform = `scaleX(${percentage / 100})`;
      } else {
        this.progressBar.style.transform = `scaleY(${percentage / 100})`;
      }
    }

    // ARIA 속성 업데이트
    this.element.setAttribute('aria-valuenow', this.state.value);
    this.element.setAttribute('data-value', this.state.value);

    // 상태 업데이트
    const state = percentage === 100 ? 'complete' : percentage === 0 ? 'loading' : 'loading';
    this.element.setAttribute('data-state', state);
    if (this.progressBar) {
      this.progressBar.setAttribute('data-state', state);
    }

    // 라벨 업데이트
    this.updateLabelText();

    // 콜백 실행
    if (this.options.onValueChange) {
      this.options.onValueChange(this.state.value, percentage);
    }
  }

  /**
   * 퍼센티지 계산
   */
  getPercentage() {
    const range = this.options.max - this.options.min;
    return range === 0 ? 0 : ((this.state.value - this.options.min) / range) * 100;
  }

  /**
   * 값 설정
   * @param {number} value
   */
  setValue(value) {
    const newValue = Math.max(this.options.min, Math.min(this.options.max, value));
    if (this.state.value !== newValue) {
      this.state.value = newValue;
      this.updateProgress();
    }
  }

  /**
   * 현재 값 반환
   * @returns {number}
   */
  getValue() {
    return this.state.value;
  }

  /**
   * 값 증가
   * @param {number} increment
   */
  increment(increment = 1) {
    this.setValue(this.state.value + increment);
  }

  /**
   * 값 감소
   * @param {number} decrement
   */
  decrement(decrement = 1) {
    this.setValue(this.state.value - decrement);
  }

  /**
   * 프로그레스 리셋
   */
  reset() {
    this.setValue(this.options.min);
  }

  /**
   * 프로그레스 완료
   */
  complete() {
    this.setValue(this.options.max);
  }

  /**
   * 애니메이션 시작
   * @param {number} targetValue
   * @param {number} duration
   */
  animateTo(targetValue, duration = 1000) {
    const startValue = this.state.value;
    const endValue = Math.max(this.options.min, Math.min(this.options.max, targetValue));
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 이징 함수 (ease-out)
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      const currentValue = startValue + (endValue - startValue) * easedProgress;
      this.setValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * 라벨 표시/숨김 토글
   */
  toggleLabel() {
    if (this.label) {
      this.label.remove();
      this.label = null;
      this.options.showLabel = false;
    } else {
      this.options.showLabel = true;
      this.createLabel();
    }
  }

  /**
   * variant 변경
   * @param {string} variant
   */
  setVariant(variant) {
    this.options.variant = variant;
    if (this.progressBar) {
      this.progressBar.className = this.getProgressBarClasses();
    }
  }

  /**
   * 정리
   */
  destroy() {
    if (this.progressBar) {
      this.progressBar.remove();
    }
    if (this.label) {
      this.label.remove();
    }
  }

  /**
   * 정적 메서드: 프로그레스 요소 생성
   * @param {Object} options
   * @returns {HTMLElement}
   */
  static create(options = {}) {
    const {
      container = null,
      className = '',
      id = null,
      ...progressOptions
    } = options;

    const element = document.createElement('div');
    if (id) element.id = id;

    // Progress 인스턴스 생성
    const progress = new Progress(element, progressOptions);

    // 컨테이너에 추가
    if (container) {
      const containerElement = typeof container === 'string' ?
        document.querySelector(container) : container;
      if (containerElement) {
        containerElement.appendChild(element);
      }
    }

    return progress;
  }
}

/**
 * Progress 헬퍼 함수들
 */
const ProgressHelpers = {
  /**
   * 원형 프로그레스 생성
   */
  createCircular(container, options = {}) {
    const { size = 100, strokeWidth = 8, ...otherOptions } = options;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.className = 'rotate-[-90deg]';

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    // 배경 원
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', size / 2);
    bgCircle.setAttribute('cy', size / 2);
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'currentColor');
    bgCircle.setAttribute('stroke-width', strokeWidth);
    bgCircle.className = 'text-secondary';

    // 프로그레스 원
    const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    progressCircle.setAttribute('cx', size / 2);
    progressCircle.setAttribute('cy', size / 2);
    progressCircle.setAttribute('r', radius);
    progressCircle.setAttribute('fill', 'none');
    progressCircle.setAttribute('stroke', 'currentColor');
    progressCircle.setAttribute('stroke-width', strokeWidth);
    progressCircle.setAttribute('stroke-linecap', 'round');
    progressCircle.setAttribute('stroke-dasharray', circumference);
    progressCircle.setAttribute('stroke-dashoffset', circumference);
    progressCircle.className = 'text-primary transition-all duration-500 ease-in-out';

    svg.appendChild(bgCircle);
    svg.appendChild(progressCircle);

    const containerElement = typeof container === 'string' ?
      document.querySelector(container) : container;
    if (containerElement) {
      containerElement.appendChild(svg);
    }

    return {
      setValue: (value) => {
        const percentage = Math.max(0, Math.min(100, value));
        const offset = circumference - (percentage / 100) * circumference;
        progressCircle.setAttribute('stroke-dashoffset', offset);
      },
      element: svg
    };
  },

  /**
   * 단계별 프로그레스 생성
   */
  createStepped(container, steps, options = {}) {
    const { currentStep = 1, className = '' } = options;

    const stepsContainer = document.createElement('div');
    stepsContainer.className = cn('flex items-center space-x-2', className);

    for (let i = 1; i <= steps; i++) {
      const step = document.createElement('div');
      step.className = cn(
        'h-2 flex-1 rounded-full transition-colors duration-300',
        i <= currentStep ? 'bg-primary' : 'bg-secondary'
      );
      step.setAttribute('data-step', i);

      stepsContainer.appendChild(step);
    }

    const containerElement = typeof container === 'string' ?
      document.querySelector(container) : container;
    if (containerElement) {
      containerElement.appendChild(stepsContainer);
    }

    return {
      setCurrentStep: (step) => {
        const stepElements = stepsContainer.querySelectorAll('[data-step]');
        stepElements.forEach((el, index) => {
          const stepNumber = index + 1;
          el.className = cn(
            'h-2 flex-1 rounded-full transition-colors duration-300',
            stepNumber <= step ? 'bg-primary' : 'bg-secondary'
          );
        });
      },
      element: stepsContainer
    };
  },

  /**
   * 로딩 프로그레스 생성
   */
  createLoading(container, options = {}) {
    const { indeterminate = true, ...otherOptions } = options;

    if (indeterminate) {
      const element = document.createElement('div');
      element.className = 'relative h-4 w-full overflow-hidden rounded-full bg-secondary';

      const bar = document.createElement('div');
      bar.className = 'h-full bg-primary animate-pulse';
      bar.style.animation = 'loading-slide 2s ease-in-out infinite';

      // CSS 애니메이션 추가
      if (!document.querySelector('#loading-animation-style')) {
        const style = document.createElement('style');
        style.id = 'loading-animation-style';
        style.textContent = `
          @keyframes loading-slide {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(100%); }
            100% { transform: translateX(100%); }
          }
        `;
        document.head.appendChild(style);
      }

      element.appendChild(bar);

      const containerElement = typeof container === 'string' ?
        document.querySelector(container) : container;
      if (containerElement) {
        containerElement.appendChild(element);
      }

      return { element };
    } else {
      return Progress.create({ container, ...otherOptions });
    }
  }
};

export { Progress, ProgressHelpers };
export default Progress;