# Shadcn UI Components - 바닐라 JavaScript 버전

Shadcn/UI 컴포넌트 라이브러리를 바닐라 JavaScript로 변환한 완전한 UI 컴포넌트 시스템입니다.

## 📦 설치 및 설정

### 1. CSS 파일 포함

```html
<link rel="stylesheet" href="./components/ui/styles.css">
```

### 2. JavaScript 모듈 임포트

```javascript
// 개별 컴포넌트 임포트
import { Button, Card, Modal } from './components/ui/index.js';

// 전체 UI 시스템 임포트
import UI from './components/ui/index.js';

// 네임스페이스 사용
import { UI, Helpers, QuickCreate, Theme } from './components/ui/index.js';
```

### 3. 초기화

```javascript
// 자동 초기화 (권장)
// DOM 로드 시 자동으로 초기화됩니다.

// 수동 초기화
import { initializeUIComponents } from './components/ui/index.js';

initializeUIComponents({
  theme: 'light', // 또는 'dark'
  toastPosition: 'top-right',
  modalCloseOnBackdrop: true
});
```

## 🎨 테마 시스템

### 테마 전환

```javascript
import { Theme } from './components/ui/index.js';

// 테마 토글
Theme.toggle();

// 특정 테마 설정
Theme.set('dark');
Theme.set('light');

// 저장된 테마 로드
Theme.load();
```

## 📚 컴포넌트 사용법

### Button 컴포넌트

```javascript
import { Button } from './components/ui/index.js';

// 기본 버튼
const button = new Button('#my-button', {
  variant: 'default', // default, destructive, outline, secondary, ghost, link
  size: 'default',    // default, sm, lg, icon
  text: 'Click me'
});

// 정적 메서드로 생성
const quickButton = Button.create({
  text: 'Quick Button',
  variant: 'primary',
  onClick: () => console.log('Clicked!')
});

// 헬퍼 함수 사용
import { QuickCreate } from './components/ui/index.js';
const helperButton = QuickCreate.button('Helper Button', { variant: 'outline' });
```

### Card 컴포넌트

```javascript
import { Card } from './components/ui/index.js';

// 완전한 카드 생성
const card = Card.createComplete({
  title: '카드 제목',
  description: '카드 설명',
  content: '카드 내용입니다.',
  footer: '카드 푸터',
  action: {
    text: '액션 버튼',
    onClick: () => console.log('Action clicked!')
  }
});

// 개별 카드 컴포넌트
const cardHeader = Card.createHeader({ title: '제목', description: '설명' });
const cardContent = Card.createContent('내용');
const cardFooter = Card.createFooter('푸터');
```

### Modal 컴포넌트

```javascript
import { Modal } from './components/ui/index.js';

// 기본 모달
const modal = Modal.create({
  title: '모달 제목',
  content: '모달 내용입니다.',
  footer: true, // 기본 버튼들 표시
  onConfirm: () => console.log('확인됨'),
  onCancel: () => console.log('취소됨')
});

// 모달 열기/닫기
modal.open();
modal.close();

// 간단한 알림 모달
Modal.alert('알림 메시지');
Modal.confirm('확인하시겠습니까?').then(result => {
  if (result) console.log('확인됨');
});
```

### Input 컴포넌트

```javascript
import { Input, FormField } from './components/ui/index.js';

// 기본 입력 필드
const input = new Input('#my-input', {
  type: 'text',
  placeholder: '텍스트를 입력하세요',
  required: true
});

// 폼 필드 (레이블 포함)
const formField = FormField.create({
  label: '이메일',
  type: 'email',
  placeholder: 'your@email.com',
  required: true,
  description: '유효한 이메일 주소를 입력하세요'
});
```

### Toast 알림

```javascript
import { Toast } from './components/ui/index.js';

// 간단한 토스트
Toast.show('성공적으로 저장되었습니다!');

// 다양한 타입의 토스트
Toast.success('성공 메시지');
Toast.error('오류 메시지');
Toast.warning('경고 메시지');
Toast.info('정보 메시지');

// 커스텀 토스트
Toast.show('커스텀 메시지', {
  variant: 'destructive',
  duration: 5000,
  position: 'bottom-right'
});
```

