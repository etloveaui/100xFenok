/**
 * Shadcn UI Components - 바닐라 JavaScript 통합 인덱스
 *
 * 모든 UI 컴포넌트를 한 곳에서 임포트할 수 있는 통합 인덱스 파일
 * 사용법: import { Button, Card, Modal } from './components/ui/index.js';
 */

// Phase 1 - 기본 컴포넌트
export { Button, ButtonHelpers } from './button.js';
export { Card, CardHelpers } from './card.js';
export { Modal, ModalHelpers } from './modal.js';
export { Input, InputHelpers, FormField, FormFieldHelpers } from './input.js';

// Phase 2 - 확장 컴포넌트
export { Toast, ToastContainer, ToastHelpers } from './toast.js';
export { DropdownMenu, DropdownHelpers } from './dropdown.js';
export { Tabs, TabsHelpers } from './tabs.js';
export { Badge, BadgeHelpers, badgeVariants } from './badge.js';
export { Progress, ProgressHelpers } from './progress.js';
export { Tooltip, TooltipHelpers } from './tooltip.js';
export { Switch, SwitchHelpers } from './switch.js';

/**
 * 컴포넌트 네임스페이스 구성
 * 더 명확한 임포트를 위한 네임스페이스 패턴
 */
export const UI = {
  // 기본 컴포넌트
  Button,
  Card,
  Modal,
  Input,
  FormField,

  // 확장 컴포넌트
  Toast,
  ToastContainer,
  DropdownMenu,
  Tabs,
  Badge,
  Progress,
  Tooltip,
  Switch
};

/**
 * 헬퍼 함수들 네임스페이스
 */
export const Helpers = {
  Button: ButtonHelpers,
  Card: CardHelpers,
  Modal: ModalHelpers,
  Input: InputHelpers,
  FormField: FormFieldHelpers,
  Toast: ToastHelpers,
  Dropdown: DropdownHelpers,
  Tabs: TabsHelpers,
  Badge: BadgeHelpers,
  Progress: ProgressHelpers,
  Tooltip: TooltipHelpers,
  Switch: SwitchHelpers
};

/**
 * 유틸리티 함수들
 */
export { cn, cva, clsx, twMerge, Slot } from '../core/utils.js';

/**
 * 전역 초기화 함수
 * 모든 컴포넌트의 전역 설정을 한 번에 처리
 */
export function initializeUIComponents(config = {}) {
  const defaultConfig = {
    theme: 'light',
    toastPosition: 'top-right',
    modalCloseOnBackdrop: true,
    tooltipDelay: 200,
    dropdownCloseOnSelect: true,
    ...config
  };

  // 테마 설정
  if (defaultConfig.theme === 'dark') {
    document.documentElement.classList.add('dark');
  }

  // Toast 컨테이너 전역 설정
  if (window.ToastContainer) {
    window.ToastContainer.setGlobalDefaults({
      position: defaultConfig.toastPosition,
      duration: defaultConfig.toastDuration || 4000
    });
  }

  // 전역 설정을 데이터 속성으로 저장
  document.documentElement.setAttribute('data-ui-theme', defaultConfig.theme);
  document.documentElement.setAttribute('data-ui-initialized', 'true');

  return defaultConfig;
}

/**
 * 빠른 컴포넌트 생성 함수들
 * 자주 사용되는 패턴들을 쉽게 생성할 수 있는 헬퍼 함수들
 */
export const QuickCreate = {
  /**
   * 빠른 버튼 생성
   */
  button: (text, options = {}) => Button.create({ text, ...options }),

  /**
   * 빠른 카드 생성
   */
  card: (options = {}) => Card.createComplete(options),

  /**
   * 빠른 모달 생성
   */
  modal: (options = {}) => Modal.create(options),

  /**
   * 빠른 토스트 알림
   */
  toast: (message, type = 'default') => Toast.show(message, { variant: type }),

  /**
   * 빠른 드롭다운 메뉴 생성
   */
  dropdown: (trigger, items) => DropdownMenu.create({ trigger, items }),

  /**
   * 빠른 탭 생성
   */
  tabs: (container, tabs) => Tabs.create({ container, tabs }),

  /**
   * 빠른 배지 생성
   */
  badge: (text, variant = 'default') => Badge.create({ text, variant }),

  /**
   * 빠른 프로그레스 바 생성
   */
  progress: (container, value = 0) => Progress.create({ container, value }),

  /**
   * 빠른 툴팁 생성
   */
  tooltip: (element, content) => new Tooltip(element, { content }),

  /**
   * 빠른 스위치 생성
   */
  switch: (container, options = {}) => Switch.create({ container, ...options })
};

/**
 * 전역 CSS 클래스 및 테마
 */
export const Theme = {
  colors: {
    primary: 'hsl(221.2 83.2% 53.3%)',
    secondary: 'hsl(210 40% 96%)',
    destructive: 'hsl(0 84.2% 60.2%)',
    muted: 'hsl(210 40% 96%)',
    accent: 'hsl(210 40% 96%)',
    popover: 'hsl(0 0% 100%)',
    card: 'hsl(0 0% 100%)'
  },

  darkColors: {
    primary: 'hsl(217.2 91.2% 59.8%)',
    secondary: 'hsl(217.2 32.6% 17.5%)',
    destructive: 'hsl(0 62.8% 30.6%)',
    muted: 'hsl(217.2 32.6% 17.5%)',
    accent: 'hsl(217.2 32.6% 17.5%)',
    popover: 'hsl(222.2 84% 4.9%)',
    card: 'hsl(222.2 84% 4.9%)'
  },

  /**
   * 테마 전환
   */
  toggle: () => {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('ui-theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('ui-theme', 'dark');
    }
  },

  /**
   * 테마 설정
   */
  set: (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('ui-theme', theme);
  },

  /**
   * 저장된 테마 로드
   */
  load: () => {
    const savedTheme = localStorage.getItem('ui-theme') || 'light';
    Theme.set(savedTheme);
    return savedTheme;
  }
};

/**
 * 컴포넌트 레지스트리
 * 동적으로 컴포넌트를 등록하고 관리
 */
export const ComponentRegistry = {
  components: new Map(),

  /**
   * 컴포넌트 등록
   */
  register: (name, component) => {
    ComponentRegistry.components.set(name, component);
  },

  /**
   * 컴포넌트 가져오기
   */
  get: (name) => {
    return ComponentRegistry.components.get(name);
  },

  /**
   * 모든 컴포넌트 목록
   */
  list: () => {
    return Array.from(ComponentRegistry.components.keys());
  },

  /**
   * 컴포넌트 제거
   */
  unregister: (name) => {
    return ComponentRegistry.components.delete(name);
  }
};

// 기본 컴포넌트들 자동 등록
ComponentRegistry.register('Button', Button);
ComponentRegistry.register('Card', Card);
ComponentRegistry.register('Modal', Modal);
ComponentRegistry.register('Input', Input);
ComponentRegistry.register('Toast', Toast);
ComponentRegistry.register('DropdownMenu', DropdownMenu);
ComponentRegistry.register('Tabs', Tabs);
ComponentRegistry.register('Badge', Badge);
ComponentRegistry.register('Progress', Progress);
ComponentRegistry.register('Tooltip', Tooltip);
ComponentRegistry.register('Switch', Switch);

/**
 * 전역 이벤트 시스템
 */
export const UIEvents = {
  listeners: new Map(),

  /**
   * 이벤트 리스너 등록
   */
  on: (event, callback) => {
    if (!UIEvents.listeners.has(event)) {
      UIEvents.listeners.set(event, []);
    }
    UIEvents.listeners.get(event).push(callback);
  },

  /**
   * 이벤트 발생
   */
  emit: (event, data) => {
    const callbacks = UIEvents.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  },

  /**
   * 이벤트 리스너 제거
   */
  off: (event, callback) => {
    const callbacks = UIEvents.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
};

/**
 * 자동 초기화 (선택적)
 * 페이지 로드 시 자동으로 UI 시스템 초기화
 */
if (typeof window !== 'undefined') {
  // DOM이 로드되면 자동 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // 저장된 테마 로드
      Theme.load();

      // UI 초기화 이벤트 발생
      UIEvents.emit('ui:initialized', {
        components: ComponentRegistry.list(),
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
      });
    });
  } else {
    // 이미 로드된 경우 즉시 실행
    Theme.load();
    UIEvents.emit('ui:initialized', {
      components: ComponentRegistry.list(),
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    });
  }
}

// 기본 내보내기
export default {
  UI,
  Helpers,
  QuickCreate,
  Theme,
  ComponentRegistry,
  UIEvents,
  initializeUIComponents
};