### Dropdown 메뉴

```javascript
import { DropdownMenu } from './components/ui/index.js';

// 기본 드롭다운
const dropdown = new DropdownMenu('#trigger-button', {
  items: [
    { label: '편집', onClick: () => console.log('편집') },
    { label: '삭제', onClick: () => console.log('삭제') },
    { type: 'separator' },
    { label: '설정', onClick: () => console.log('설정') }
  ]
});

// 헬퍼 함수 사용
const quickDropdown = DropdownMenu.create({
  trigger: '#my-trigger',
  items: [
    { label: '프로필', href: '/profile' },
    { label: '설정', href: '/settings' },
    { type: 'separator' },
    { label: '로그아웃', onClick: logout }
  ]
});
```

### Tabs 컴포넌트

```javascript
import { Tabs } from './components/ui/index.js';

// 기본 탭
const tabs = Tabs.create({
  container: '#tabs-container',
  tabs: [
    { value: 'tab1', label: '탭 1', content: '첫 번째 탭 내용' },
    { value: 'tab2', label: '탭 2', content: '두 번째 탭 내용' },
    { value: 'tab3', label: '탭 3', content: '세 번째 탭 내용' }
  ],
  defaultValue: 'tab1'
});

// 동적 탭 추가/제거
tabs.addTab('tab4', '탭 4', '네 번째 탭 내용');
tabs.removeTab('tab2');
```

### Badge 컴포넌트

```javascript
import { Badge } from './components/ui/index.js';

// 기본 배지
const badge = Badge.create({
  text: 'New',
  variant: 'default' // default, secondary, destructive, outline
});

// 상태 배지
const statusBadge = Badge.createStatus('success');
const countBadge = Badge.createCount(42);
const categoryBadge = Badge.createCategory('JavaScript');
```

### Progress 진행 바

```javascript
import { Progress } from './components/ui/index.js';

// 기본 진행 바
const progress = Progress.create({
  container: '#progress-container',
  value: 50,
  showLabel: true
});

// 값 업데이트
progress.setValue(75);
progress.increment(10);
progress.animateTo(100, 2000); // 2초 동안 애니메이션

// 원형 진행 바
const circularProgress = Progress.createCircular('#circular-container', {
  size: 100,
  strokeWidth: 8
});
```

### Tooltip 툴팁

```javascript
import { Tooltip } from './components/ui/index.js';

// 기본 툴팁
const tooltip = new Tooltip('#my-element', {
  content: '이것은 툴팁입니다',
  position: 'top'
});

// 인터랙티브 툴팁
const interactiveTooltip = new Tooltip('#interactive-element', {
  content: '<strong>HTML</strong> 콘텐츠 지원',
  interactive: true,
  maxWidth: '300px'
});
```

### Switch 스위치

```javascript
import { Switch } from './components/ui/index.js';

// 기본 스위치
const switch1 = Switch.create({
  container: '#switch-container',
  checked: false,
  onCheckedChange: (checked) => {
    console.log('Switch toggled:', checked);
  }
});

// 레이블과 함께 스위치
const switchWithLabel = Switch.createWithLabel(
  '#container',
  '알림 받기',
  { checked: true }
);

// 테마 토글 스위치
const themeSwitch = Switch.createThemeToggle('#theme-container');
```

## 🎯 QuickCreate 헬퍼

빠른 컴포넌트 생성을 위한 헬퍼 함수들:

```javascript
import { QuickCreate } from './components/ui/index.js';

// 빠른 생성
const button = QuickCreate.button('클릭하세요');
const card = QuickCreate.card({ title: '제목', content: '내용' });
const modal = QuickCreate.modal({ title: '모달', content: '내용' });
QuickCreate.toast('메시지', 'success');
const dropdown = QuickCreate.dropdown('#trigger', items);
const tabs = QuickCreate.tabs('#container', tabsData);
const badge = QuickCreate.badge('라벨', 'primary');
const progress = QuickCreate.progress('#container', 50);
const tooltip = QuickCreate.tooltip('#element', '툴팁 텍스트');
const switch1 = QuickCreate.switch('#container', { checked: true });
```

## 🎨 스타일 커스터마이징

### CSS 변수 오버라이드

```css
:root {
  --primary: 220 100% 50%; /* 기본 파란색 대신 커스텀 색상 */
  --radius: 0.75rem; /* 더 둥근 모서리 */
  --transition-duration: 300ms; /* 더 느린 애니메이션 */
}
```

### 다크 모드 커스터마이징

```css
.dark {
  --primary: 220 100% 60%; /* 다크 모드에서 다른 파란색 */
  --background: 210 15% 8%; /* 더 어두운 배경 */
}
```

## 🔧 고급 사용법

### 이벤트 시스템

```javascript
import { UIEvents } from './components/ui/index.js';

// 이벤트 리스너 등록
UIEvents.on('ui:initialized', (data) => {
  console.log('UI 초기화됨:', data);
});

UIEvents.on('component:created', (component) => {
  console.log('컴포넌트 생성됨:', component);
});

// 커스텀 이벤트 발생
UIEvents.emit('my-event', { data: 'value' });
```

### 컴포넌트 레지스트리

```javascript
import { ComponentRegistry } from './components/ui/index.js';

// 커스텀 컴포넌트 등록
ComponentRegistry.register('MyComponent', MyComponent);

// 등록된 컴포넌트 사용
const MyComp = ComponentRegistry.get('MyComponent');
const instance = new MyComp();

// 모든 등록된 컴포넌트 목록
console.log(ComponentRegistry.list());
```

### 폼 통합

```javascript
// 폼 요소들을 쉽게 관리
const form = document.querySelector('#my-form');
const inputs = form.querySelectorAll('input[data-ui-component="input"]');

inputs.forEach(input => {
  const inputComponent = new Input(input);
  inputComponent.on('change', (value) => {
    // 폼 값 변경 시 처리
  });
});
```

## 📱 반응형 디자인

모든 컴포넌트는 반응형으로 설계되었으며, 다음과 같은 브레이크포인트를 사용합니다:

- `sm`: 640px 이상
- `md`: 768px 이상
- `lg`: 1024px 이상

```javascript
// 반응형 컴포넌트 설정
const responsiveCard = Card.create({
  className: 'w-full sm:w-1/2 lg:w-1/3'
});
```

## 🚀 성능 최적화

### 지연 로딩

```javascript
// 필요할 때만 컴포넌트 로드
const loadModal = async () => {
  const { Modal } = await import('./components/ui/modal.js');
  return new Modal();
};
```

### 메모리 관리

```javascript
// 컴포넌트 정리
const modal = new Modal();
// 사용 후...
modal.destroy(); // 메모리 해제
```

## 🧪 테스트

```javascript
// 컴포넌트 테스트 예시
const button = Button.create({ text: 'Test' });
button.element.click(); // 클릭 시뮬레이션

// 상태 확인
console.log(button.isDisabled()); // false
console.log(button.getText()); // 'Test'
```

## 📋 TypeScript 지원

TypeScript 정의 파일을 추가하여 타입 안전성을 확보할 수 있습니다:

```typescript
// types/ui.d.ts
declare module './components/ui/index.js' {
  export interface ButtonOptions {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    text?: string;
    disabled?: boolean;
    // ...
  }

  export class Button {
    constructor(element: string | HTMLElement, options?: ButtonOptions);
    // ...
  }
}
```

## 🐛 문제 해결

### 일반적인 문제들

1. **스타일이 적용되지 않음**
   - `styles.css` 파일이 올바르게 로드되었는지 확인
   - CSS 파일 경로가 정확한지 확인

2. **컴포넌트가 작동하지 않음**
   - JavaScript 모듈이 올바르게 임포트되었는지 확인
   - 브라우저 콘솔에서 오류 메시지 확인

3. **테마가 적용되지 않음**
   - `Theme.load()` 함수가 호출되었는지 확인
   - CSS 변수가 올바르게 정의되었는지 확인

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🤝 기여하기

버그 리포트, 기능 요청, 풀 리퀘스트를 환영합니다!

---

더 자세한 정보나 예제는 각 컴포넌트 파일의 주석을 참조하세요.