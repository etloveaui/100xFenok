import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design Gallery — 100xFenok",
  description: "150 curated design patterns for finance dashboard inspiration",
};

/* ------------------------------------------------------------------ */
/*  Design Gallery Data                                                */
/* ------------------------------------------------------------------ */

type DesignItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  applicability: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  reference?: string;
  visual?: string;
};

const CATEGORIES = [
  { key: "dataviz", label: "Data Visualization", icon: "📊", color: "from-blue-500 to-cyan-500" },
  { key: "interaction", label: "Micro Interactions", icon: "✨", color: "from-purple-500 to-pink-500" },
  { key: "layout", label: "Layout Patterns", icon: "🧱", color: "from-amber-500 to-orange-500" },
  { key: "mobile", label: "Mobile Native UX", icon: "📱", color: "from-green-500 to-emerald-500" },
  { key: "finance", label: "Finance Specific", icon: "💰", color: "from-yellow-500 to-amber-500" },
  { key: "a11y-perf", label: "Accessibility & Performance", icon: "⚡", color: "from-red-500 to-rose-500" },
  { key: "modern-css", label: "Modern CSS/JS", icon: "🎨", color: "from-indigo-500 to-violet-500" },
  { key: "notification", label: "Notifications & Feed", icon: "🔔", color: "from-teal-500 to-cyan-500" },
] as const;

const ITEMS: DesignItem[] = [
  /* === DATA VISUALIZATION === */
  {
    id: 1,
    name: "Sparkline Inline Charts",
    category: "dataviz",
    description: "Tiny line/bar charts embedded in table cells or card headers. Show trend at a glance without opening a full chart. Used by Bloomberg Terminal, Yahoo Finance, Robinhood.",
    applicability: "홈 카드 헤더에 7일 추세 스파크라인 삽입 — Market Pulse, Sector 카드에 즉시 적용 가능",
    difficulty: "Easy",
    tags: ["chart.js", "SVG", "inline"],
  },
  {
    id: 2,
    name: "Treemap Heatmap (Finviz Style)",
    category: "dataviz",
    description: "Nested rectangles sized by market cap, colored by performance. Interactive zoom on sector/industry. The gold standard for market overview visualization.",
    applicability: "홈 히트맵을 현재 단순 그리드에서 Finviz 스타일 트리맵으로 업그레이드 — S&P 500 전체 조감도",
    difficulty: "Hard",
    tags: ["d3.js", "canvas", "interactive"],
    reference: "https://finviz.com/map.ashx",
  },
  {
    id: 3,
    name: "Radial/Gauge Score Indicator",
    category: "dataviz",
    description: "Circular progress indicator showing a score (0-100) with gradient coloring. Fear & Greed Index, portfolio health score. CNN, TradingView use this pattern.",
    applicability: "Fear & Greed 지수를 현재 숫자 표시에서 원형 게이지로 시각화 — 직관적 감정 상태 전달",
    difficulty: "Medium",
    tags: ["SVG", "animation", "CSS"],
  },
  {
    id: 4,
    name: "Candlestick Mini Chart",
    category: "dataviz",
    description: "Compact OHLC candlestick in card format. 30-day view with volume bars below. TradingView mobile widget style.",
    applicability: "Stock Analyzer 종목 카드에 미니 캔들차트 추가 — 가격 패턴 즉시 파악",
    difficulty: "Medium",
    tags: ["lightweight-charts", "canvas"],
  },
  {
    id: 5,
    name: "Animated Number Counter (CountUp)",
    category: "dataviz",
    description: "Numbers animate from 0 to target value on scroll into view. Adds life to otherwise static dashboards. Stripe, Linear, Vercel use this.",
    applicability: "홈 지표 카드(VIX, S&P 500 변동률 등) 진입 시 숫자 카운트업 애니메이션",
    difficulty: "Easy",
    tags: ["intersection-observer", "animation", "countup.js"],
  },
  {
    id: 6,
    name: "Waterfall / Bridge Chart",
    category: "dataviz",
    description: "Shows cumulative effect of sequential positive/negative values. Perfect for P&L breakdown, portfolio contribution analysis. McKinsey presentation standard.",
    applicability: "IB Helper 포트폴리오 수익 기여도 분석 — 종목별 +/- 기여를 시각적으로 분해",
    difficulty: "Medium",
    tags: ["chart.js", "d3.js", "financial"],
  },
  {
    id: 7,
    name: "Horizon Chart (Dense Time Series)",
    category: "dataviz",
    description: "Layered area chart that compresses many time series into minimal vertical space. Shows 20+ metrics in the space of 3 regular charts. Observable, Bloomberg use this.",
    applicability: "Macro Monitor에서 10+ 지표 동시 비교 — SOFR, TGA, VIX, 수익률 곡선 등을 한 눈에",
    difficulty: "Hard",
    tags: ["d3.js", "canvas", "dense-data"],
  },
  /* === MICRO INTERACTIONS === */
  {
    id: 8,
    name: "Skeleton Loading States",
    category: "interaction",
    description: "Pulsing placeholder shapes mimicking final layout during data load. Reduces perceived load time by 30-40%. Facebook, LinkedIn, Notion standard.",
    applicability: "이미 loading.tsx 있지만 라우트별 커스텀 스켈레톤으로 확장 — 카드, 차트, 테이블 각각",
    difficulty: "Easy",
    tags: ["tailwind", "animate-pulse", "UX"],
  },
  {
    id: 9,
    name: "Pull-to-Refresh",
    category: "interaction",
    description: "Mobile gesture: pull down to refresh data. Native app feel. Twitter, Instagram, every finance app uses this.",
    applicability: "모바일에서 홈/Market 페이지 데이터 새로고침 — 새로고침 버튼 대체",
    difficulty: "Medium",
    tags: ["touch", "gesture", "mobile"],
  },
  {
    id: 10,
    name: "Haptic Feedback on Key Actions",
    category: "interaction",
    description: "Vibration API trigger on button press, toggle, error. Subtle 10ms pulse adds physical feedback. iOS/Android finance apps standard.",
    applicability: "IB Helper 계산 버튼, 프로필 전환, 에러 발생 시 햅틱 — 앱 느낌 강화",
    difficulty: "Easy",
    tags: ["vibration-api", "mobile", "native-feel"],
  },
  {
    id: 11,
    name: "Swipe Actions on Cards/Rows",
    category: "interaction",
    description: "Swipe left/right to reveal action buttons (delete, archive, share). iOS Mail, Revolut transaction list pattern.",
    applicability: "포트폴리오 종목 카드에서 스와이프로 빠른 액션 (매수/매도 계산, 상세 보기)",
    difficulty: "Medium",
    tags: ["touch", "gesture", "framer-motion"],
  },
  {
    id: 12,
    name: "Long Press Context Menu",
    category: "interaction",
    description: "Hold 500ms to show contextual actions. Mobile-native pattern replacing right-click. iOS Context Menu, Android long press.",
    applicability: "차트/카드에서 롱프레스로 공유, 상세, 비교 메뉴 — 터치 친화적 2차 동작",
    difficulty: "Medium",
    tags: ["touch", "pointer-events", "menu"],
  },
  {
    id: 13,
    name: "Magnetic Snap Scroll",
    category: "interaction",
    description: "CSS scroll-snap for horizontal card carousels. Cards snap to center/start on scroll end. App Store, Netflix pattern.",
    applicability: "모바일 홈에서 카드 수평 스크롤 스냅 — 섹터, 지표 카드 캐러셀",
    difficulty: "Easy",
    tags: ["scroll-snap", "CSS", "carousel"],
  },
  {
    id: 14,
    name: "Morphing Card Expand",
    category: "interaction",
    description: "Card smoothly expands into full page with shared element transition. Material Design, Apple Music album open. View Transition API enables this natively.",
    applicability: "홈 카드 클릭 시 상세 페이지로 모핑 전환 — 맥락 유지 네비게이션",
    difficulty: "Hard",
    tags: ["view-transition-api", "animation", "SPA-feel"],
  },
  /* === LAYOUT PATTERNS === */
  {
    id: 15,
    name: "Bento Grid (Apple Style)",
    category: "layout",
    description: "Asymmetric grid with varying card sizes. Hero card 2x2, supporting cards 1x1. Apple WWDC, Linear changelog style. Creates visual hierarchy without headers.",
    applicability: "홈 대시보드를 균일 그리드에서 벤토 레이아웃으로 — VIX/S&P 500 히어로 + 보조 지표 그리드",
    difficulty: "Medium",
    tags: ["grid", "responsive", "visual-hierarchy"],
  },
  {
    id: 16,
    name: "Collapsible/Accordion Sections",
    category: "layout",
    description: "Sections expand/collapse with smooth animation. Reduces initial cognitive load. GitHub, Stripe documentation pattern.",
    applicability: "Macro Monitor 위젯 그룹을 접이식으로 — 관심 영역만 펼쳐보기",
    difficulty: "Easy",
    tags: ["details-summary", "animation", "progressive-disclosure"],
  },
  {
    id: 17,
    name: "Sticky Header with Blur",
    category: "layout",
    description: "Navigation header stays fixed on scroll with glassmorphism blur effect. iOS Safari, Arc browser, Notion style. backdrop-filter: blur().",
    applicability: "Navbar를 스크롤 시 블러 배경으로 — 콘텐츠 가시성 유지하면서 네비 고정",
    difficulty: "Easy",
    tags: ["backdrop-filter", "sticky", "glassmorphism"],
  },
  {
    id: 18,
    name: "Masonry / Pinterest Layout",
    category: "layout",
    description: "Cards of varying heights arranged in columns without gaps. CSS columns or CSS Grid masonry (experimental). Pinterest, Unsplash pattern.",
    applicability: "Posts/VR 가이드 목록을 메이슨리로 — 다양한 길이의 콘텐츠 자연 배치",
    difficulty: "Medium",
    tags: ["CSS-columns", "grid-masonry", "responsive"],
  },
  {
    id: 19,
    name: "Split Panel / Resizable Panes",
    category: "layout",
    description: "Draggable divider between two panels. IDE-like layout for power users. VS Code, Bloomberg Terminal, TradingView.",
    applicability: "Stock Analyzer에서 차트+테이블 분할 패널 — 사용자가 비율 조절",
    difficulty: "Medium",
    tags: ["resize-observer", "drag", "power-user"],
  },
  {
    id: 20,
    name: "Command Palette (⌘K)",
    category: "layout",
    description: "Universal search/action palette triggered by keyboard shortcut. Navigate anywhere, execute any action. Linear, Vercel, Raycast, Notion.",
    applicability: "⌘K로 종목 검색, 페이지 이동, 관리자 기능 — 파워유저 생산성 극대화",
    difficulty: "Medium",
    tags: ["cmdk", "keyboard", "search"],
  },
  {
    id: 21,
    name: "Sidebar Navigation with Collapse",
    category: "layout",
    description: "Left sidebar with icons-only collapsed mode. Hover or toggle to expand labels. Discord, Slack, Notion pattern.",
    applicability: "Admin 영역에서 사이드바 네비게이션 — 현재 카드 그리드보다 깊은 구조에 적합",
    difficulty: "Medium",
    tags: ["sidebar", "responsive", "navigation"],
  },
  /* === MOBILE NATIVE UX === */
  {
    id: 22,
    name: "Bottom Sheet (Modal)",
    category: "mobile",
    description: "Sheet that slides up from bottom, draggable to dismiss. iOS Maps, Google Maps, every modern mobile app. Replaces traditional modals on mobile.",
    applicability: "모바일에서 종목 상세, 필터, 설정을 바텀시트로 — 전체 화면 전환 없이 컨텍스트 유지",
    difficulty: "Medium",
    tags: ["touch", "gesture", "framer-motion", "vaul"],
  },
  {
    id: 23,
    name: "Floating Action Button (FAB)",
    category: "mobile",
    description: "Persistent circular button for primary action. Material Design standard. Can expand to reveal sub-actions.",
    applicability: "모바일에서 빠른 액션 (새로고침, 맨 위로, 계산) FAB — 하단 dock과 조합",
    difficulty: "Easy",
    tags: ["position-fixed", "animation", "mobile"],
  },
  {
    id: 24,
    name: "Tab Bar with Animated Indicator",
    category: "mobile",
    description: "Bottom tab bar where active indicator slides/morphs between tabs. iOS TabBarController animation. Smooth 60fps spring animation.",
    applicability: "현재 모바일 dock에 활성 탭 인디케이터 애니메이션 추가 — 선택 상태 명확화",
    difficulty: "Easy",
    tags: ["animation", "spring", "tab-bar"],
  },
  {
    id: 25,
    name: "Edge Swipe Back Navigation",
    category: "mobile",
    description: "Swipe from left edge to go back. iOS system gesture. Web implementation with History API + touch events.",
    applicability: "모바일에서 뒤로가기 제스처 — 상세 → 목록 네비게이션 자연스러운 전환",
    difficulty: "Hard",
    tags: ["touch", "history-api", "gesture"],
  },
  {
    id: 26,
    name: "Adaptive Layout (Fold/Tablet)",
    category: "mobile",
    description: "Layout responds to fold state, tablet orientation. Samsung Flex Mode, iPad Split View. Uses screen-spanning media queries.",
    applicability: "폴드 접힘/펼침 상태에서 자동 레이아웃 전환 — 현재 BACKLOG #266 대응",
    difficulty: "Hard",
    tags: ["screen-spanning", "media-query", "fold"],
  },
  {
    id: 27,
    name: "Native Share API Integration",
    category: "mobile",
    description: "Web Share API for native share sheet (iOS/Android). Share URLs, text, files through system UI. Replaces custom share menus.",
    applicability: "포스트/분석 결과 공유를 네이티브 공유 시트로 — 카카오톡, 메시지 앱 직접 공유",
    difficulty: "Easy",
    tags: ["web-share-api", "mobile", "native"],
  },
  {
    id: 28,
    name: "Offline-First with Service Worker",
    category: "mobile",
    description: "Cache critical assets and last-known data. Show stale data with refresh indicator when offline. Workbox, next-pwa pattern.",
    applicability: "지하철/비행기에서도 마지막 조회 데이터 표시 — PWA 오프라인 기본 지원",
    difficulty: "Medium",
    tags: ["service-worker", "workbox", "PWA"],
  },
  /* === FINANCE SPECIFIC === */
  {
    id: 29,
    name: "Portfolio Donut / Allocation Ring",
    category: "finance",
    description: "Concentric rings showing asset allocation. Center shows total value. Robinhood, Wealthfront, Monarch Money signature visualization.",
    applicability: "IB Helper 포트폴리오 비중을 도넛 차트로 — 종목별/섹터별 할당 시각화",
    difficulty: "Medium",
    tags: ["chart.js", "doughnut", "allocation"],
  },
  {
    id: 30,
    name: "P&L Ribbon / Equity Curve",
    category: "finance",
    description: "Area chart with gradient fill showing cumulative P&L. Green above zero, red below. Interactive tooltip with date/value. Every trading platform essential.",
    applicability: "IB Helper 누적 수익 곡선 — 시간 경과에 따른 포트폴리오 성과 추적",
    difficulty: "Medium",
    tags: ["area-chart", "gradient-fill", "financial"],
  },
  {
    id: 31,
    name: "Yield Curve 3D Surface",
    category: "finance",
    description: "3D surface plot showing yield curve evolution over time. Bloomberg Terminal signature. Three.js or plotly.js for web.",
    applicability: "Macro Monitor 수익률 곡선 시계열을 3D 서피스로 — 금리 구조 변화 한눈에",
    difficulty: "Hard",
    tags: ["three.js", "plotly", "3D", "financial"],
  },
  {
    id: 32,
    name: "Sector Rotation Clock",
    category: "finance",
    description: "Circular diagram showing business cycle sectors. Arrow indicates current position. Fidelity sector rotation model visualization.",
    applicability: "홈에서 현재 경기 사이클 위치와 유리한 섹터를 시계 형태로 — 투자 전략 직관화",
    difficulty: "Medium",
    tags: ["SVG", "animation", "sector-rotation"],
  },
  {
    id: 33,
    name: "Real-time Ticker Tape (Marquee)",
    category: "finance",
    description: "Horizontal scrolling ticker with live prices. CNBC, Bloomberg TV style. Color-coded green/red with smooth animation.",
    applicability: "이미 Footer ticker 있음 — 스타일을 Bloomberg TV 수준으로 업그레이드 (로고, 변동률 배지)",
    difficulty: "Easy",
    tags: ["marquee", "animation", "real-time"],
  },
  {
    id: 34,
    name: "Risk Heatmap Matrix",
    category: "finance",
    description: "2D matrix (probability × impact) with color intensity. Risk management standard. Hoverable cells with detail popover.",
    applicability: "포트폴리오 리스크 매트릭스 — 변동성 vs 상관관계 시각화",
    difficulty: "Medium",
    tags: ["heatmap", "matrix", "risk"],
  },
  {
    id: 35,
    name: "Earnings Calendar Strip",
    category: "finance",
    description: "Horizontal timeline showing upcoming earnings dates. Color by expected move. Hoverable for EPS estimate. TradingView, Nasdaq style.",
    applicability: "홈 또는 Stock Analyzer에 실적 캘린더 스트립 — 주요 종목 실적일 추적",
    difficulty: "Medium",
    tags: ["timeline", "calendar", "earnings"],
  },
  /* === ACCESSIBILITY & PERFORMANCE === */
  {
    id: 36,
    name: "Dark Mode with System Preference",
    category: "a11y-perf",
    description: "Automatic dark/light switch based on OS preference. Manual override with toggle. Tailwind dark: variant. Every modern app standard.",
    applicability: "전체 사이트 다크모드 — 야간 트레이딩, OLED 배터리 절약, 눈 피로 감소",
    difficulty: "Medium",
    tags: ["prefers-color-scheme", "tailwind-dark", "theme"],
  },
  {
    id: 37,
    name: "Reduced Motion Respect",
    category: "a11y-perf",
    description: "Disable animations when user prefers-reduced-motion. Replace with instant transitions. WCAG 2.1 requirement.",
    applicability: "모든 애니메이션에 reduced-motion 미디어 쿼리 적용 — 접근성 기본 준수",
    difficulty: "Easy",
    tags: ["prefers-reduced-motion", "a11y", "WCAG"],
  },
  {
    id: 38,
    name: "Prefetch on Hover/Viewport",
    category: "a11y-perf",
    description: "Preload next page data when link enters viewport or on hover. Next.js Link prefetch, Speculation Rules API for Chrome.",
    applicability: "주요 네비게이션 링크에 프리페치 — 체감 로딩 0ms 달성",
    difficulty: "Easy",
    tags: ["next-link", "speculation-rules", "prefetch"],
  },
  {
    id: 39,
    name: "View Transitions API",
    category: "a11y-perf",
    description: "Native browser page transition animations. Cross-document transitions in Chrome 126+. Smooth morphing between pages without SPA overhead.",
    applicability: "페이지 전환 시 크로스페이드/모핑 — Next.js experimental viewTransition 지원",
    difficulty: "Medium",
    tags: ["view-transition", "experimental", "chrome"],
  },
  {
    id: 40,
    name: "Virtualized Lists (Windowing)",
    category: "a11y-perf",
    description: "Render only visible rows in long lists. React-window, TanStack Virtual. Essential for 500+ item lists.",
    applicability: "Stock Analyzer 500+ 종목 테이블 가상화 — 스크롤 성능 대폭 개선",
    difficulty: "Medium",
    tags: ["react-window", "tanstack-virtual", "performance"],
  },
  {
    id: 41,
    name: "Optimistic UI Updates",
    category: "a11y-perf",
    description: "Show success state immediately before server confirms. Revert on failure. Instagram like, Notion edit, Linear create.",
    applicability: "IB Helper 저장/계산 시 즉시 UI 반영 — 서버 응답 대기 없이 빠른 피드백",
    difficulty: "Medium",
    tags: ["optimistic-update", "UX", "perceived-speed"],
  },
  /* === MODERN CSS/JS === */
  {
    id: 42,
    name: "Container Queries",
    category: "modern-css",
    description: "Components respond to their container size, not viewport. Perfect for cards that appear in different contexts. Chrome/Firefox/Safari support.",
    applicability: "카드 컴포넌트가 홈 2열/상세 1열에서 각각 다른 레이아웃 — viewport 대신 컨테이너 반응",
    difficulty: "Easy",
    tags: ["container-query", "CSS", "responsive"],
  },
  {
    id: 43,
    name: "Scroll-Driven Animations",
    category: "modern-css",
    description: "CSS animations tied to scroll progress. No JavaScript needed. Chrome 115+. Parallax, reveal on scroll, progress indicators.",
    applicability: "홈 스크롤 시 카드 페이드인/슬라이드업 — JS 없이 CSS만으로 스크롤 애니메이션",
    difficulty: "Easy",
    tags: ["scroll-timeline", "CSS", "animation"],
  },
  {
    id: 44,
    name: "Popover API (Native)",
    category: "modern-css",
    description: "Native HTML popover attribute. No JS needed for show/hide. Auto-dismisses on outside click. Accessible by default. Chrome/Firefox/Safari.",
    applicability: "툴팁, 드롭다운, 상세 팝오버를 네이티브 popover로 — JS 코드 감소 + 접근성 기본 내장",
    difficulty: "Easy",
    tags: ["popover", "HTML", "no-JS"],
  },
  {
    id: 45,
    name: "CSS Anchor Positioning",
    category: "modern-css",
    description: "Position elements relative to any other element without JS. Tooltips, dropdowns, popovers that auto-reposition. Chrome 125+.",
    applicability: "차트 위 툴팁/라벨을 CSS만으로 앵커 배치 — floating-ui 대체 가능",
    difficulty: "Easy",
    tags: ["anchor-positioning", "CSS", "experimental"],
  },
  {
    id: 46,
    name: "CSS :has() Selector",
    category: "modern-css",
    description: "Parent selector — style parent based on child state. Revolutionary for forms, cards, interactive components. All browsers supported.",
    applicability: "카드 내부 상태(호버, 선택, 에러)에 따라 카드 전체 스타일 변경 — 복잡한 JS 상태 관리 대체",
    difficulty: "Easy",
    tags: [":has()", "CSS", "parent-selector"],
  },
  {
    id: 47,
    name: "Color Mix & Relative Colors",
    category: "modern-css",
    description: "CSS color-mix() and relative color syntax. Dynamic color manipulation without JS. Create tints, shades, complementary colors in CSS.",
    applicability: "다크모드, 테마 변경 시 동적 색상 계산 — 디자인 토큰 대체",
    difficulty: "Easy",
    tags: ["color-mix", "oklch", "CSS"],
  },
  /* === NOTIFICATIONS & FEED === */
  {
    id: 48,
    name: "Toast Stack with Actions",
    category: "notification",
    description: "Stacked toast notifications with undo/action buttons. Sonner, react-hot-toast pattern. Auto-dismiss with hover pause.",
    applicability: "현재 단일 토스트를 스택형으로 — 여러 알림 동시 처리 + 실행 취소 지원",
    difficulty: "Easy",
    tags: ["sonner", "toast", "notification"],
  },
  {
    id: 49,
    name: "Live Activity Feed",
    category: "notification",
    description: "Real-time event feed with timestamps. New items slide in from top. WebSocket or SSE powered. Slack, Discord, GitHub activity.",
    applicability: "관리자에서 시스템 이벤트 피드 — 데이터 갱신, 스크래핑 상태, 오류 실시간 모니터",
    difficulty: "Hard",
    tags: ["SSE", "websocket", "real-time"],
  },
  {
    id: 50,
    name: "Badge / Dot Notification System",
    category: "notification",
    description: "Red dot or count badge on navigation items. Indicates unread/new content. iOS notification badge standard.",
    applicability: "Admin Hub 카드에 새 데이터/이슈 뱃지 — 주의 필요한 영역 즉시 식별",
    difficulty: "Easy",
    tags: ["badge", "notification", "count"],
  },
  {
    id: 51,
    name: "Announcement Banner (Dismissible)",
    category: "notification",
    description: "Top-of-page banner for important announcements. Dismissible with cookie/localStorage memory. Vercel, GitHub, Stripe pattern.",
    applicability: "장 마감 알림, 시스템 점검 공지, 새 기능 안내 — 홈 상단 배너",
    difficulty: "Easy",
    tags: ["banner", "dismissible", "localStorage"],
  },
  /* === WAVE 2: FINTECH TRENDS 2025-2026 === */
  {
    id: 52,
    name: "Glassmorphism Card System",
    category: "layout",
    description: "Frosted-glass cards using backdrop-filter blur with semi-transparent backgrounds and subtle borders. Creates layered depth without 3D rendering cost. Matured in 2025-2026 to be accessibility-focused with proper contrast ratios. Apple visionOS, Revolut premium.",
    applicability: "포트폴리오 요약, 워치리스트, 센티먼트 툴팁 오버레이에 적용 — 다크 테마 위에 프로스트 글라스로 프리미엄 레이어드 느낌",
    difficulty: "Easy",
    tags: ["backdrop-filter", "glassmorphism", "semi-transparent", "premium"],
  },
  {
    id: 53,
    name: "AI Copilot Chat Widget",
    category: "notification",
    description: "Embedded conversational AI panel for natural language data queries. 'Show me sectors that outperformed last week' or '포트폴리오 테크 비중은?'. Microsoft Copilot for Finance, ChatFin pioneered this in 2025.",
    applicability: "슬라이드아웃 챗 패널에서 S&P 500, 섹터 로테이션, 센티먼트 트렌드를 한국어로 질문 — 기존 데이터 API 연결로 차별화 포인트",
    difficulty: "Hard",
    tags: ["openai-api", "langchain", "streaming", "RAG", "next-api"],
  },
  {
    id: 54,
    name: "Adaptive AI Dashboard (Auto-Reorganize)",
    category: "layout",
    description: "Dashboard auto-reorganizes widgets based on user behavior, market conditions, or time. High-volatility events surface VIX/fear index; calm markets show long-term trends. Power BI Copilot, Bloomberg Terminal pattern.",
    applicability: "IEEPA 관세 발표 같은 고변동성 이벤트 시 자동으로 VIX, 섹터 공포지수, 포트폴리오 영향 추정 위젯 상단 배치. 평상시엔 장기 추세 분석.",
    difficulty: "Hard",
    tags: ["react-grid-layout", "zustand", "websocket", "context-aware"],
  },
  {
    id: 55,
    name: "Hyper-Personalized Onboarding Flow",
    category: "interaction",
    description: "Guided step-by-step onboarding collecting user preferences (risk tolerance, sectors of interest). Immediately customizes dashboard. 25-30% higher retention than generic dashboards. Robinhood, Revolut benchmark.",
    applicability: "첫 방문 시 'S&P 500 전체 / 섹터 로테이션 / 밸류에이션 / 센티먼트' 선택 → 대시보드 자동 구성. 한국 사용자 이탈률 대폭 감소",
    difficulty: "Medium",
    tags: ["multi-step-form", "zustand", "localStorage", "framer-motion"],
  },
  {
    id: 56,
    name: "Gamified Achievement & Streak System",
    category: "interaction",
    description: "Daily login streaks, sector analysis completion badges, portfolio milestone rewards. Progress bars, animated badge unlocks, subtle confetti. Robinhood achievements, Duolingo streak adapted for fintech.",
    applicability: "'7일 연속 시장 체크' 스트릭 뱃지, '모든 섹터 분석 완료' 업적, '첫 포트폴리오 생성' 마일스톤 — 일상적 시장 분석 습관 형성",
    difficulty: "Medium",
    tags: ["lottie-react", "zustand", "confetti", "badge-system"],
  },
  {
    id: 57,
    name: "Composable Dashboard (Drag-and-Drop Widgets)",
    category: "layout",
    description: "Users customize dashboard by dragging, resizing, adding/removing widget cards from a library. Layouts persist across sessions. Bloomberg Terminal flexibility meets modern web usability. UX Design Award 2024 winner.",
    applicability: "파워유저가 자신만의 뷰 구성 — 거대 S&P 500 차트만 원하는 사람, 12위젯 정보밀도 원하는 사람 모두 충족. 위젯 라이브러리: 가격차트, 히트맵, 센티먼트 게이지, 매크로 등",
    difficulty: "Hard",
    tags: ["react-grid-layout", "dnd-kit", "zustand", "persist"],
  },
  {
    id: 58,
    name: "Dynamic Color Sentiment Gradients",
    category: "finance",
    description: "Background/border gradients shift dynamically based on real-time data. Card border glows green→amber→red as fear index rises. Creates ambient at-a-glance market mood without reading numbers. CNN Fear & Greed wheel pattern.",
    applicability: "홈 히어로 섹션 배경이 현재 Fear & Greed 지수에 따라 쿨 블루(침착)→웜 레드(공포)로 변화. 섹터 카드 테두리도 개별 센티먼트 반영",
    difficulty: "Medium",
    tags: ["css-gradients", "css-variables", "dynamic-theming", "real-time"],
  },
  {
    id: 59,
    name: "3D Tilt Card Interactions",
    category: "interaction",
    description: "Cards respond to mouse position with subtle 3D perspective tilt + parallax depth. Combined with glassmorphism creates physical floating feel. GPU-accelerated CSS transforms for 60fps. Stripe, Apple product showcases.",
    applicability: "섹터 성과 카드, 포트폴리오 요약 카드에 적용 — 마우스 호버 시 커서 방향으로 기울어지며 빛 반사 효과. 데스크톱 전용, 모바일은 비활성",
    difficulty: "Easy",
    tags: ["react-tilt", "framer-motion", "css-transform", "perspective"],
  },
  {
    id: 60,
    name: "Biometric-Gated Premium Views",
    category: "mobile",
    description: "Sensitive financial data hidden behind biometric check (Face ID, fingerprint, passkey). Dashboard shows blurred/anonymized data by default. Prevents shoulder surfing in public. Revolut hide balance, Toss biometric unlock.",
    applicability: "포트폴리오 금액, P&L을 '***,***원'으로 기본 숨김 처리, 탭/클릭으로 Web Authentication API 통해 공개 — 토스가 한국에서 이미 표준화한 패턴",
    difficulty: "Medium",
    tags: ["web-authn-api", "css-filter-blur", "privacy", "credential-management"],
  },
  {
    id: 61,
    name: "Cinematic Dark Mode with Neon Accents",
    category: "a11y-perf",
    description: "Deep charcoal/navy backgrounds with selective electric blue, cyan, green neon highlights. 70%+ of financial platform users prefer dark mode. Neon accents guide eye to critical data points — price changes, alerts, portfolio performance. Binance, E-Trade, TradingView dark mode.",
    applicability: "기본 테마로 시네마틱 다크 모드 적용 — S&P 500 변동률과 센티먼트 점수가 네온 그린/레드로 발광. 한국 트레이딩 컨텍스트에서 다크모드 퍼스트 기대",
    difficulty: "Easy",
    tags: ["tailwindcss", "css-variables", "next-themes", "neon", "dark-mode"],
  },
  {
    id: 62,
    name: "Microinteraction Feedback System",
    category: "interaction",
    description: "Subtle animations on every user action — button press ripples, toggle morphing, success checkmark, number count-up on data load, card hover lift with shadow deepening. These 'invisible details' separate premium apps from basic ones. Revolut, Stripe, Robinhood (confetti on first trade).",
    applicability: "센티먼트 점수 업데이트 시 넘버 카운트업, 실시간 가격 변동 시 미세 펄스, 섹터 정렬 시 카드 리오더 애니메이션 — 대시보드가 '살아있는' 느낌",
    difficulty: "Medium",
    tags: ["framer-motion", "react-spring", "lottie-react", "css-transitions"],
  },
  /* === WAVE 3: WEB PLATFORM APIs 2025-2026 === */
  {
    id: 63,
    name: "CSS @scope (Component Isolation)",
    category: "modern-css",
    description: "Scopes styles to a DOM subtree with upper/lower bounds. Proximity-based specificity replaces BEM naming and CSS Modules. Chrome 118+, Safari 17.4+, Firefox 128+. Baseline 2025.",
    applicability: "대시보드 위젯 간 스타일 격리 — 차트/테이블/뉴스 위젯이 서로 CSS 간섭 없이 독립 동작",
    difficulty: "Easy",
    tags: ["@scope", "CSS", "component-isolation", "baseline-2025"],
  },
  {
    id: 64,
    name: "Partial Prerendering (PPR)",
    category: "a11y-perf",
    description: "Next.js 16: static shell from CDN (40-90ms TTFB) + dynamic content streaming via Suspense boundaries. Combines SSR and SSG in a single route. 5-8x TTFB improvement.",
    applicability: "대시보드 레이아웃/네비는 정적 캐시, 실시간 시세/센티먼트는 스트리밍. 금융 대시보드 혼합 렌더링 최적 솔루션",
    difficulty: "Hard",
    tags: ["next.js-16", "PPR", "streaming", "Suspense", "performance"],
  },
  {
    id: 65,
    name: "Server Actions (Zero-API CRUD)",
    category: "modern-css",
    description: "Next.js 15: 'use server' directive marks functions that execute on server. No API routes needed for CRUD. Automatic serialization, validation, progressive enhancement. 30-40% code reduction.",
    applicability: "포트폴리오 저장, 워치리스트 편집, 설정 업데이트에서 /api/ 라우트 불필요. 코드량 대폭 감소",
    difficulty: "Easy",
    tags: ["next.js-15", "server-actions", "CRUD", "DX"],
  },
  {
    id: 66,
    name: "React 19 + React Compiler",
    category: "a11y-perf",
    description: "React 19: use() hook for promises, useOptimistic for instant UI, form actions. React Compiler auto-memoizes — eliminates manual useMemo/useCallback. Auto-optimization of re-renders.",
    applicability: "useOptimistic으로 주문/포트폴리오 즉시 반영. useMemo/useCallback 60+개 자동 처리. 대시보드 리렌더링 최적화 자동화",
    difficulty: "Medium",
    tags: ["react-19", "compiler", "useOptimistic", "auto-memo"],
  },
  {
    id: 67,
    name: "Tailwind v4 CSS-First Config + Runtime Themes",
    category: "modern-css",
    description: "Replace tailwind.config.js with CSS @theme blocks. All tokens auto-exposed as CSS variables. Runtime theming without JS. 3.5x faster full build, 8x faster incremental.",
    applicability: "다크/라이트 모드 순수 CSS 전환. 사용자 커스텀 대시보드 색상. tailwind.config.js 제거. 빌드 8배 향상",
    difficulty: "Medium",
    tags: ["tailwind-v4", "@theme", "CSS-variables", "runtime-theming"],
  },
  {
    id: 68,
    name: "contrast-color() Auto-Readable Text",
    category: "modern-css",
    description: "CSS auto-picks black/white text for readable contrast against any background. Browser handles WCAG calculation. Safari 18.2+ shipped. Chrome/Firefox in development.",
    applicability: "히트맵 셀, 수익률 배지, 컬러코딩 테이블에서 텍스트 가독성 자동 보장. OKLCH lightness 폴백 사용",
    difficulty: "Easy",
    tags: ["contrast-color", "a11y", "WCAG", "Safari-18.2"],
  },
  {
    id: 69,
    name: "Temporal API (Modern Date/Time)",
    category: "modern-css",
    description: "Immutable date/time types replacing Date. Correct timezone handling, calendar arithmetic, duration math. Chrome 144+, Firefox 139+. Eliminates date-fns/dayjs dependency (10KB+ bundle savings).",
    applicability: "시장 시간대 변환 (KST/EST/UTC), 거래일 계산, 실적발표 카운트다운, 기간 비교. 번들 사이즈 절감",
    difficulty: "Medium",
    tags: ["Temporal", "date", "timezone", "bundle-size", "polyfill"],
  },
  /* === WAVE 3: DATA VISUALIZATION INNOVATION === */
  {
    id: 70,
    name: "Bump Chart (Ranking Flow)",
    category: "dataviz",
    description: "Smooth flowing lines showing how rankings change over time. Intersections reveal rank swaps. Instantly shows winners, losers, dramatic shifts without numeric clutter. Observable, D3.",
    applicability: "S&P 500 섹터 수익률 순위 변동 추적 — 에너지가 3위→1위 급등하는 흐름을 한눈에 파악",
    difficulty: "Medium",
    tags: ["d3.js", "Observable-Plot", "ranking", "time-series"],
  },
  {
    id: 71,
    name: "Sankey Diagram (Capital Flow)",
    category: "dataviz",
    description: "Directed flow paths with width proportional to magnitude. Reveals allocation structure and bottlenecks that tables hide. SankeyMATIC, D3.",
    applicability: "포트폴리오 자금 흐름: 총 포트폴리오 → 자산군 → 섹터 → 종목. 섹터 로테이션 자금 이동 시각화",
    difficulty: "Medium",
    tags: ["d3-sankey", "plotly", "flow", "allocation"],
  },
  {
    id: 72,
    name: "Chord Diagram (Cross-Correlation)",
    category: "dataviz",
    description: "Circular layout with arcs showing bidirectional relationships. Ribbon thickness = strength. Reveals hidden interconnections far more intuitively than a correlation table. OANDA.",
    applicability: "섹터 간 상관관계를 직관적 원형 다이어그램으로 — 두꺼운 리본 = 높은 상관, 얇은 리본 = 분산 기회",
    difficulty: "Hard",
    tags: ["d3-chord", "visx", "radial", "correlation"],
  },
  {
    id: 73,
    name: "Small Multiples (Trellis Grid)",
    category: "dataviz",
    description: "Grid of identical small charts sharing axes, one per category. Effortless visual comparison — eye sweeps across to spot outliers. Edward Tufte's concept.",
    applicability: "11개 섹터 미니차트 4x3 그리드 — 동일 기간/축으로 패턴 비교가 즉각적",
    difficulty: "Easy",
    tags: ["recharts", "CSS-Grid", "faceted", "comparative"],
  },
  {
    id: 74,
    name: "Animated Bubble Chart (Gapminder Motion)",
    category: "dataviz",
    description: "Scatter plot with bubble size as 3rd variable, animated over time. Bubbles drift/grow/shrink revealing trajectories and regime shifts. Gapminder, D3.",
    applicability: "X=수익률, Y=변동성, 크기=시총, 색=섹터. 분기별 애니메이션으로 섹터 이동 궤적 시각화",
    difficulty: "Hard",
    tags: ["d3.js", "framer-motion", "plotly", "multi-dimensional"],
  },
  {
    id: 75,
    name: "Beeswarm Plot (Distribution Reveal)",
    category: "dataviz",
    description: "Individual data points with jittering along axis to avoid overlap. Unlike histograms, every single data point visible — clusters, gaps, outliers at individual level.",
    applicability: "500개 종목 일일 수익률 분포를 개별 점으로 — 섹터별 클러스터와 극단 아웃라이어 즉시 식별",
    difficulty: "Medium",
    tags: ["d3-beeswarm", "visx", "distribution", "individual-data"],
  },
  {
    id: 76,
    name: "Ridgeline Plot (Joy Division Density)",
    category: "dataviz",
    description: "Stacked density curves offset vertically creating mountain-range silhouette. Shows how distribution shape evolves across time — regime changes, fat tails, skewness shifts.",
    applicability: "월별 VIX 분포 변화를 산맥 형태로 — 시장 레짐 전환(평온기 vs 공포기) 한눈에 파악",
    difficulty: "Medium",
    tags: ["d3.js", "visx", "density", "temporal-distribution"],
  },
  {
    id: 77,
    name: "Marimekko Chart (2D Proportions)",
    category: "dataviz",
    description: "100% stacked bar where column width also varies — encodes both 'market share' (width) and 'composition' (height) simultaneously. Spotfire, AnyChart.",
    applicability: "섹터 비중(너비) × 산업군 구성(높이) 동시 표현. Tech 칼럼이 시각적으로 지배하여 집중 리스크 직관화",
    difficulty: "Medium",
    tags: ["d3.js", "AnyChart", "visx", "proportional"],
  },
  {
    id: 78,
    name: "Nightingale Rose (Sentiment Composite)",
    category: "dataviz",
    description: "Circular bar chart with wedge radius encoding magnitude. Each petal = one indicator. Radial layout naturally represents cyclic/composite data. Visually striking shape.",
    applicability: "센티먼트 복합 게이지: 각 꽃잎 = Fear&Greed/Put-Call/VIX/Breadth/Momentum. 전체 모양이 시장 심리 요약",
    difficulty: "Medium",
    tags: ["recharts-PolarArea", "d3.js", "radial", "sentiment"],
  },
  {
    id: 79,
    name: "Connected Scatterplot (Trajectory)",
    category: "dataviz",
    description: "Scatter plot where consecutive points are connected by lines — shows temporal trajectory through 2-variable space. Cycles, spirals, regime shifts visible. NYT graphics team popularized.",
    applicability: "S&P 500 수익률 vs VIX 궤적: 평온기 나선형, 위기 시 급격한 움직임. 레짐 전환 시각화",
    difficulty: "Easy",
    tags: ["d3.js", "recharts-custom", "trajectory", "temporal-scatter"],
  },
  {
    id: 80,
    name: "Scrollytelling (Narrative Data Story)",
    category: "dataviz",
    description: "Scroll-driven narrative where charts animate/transform/annotate as user scrolls. Guided insight through editorial storytelling. NYT 'The Upshot' standard.",
    applicability: "주간 마켓 리캡: 스크롤하면 S&P 라인 → 섹터 오버레이 → 이벤트 주석 → 센티먼트 게이지 순차 빌드업",
    difficulty: "Hard",
    tags: ["scrollama", "GSAP", "intersection-observer", "narrative"],
  },
  {
    id: 81,
    name: "Chart-Type Morphing Transitions",
    category: "dataviz",
    description: "Smooth animated transitions between chart types — bar→treemap, line→scatter. Animation preserves data identity during transformation. D3 transition, Observable.",
    applicability: "뷰 모드 전환 시 바차트→트리맵 모핑, 트렌드→분포 전환. 데이터 정체성 유지하며 다른 관점 제공",
    difficulty: "Hard",
    tags: ["d3-transition", "FLIP-animation", "morphing", "UX"],
  },
  {
    id: 82,
    name: "Annotated Time-Series with Event Markers",
    category: "dataviz",
    description: "Standard time-series enriched with clickable event markers at key dates — FOMC, CPI, tariff announcements. Bridges 'what happened' and 'why'. TradingView, ChartSwatcher.",
    applicability: "S&P 500 메인 차트에 FOMC/CPI/관세 이벤트 마커 — 클릭하면 이벤트 맥락 + 즉각 시장 반응 표시",
    difficulty: "Easy",
    tags: ["recharts-ReferenceLine", "lightweight-charts", "annotation", "contextual"],
  },
  /* === WAVE 3: MOBILE FINANCE UX === */
  {
    id: 83,
    name: "Pinch-to-Zoom Time-Series",
    category: "mobile",
    description: "Two-finger pinch on charts adjusts visible time range. Pinch out = intraday detail, pinch in = yearly view. One-finger pan for horizontal scroll. Axis labels update in real-time. TradingView, Robinhood.",
    applicability: "매크로 모니터 차트에 핀치 줌 적용. Highcharts/Lightweight Charts pinchType:'x' 설정. 버튼 탭보다 직관적",
    difficulty: "Medium",
    tags: ["gesture", "pinch-zoom", "chart", "touch"],
  },
  {
    id: 84,
    name: "Long-Press Peek Preview",
    category: "mobile",
    description: "Long-press triggers floating preview overlay (mini-chart, key metrics) with blurred background. Slide finger to actions without lifting. iOS Context Menu / 3D Touch web equivalent.",
    applicability: "종목/자산 카드에 롱프레스 프리뷰 — 상세 페이지 이동 없이 핵심 정보 확인. Popover API + pointerdown 조합",
    difficulty: "Hard",
    tags: ["gesture", "long-press", "popover-api", "preview"],
  },
  {
    id: 85,
    name: "SWR + Visual Freshness Indicator",
    category: "mobile",
    description: "Stale-while-revalidate with visual data age badges: green (<30s), yellow (30s-5m), gray (>5m/offline). Fresh data arrival triggers count-up/color-flash animation. Robinhood, Bloomberg.",
    applicability: "시장 데이터 신선도 시각 표시 — 오프라인 시 캐시 데이터 + 회색 배지 자동 전환. 사용자 신뢰도 향상",
    difficulty: "Medium",
    tags: ["SWR", "ISR", "data-freshness", "PWA", "real-time"],
  },
  {
    id: 86,
    name: "Progressive Disclosure Expandable Cards",
    category: "mobile",
    description: "Cards show essential data collapsed (symbol, price, change). Tap expands inline with spring animation for detailed metrics, mini-chart. Accordion or multi-expand. Robinhood, Monarch Money.",
    applicability: "워치리스트/밸류에이션 카드 점진적 공개 — 모바일 스크롤 깊이 감소 + 정보 밀도 유지",
    difficulty: "Easy",
    tags: ["progressive-disclosure", "Radix-Collapsible", "framer-motion", "mobile"],
  },
  {
    id: 87,
    name: "Thumb-Zone Bottom Action Bar",
    category: "mobile",
    description: "Critical actions (Refresh, Period Toggle, Filter) in persistent bottom bar within natural thumb zone. Frosted-glass blur over content. Auto-hides on scroll-down, returns on scroll-up. Robinhood, Webull.",
    applicability: "차트/대시보드 하단에 액션 바 — 상단 툴바보다 터치 인체공학적. backdrop-filter + sticky 조합",
    difficulty: "Easy",
    tags: ["thumb-zone", "ergonomics", "bottom-bar", "backdrop-filter"],
  },
  {
    id: 88,
    name: "Contextual Color-Coded Data States",
    category: "mobile",
    description: "Beyond red/green: value changes flash briefly on update then settle to muted tone. Color intensity scales with magnitude (small=pale, large=saturated). Directional arrows for color-blind accessibility.",
    applicability: "모든 수치 데이터에 시맨틱 컬러 시스템. CSS custom properties로 테마 변수화. 색맹 접근성 대응 필수",
    difficulty: "Medium",
    tags: ["color-system", "semantic", "a11y", "real-time"],
  },
  {
    id: 89,
    name: "Service Worker Background Sync Queue",
    category: "mobile",
    description: "Offline actions queued in IndexedDB. Connectivity returns → service worker replays queue. Mini-banner shows '2 actions pending sync'. Failed items surface as notifications. Workbox Background Sync.",
    applicability: "지하철/비행기 오프라인에서도 워치리스트 편집, 알림 설정 유지. workbox-background-sync 활용",
    difficulty: "Hard",
    tags: ["PWA", "offline", "background-sync", "workbox", "IndexedDB"],
  },
  {
    id: 90,
    name: "Overscroll Micro-Interactions",
    category: "mobile",
    description: "Scroll past list end shows contextual content: top overscroll → search bar with trending tickers, bottom → 'all caught up'. Rubber-band physics match native iOS/Android feel.",
    applicability: "워치리스트 상단 오버스크롤 → 검색 노출, 하단 → 완료 메시지. overscroll-behavior + JS 물리 엔진",
    difficulty: "Hard",
    tags: ["overscroll", "physics", "gesture", "native-feel"],
  },
  {
    id: 91,
    name: "Adaptive Card Density by Viewport",
    category: "mobile",
    description: "Same cards auto-switch between compact (phone: symbol+price+sparkline), comfortable (tablet: +volume+range), expanded (desktop: full chart+metrics). CSS Container Queries. Animated transitions.",
    applicability: "반응형 카드 시스템으로 폰/태블릿/데스크톱 한 번에 대응. @container 활용. BACKLOG #266 직접 대응",
    difficulty: "Medium",
    tags: ["container-queries", "responsive", "adaptive", "multi-device"],
  },
  {
    id: 92,
    name: "Crossfade Chart Period Transitions",
    category: "interaction",
    description: "Switching 1D/1W/1M/1Y: old chart morphs/crossfades into new one. Data points interpolate, Y-axis animates. Sliding pill indicator for active period. Prevents disorienting chart redraw flash. Robinhood, Apple Stocks.",
    applicability: "매크로/밸류에이션 차트 기간 전환에 적용 — 시각적 연속성으로 데이터 컨텍스트 유지",
    difficulty: "Hard",
    tags: ["chart", "crossfade", "transition", "period-switch", "lightweight-charts"],
  },
  /* === ACCESSIBILITY & PERFORMANCE (Wave 5) === */
  {
    id: 93,
    name: "Sonification — Audio Data Mapping",
    category: "a11y-perf",
    description: "Maps financial data to audio: pitch encodes price, rhythm encodes volume, timbre distinguishes assets. Traders detect anomalies faster through auditory channels than visual scanning. Confirmed by Stevens Institute & UC Davis research.",
    applicability: "HTS 체결음의 체계적 확장 — 시각 장애 트레이더 접근성 향상 및 멀티 모니터링 보조",
    difficulty: "Hard",
    tags: ["accessibility", "multi-sensory", "WCAG-1.1", "Web-Audio-API"],
  },
  {
    id: 94,
    name: "Haptic Data Feedback",
    category: "a11y-perf",
    description: "Vibration API encodes portfolio performance into mobile vibration patterns — short pulses for gains, long for losses, intensity proportional to magnitude. Discreet performance summaries without screen. Studies show +27% engagement.",
    applicability: "모바일 증권 앱 사용률 90%+ 한국 시장에서 출퇴근 중 포트폴리오 모니터링에 실질적 가치",
    difficulty: "Medium",
    tags: ["accessibility", "mobile", "Vibration-API", "multi-sensory"],
  },
  {
    id: 95,
    name: "Auto High Contrast Mode",
    category: "a11y-perf",
    description: "Detects prefers-contrast: more and forced-colors: active, adapts chart colors/borders/backgrounds to AAA 7:1 contrast automatically. No user toggle needed — OS preference drives theme.",
    applicability: "고령 투자자 비율 높은 한국 주식시장(60대+ 20%)에서 고대비 자동 적용은 접근성과 실사용성 동시 향상",
    difficulty: "Medium",
    tags: ["accessibility", "WCAG-1.4.6", "CSS-media-query", "high-contrast"],
  },
  {
    id: 96,
    name: "aria-live Price Regions",
    category: "a11y-perf",
    description: "Real-time price cells use aria-live='polite' for routine ticks, role='status' for non-critical, aria-live='assertive' only for circuit-breaker/limit-hit alerts. Maps financial urgency to ARIA announcement priority.",
    applicability: "장애인차별금지법 준수를 위한 실시간 시세 접근성 — 법적 요건이기도 함",
    difficulty: "Medium",
    tags: ["accessibility", "WCAG-4.1.3", "ARIA", "screen-reader"],
  },
  {
    id: 97,
    name: "Keyboard Chart Navigation",
    category: "a11y-perf",
    description: "Chart data points become focusable via tabindex. Arrow keys traverse time (L/R) and datasets (U/D). Each point triggers aria-label: 'Samsung, Mar 12, close 78,400, +2.1%'. Currently absent in all Korean securities web platforms.",
    applicability: "국내 증권사 웹에 전무한 기능 — 구현 시 강력한 차별화 요소",
    difficulty: "Hard",
    tags: ["accessibility", "WCAG-2.1.1", "keyboard", "chart"],
  },
  {
    id: 98,
    name: "Reduced Motion Dashboard",
    category: "a11y-perf",
    description: "Queries prefers-reduced-motion: reduce. All CSS transitions become instant swaps, chart draws become static renders, ticker scrolling becomes static list. WCAG 2.3.3 compliance with zero visual compromise for motion-sensitive users.",
    applicability: "네이버 증권/다음 금융 등 국내 금융 포털 미지원 — 선제 적용으로 접근성 리더십 확보",
    difficulty: "Easy",
    tags: ["accessibility", "WCAG-2.3.3", "CSS-media-query", "motion"],
  },
  {
    id: 99,
    name: "Okabe-Ito Color-Blind Safe Palette",
    category: "a11y-perf",
    description: "Default chart palette uses 8-color Okabe-Ito scheme (endorsed by Nature Methods) with pattern overlays (hatching/dots/dashes) for redundant encoding. Works for all CVD types including deuteranopia/protanopia.",
    applicability: "한국 빨강=상승/파랑=하락 컨벤션은 글로벌 반대 — 색각이상 투자자를 위한 이중 인코딩 특히 중요",
    difficulty: "Easy",
    tags: ["accessibility", "WCAG-1.4.1", "color-blind", "data-visualization"],
  },
  {
    id: 100,
    name: "Focus-Visible Finance Ring",
    category: "a11y-perf",
    description: ":focus-visible (not :focus) with 2-color ring system: inner + outer color maintaining 3:1 contrast on any background. Mouse clicks don't trigger — clean for pointer users, fully accessible for keyboard navigation.",
    applicability: "다크 테마 증권 앱에서 기본 브라우저 포커스 링이 거의 보이지 않는 문제 해결",
    difficulty: "Easy",
    tags: ["accessibility", "WCAG-2.4.13", "design-system", "focus"],
  },
  {
    id: 101,
    name: "Virtual Scroll Table (TanStack)",
    category: "a11y-perf",
    description: "Renders only visible ~35 rows + 10 overscan out of 10K+ total. TanStack Virtual + TanStack Table preserves native <table> semantics with 60fps sorting, filtering, column pinning on massive datasets.",
    applicability: "코스피/코스닥 2,500+ 종목 리스트 웹 전환 시 가상 스크롤은 필수 구현 사항",
    difficulty: "Medium",
    tags: ["performance", "DOM-optimization", "TanStack", "virtual-scroll"],
  },
  {
    id: 102,
    name: "SVG→Canvas Auto-Switch",
    category: "a11y-perf",
    description: "SVG for <1K points (DOM accessibility + interactivity), auto-switch to Canvas/WebGL above threshold. Hybrid LOD: zoom-in shows SVG, zoom-out switches to Canvas. ECharts v5.3+ Virtual DOM makes SVG 2-10x faster.",
    applicability: "틱/분봉 차트 수만 포인트 — Canvas 자동 전환은 웹 차트 성능 경쟁력의 핵심",
    difficulty: "Hard",
    tags: ["performance", "rendering", "SVG", "Canvas", "WebGL"],
  },
  {
    id: 103,
    name: "Optimistic UI for Non-Trade Actions",
    category: "a11y-perf",
    description: "Instantly reflects watchlist edits, alert settings, UI preferences before API confirms. Rolls back on failure with clear notification. Scoped to non-transactional actions — trade execution requires server confirmation.",
    applicability: "관심종목 추가/알림 설정 등 비거래 액션에 즉각 반영으로 UX 대폭 향상",
    difficulty: "Medium",
    tags: ["performance", "UX", "optimistic-update", "data-consistency"],
  },
  {
    id: 104,
    name: "Stale-While-Revalidate Dashboard",
    category: "a11y-perf",
    description: "Cached data served instantly on load/tab-refocus, background revalidation updates UI when fresh data arrives. SWR/TanStack Query with auto focus-revalidation and reconnect-revalidation. 1-5s staleness acceptable for analytics.",
    applicability: "한국 투자자의 멀티탭 증권 사용 패턴(네이버+HTS+포털 동시)에 탭 포커스 재검증이 특히 적합",
    difficulty: "Easy",
    tags: ["performance", "caching", "SWR", "TanStack-Query"],
  },
  {
    id: 105,
    name: "Fetch Priority Hero Metrics",
    category: "a11y-perf",
    description: "fetchpriority='high' for above-fold KPIs (portfolio value, daily P&L, key indices), loading='lazy' for below-fold charts. Critical CSS inlined. Hero number renders <1s. Directly improves LCP and FID Core Web Vitals.",
    applicability: "모바일 LTE/5G 환경에서 첫 화면 로딩 속도가 앱 이탈률과 직결 — 히어로 지표 우선 로딩 필수",
    difficulty: "Easy",
    tags: ["performance", "Core-Web-Vitals", "Fetch-Priority-API", "critical-path"],
  },
  {
    id: 106,
    name: "Web Worker Financial Computation",
    category: "a11y-perf",
    description: "Moving averages, Bollinger Bands, correlation matrices, portfolio risk metrics offloaded to Web Workers. Main thread stays at 60fps for scrolling/typing/chart interaction. 70% perceived load time reduction in financial tools.",
    applicability: "국내 개인투자자의 기술적 분석(이동평균, RSI, MACD) 사용률 높아 반응성에 직접 영향",
    difficulty: "Medium",
    tags: ["performance", "Web-Workers", "multithreading", "computation"],
  },
  {
    id: 107,
    name: "Intersection Observer Chart Lazy Render",
    category: "a11y-perf",
    description: "Charts render only when scrolled into viewport. 8-12 chart dashboard but only 2-3 visible initially — remaining show skeleton placeholders. Animation triggers also gated on visibility. Confirmed by DraftKings engineering.",
    applicability: "종목 상세 페이지 10개+ 차트 배치에서 뷰포트 기반 렌더링으로 초기 로딩 대폭 절감",
    difficulty: "Easy",
    tags: ["performance", "lazy-loading", "Intersection-Observer", "skeleton"],
  },
  {
    id: 108,
    name: "Progressive Data Resolution",
    category: "a11y-perf",
    description: "Load daily candles for year view, refine to 1-min on zoom, then tick data on deep zoom. Server-side continuous aggregation (TimescaleDB) pre-computes each tier. TradingView implements natively with configurable resolution levels.",
    applicability: "동시호가(08:30-09:00) 틱 데이터 분당 수천 건 — 점진적 해상도 없이 웹 차트 줌인 성능 급락",
    difficulty: "Hard",
    tags: ["performance", "data-architecture", "level-of-detail", "zoom"],
  },
  /* === KOREAN FINTECH & GLOBAL FINANCE UX (Wave 5) === */
  {
    id: 109,
    name: "Spring-Physics Number Counter",
    category: "interaction",
    description: "Portfolio balances animate between values using spring physics (mass/stiffness/damping) — digits roll individually with overshoot-and-settle. Toss pioneered this in Korean fintech. useSpring + Intl.NumberFormat for locale-aware display.",
    applicability: "포트폴리오 총자산/수익률 표시에 적용하면 실시간 데이터 변화를 체감각적으로 전달",
    difficulty: "Medium",
    tags: ["animation", "spring-physics", "Toss", "number-display"],
  },
  {
    id: 110,
    name: "Pull-to-Refresh Sparkline",
    category: "mobile",
    description: "During pull-to-refresh, a mini sparkline draws in real-time synced to gesture Y-offset. Chart amplitude maps to pull distance, snaps into actual refreshed data on release. Transforms dead loading time into data preview.",
    applicability: "Market Pulse 새로고침 시 최근 24시간 시장 미니차트로 대기 시간을 정보 탐색으로 전환",
    difficulty: "Hard",
    tags: ["gesture", "sparkline", "pull-to-refresh", "micro-interaction"],
  },
  {
    id: 111,
    name: "Emoji Auto-Tag Transaction Cards",
    category: "finance",
    description: "Transactions auto-categorized with contextual emoji (coffee=cafe, chip=semiconductor). Swipe left to recategorize, long-press for custom rules. Banksalad/Toss AI-driven classification. Emoji scanning 3x faster than text-only labels.",
    applicability: "포트폴리오 거래 내역에 종목별 자동 이모지 태그로 히스토리 스캔 속도 향상",
    difficulty: "Medium",
    tags: ["categorization", "emoji", "gesture", "Banksalad"],
  },
  {
    id: 112,
    name: "Allocation Drag Rebalancer",
    category: "finance",
    description: "Portfolio allocation as horizontal stacked bar with drag handles. Pulling one segment larger compresses adjacent proportionally. Real-time dollar impact and projected return shown during drag. All segments sum to 100% zero-sum physics.",
    applicability: "자산 배분 위젯에서 드래그로 비중 조절 — 리밸런싱을 직관적으로 시뮬레이션 (Valuation Lab 시너지)",
    difficulty: "Hard",
    tags: ["direct-manipulation", "portfolio", "rebalancing", "Wealthfront"],
  },
  {
    id: 113,
    name: "Comparative Spending Insight Cards",
    category: "finance",
    description: "Dismissible cards: 'You spent 23% more on dining this month' with dual horizontal bars (this vs last month), emoji, gradient delta. Tap for daily breakdown. Banksalad signature pattern. Progressive disclosure.",
    applicability: "'이번 달 반도체 섹터 비중 15% 증가' 같은 포트폴리오 인사이트 카드로 차별화",
    difficulty: "Medium",
    tags: ["insight", "comparison", "card-UI", "progressive-disclosure"],
  },
  {
    id: 114,
    name: "Currency Flip Card (3D)",
    category: "interaction",
    description: "3D card flip via CSS perspective+rotateY with spring easing. Front=one currency, back=converted amount. Exchange rate displayed on card edge during rotation — transitional animation becomes information-bearing moment. Revolut signature.",
    applicability: "해외 주식 평가에서 원화/달러 전환 시 플립 카드로 환율 영향 직관적 확인",
    difficulty: "Medium",
    tags: ["3D", "animation", "currency", "Revolut", "CSS-perspective"],
  },
  {
    id: 115,
    name: "Asset Aggregation Tree",
    category: "finance",
    description: "Hierarchical treemap or collapsible tree: total net worth → account types (brokerage/bank/crypto) → individual holdings. Each node shows value + % of parent. Expanding/collapsing with smooth animation. Spatial wealth distribution understanding.",
    applicability: "증권사별/자산군별 계층 트리로 총자산 시각화 — 포트폴리오 분산 현황 한눈에 파악",
    difficulty: "Hard",
    tags: ["hierarchy", "treemap", "aggregation", "Monarch-Money"],
  },
  {
    id: 116,
    name: "Risk Meter Semicircular Gauge",
    category: "finance",
    description: "Semicircular SVG gauge with smooth green→yellow→red gradient. Spring-animated needle transitions. Pulsing at extreme values creates urgency. Slider overlay for target-risk vs actual creates goal-vs-actual visualization.",
    applicability: "포트폴리오 리스크 점수를 반원 게이지로 표현 — 텍스트 없이 위험도 즉각 인지",
    difficulty: "Easy",
    tags: ["gauge", "risk", "SVG", "Fear-Greed", "spring-animation"],
  },
  {
    id: 117,
    name: "Dividend Calendar Heatmap",
    category: "finance",
    description: "GitHub-contribution-style heatmap for dividend payments. Color intensity = payment amount. Hover reveals ticker/ex-date/amount. Weekly/monthly totals on axes. Zero-learning-curve metaphor via universal GitHub contribution graph pattern.",
    applicability: "배당 달력에 히트맵 적용 — 연간 배당 수령 패턴과 공백기 한눈에 파악하여 전략 수립",
    difficulty: "Medium",
    tags: ["heatmap", "calendar", "dividend", "react-calendar-heatmap"],
  },
  {
    id: 118,
    name: "IPO Vertical Timeline",
    category: "finance",
    description: "Alternating left/right cards on vertical timeline spine. Status badges: Filed→Roadshow→Priced→Trading with progressive color. Countdown timer on upcoming. Active IPO has pulsing dot. Past IPOs show first-day performance.",
    applicability: "한국/미국 IPO 일정을 타임라인으로 시각화 — 공모주 투자 타이밍 직관적 도구",
    difficulty: "Medium",
    tags: ["timeline", "IPO", "status-tracking", "countdown"],
  },
  {
    id: 119,
    name: "Peer Comparison Radar Chart",
    category: "dataviz",
    description: "5-7 axis radar (return, risk, diversification, dividend yield, Sharpe ratio) comparing user portfolio (filled) vs peer average (outline). Spring-animated axis extension on data change. 'Top 10%' overlay for aspirational framing.",
    applicability: "'내 포트폴리오 vs 동일 투자성향 그룹' 레이더 차트 — 자기 진단 기능으로 차별화",
    difficulty: "Medium",
    tags: ["radar-chart", "comparison", "portfolio-analysis", "peer"],
  },
  {
    id: 120,
    name: "Goal Tracker Thermometer",
    category: "interaction",
    description: "Vertical thermometer SVG with spring-animated mercury fill. Gradient cool blue→warm red. Milestone markers at 25/50/75/100%. Confetti burst on target achievement (Toss-style celebration). Emotionally resonant progress indicator.",
    applicability: "목표 수익률/자산액 달성 추적에 온도계 + 게이미피케이션으로 투자 동기 부여",
    difficulty: "Easy",
    tags: ["progress", "gamification", "SVG", "confetti", "Toss"],
  },
  {
    id: 121,
    name: "Market Mood Ring",
    category: "finance",
    description: "Circular gradient ring with conic-gradient color stops shifting by sentiment. Slow CSS rotation creates 'living' feel. Lava-lamp gradient effect. Inside: numeric score + one-word label. Instantly recognizable brand element.",
    applicability: "메인 페이지에 무드링 배치 — 복잡한 시장 심리를 단일 시각 요소로 압축 (Hero Zone 통합)",
    difficulty: "Medium",
    tags: ["sentiment", "conic-gradient", "animation", "branding"],
  },
  {
    id: 122,
    name: "Split View Synced Comparison",
    category: "layout",
    description: "Side-by-side ticker comparison with synchronized scrolling. Identical section structure (chart, fundamentals, metrics) for two tickers. Diff bar between panels highlights better/worse metrics with directional arrows. Mobile: swipe toggles overlay/split.",
    applicability: "종목 비교 기능에 싱크 스크롤 분할 뷰 — 두 종목 체계적 비교로 의사결정 지원",
    difficulty: "Hard",
    tags: ["comparison", "split-view", "sync-scroll", "IntersectionObserver"],
  },
  /* === REAL-TIME STREAMING UI (Wave 5) === */
  {
    id: 123,
    name: "Tick-by-Tick Cell Flash",
    category: "interaction",
    description: "Grid cells flash green (uptick) / red (downtick) with 300-600ms fade-out via CSS @keyframes on pseudo-element opacity. Batch hundreds of simultaneous ticks into single rAF cycle. AG Grid enableCellChangeFlash reference.",
    applicability: "QuickIndices/FooterTickerBar에 flash 애니메이션 추가로 실시간 가격 변동 체감 향상",
    difficulty: "Easy",
    tags: ["data-grid", "css-animation", "websocket", "rAF"],
  },
  {
    id: 124,
    name: "Order Book Depth Mountain",
    category: "dataviz",
    description: "Mirrored area chart — bid (green) stacks left, ask (red) stacks right, spread gap in center. 50-200 updates/sec requires Canvas/WebGL. Bookmap heatmap (time×price×volume-color) is gold standard for depth replay.",
    applicability: "향후 실시간 종목 상세 페이지 확장 시 오더북 시각화 후보 (WebSocket 인프라 필요)",
    difficulty: "Hard",
    tags: ["orderbook", "Canvas", "WebGL", "high-frequency"],
  },
  {
    id: 125,
    name: "Time & Sales Ribbon",
    category: "dataviz",
    description: "Vertically scrolling trade tape: timestamp, price, size, direction. Trade size encoded via font weight/row height — block trades visually pop. Virtualized ring buffer with rAF-driven scroll. Pause-on-hover freezes visual without dropping data.",
    applicability: "Alpha Scout에 주요 종목 체결 테이프 추가로 시장 체감 속도 전달",
    difficulty: "Medium",
    tags: ["virtualized-list", "trade-tape", "size-encoding"],
  },
  {
    id: 126,
    name: "Level 2 Market Data Grid",
    category: "dataviz",
    description: "Dual-column bid(green)/ask(red) with inline horizontal volume bars proportional to each level's size. Spread row centered. Double-buffered normalization prevents jitter as max changes. Combined with tick-flash for layered animation.",
    applicability: "IB Helper 웹 대시보드 확장 시 호가창 시각화로 직접 활용 (RPA 데이터 연동)",
    difficulty: "Hard",
    tags: ["level2", "volume-bars", "dual-column", "normalization"],
  },
  {
    id: 127,
    name: "Streaming Candlestick Formation",
    category: "dataviz",
    description: "Rightmost candle animates real-time — body stretches, wick extends per tick, color flips green↔red on close crossing open. REST for history + WebSocket for live. Batch ticks/sec to prevent overdraw. TradingView Lightweight Charts pattern.",
    applicability: "Multichart 페이지에 Lightweight Charts 활용 시 streaming 캔들 구현이 자연스러움",
    difficulty: "Medium",
    tags: ["candlestick", "partial-update", "websocket", "Lightweight-Charts"],
  },
  {
    id: 128,
    name: "Heat Pulse Sector Overlay",
    category: "dataviz",
    description: "Finviz-style sector treemap with pulse ring animation on large moves (>1%). Radial expanding circle with opacity fade. Treemap layout recalculates on structural changes only. d3 diverging color scale via CSS custom property for GPU transitions.",
    applicability: "Sectors 페이지 기존 섹터 데이터에 treemap + 펄스 시각화로 시장 전체 조감",
    difficulty: "Medium",
    tags: ["treemap", "pulse-animation", "sector-map", "d3"],
  },
  {
    id: 129,
    name: "Volume Profile Sidebar",
    category: "dataviz",
    description: "Horizontal bars alongside Y-axis showing volume at each price level. Point of Control (POC) highlighted. Two-tone split (up/down volume). Adaptive binning by zoom level. POC extends as dashed overlay across main chart.",
    applicability: "Stock Analyzer 종목 차트에 Volume Profile 추가 — 지지/저항 수준 직관적 파악",
    difficulty: "Medium",
    tags: ["volume-profile", "POC", "adaptive-binning", "chart-overlay"],
  },
  {
    id: 130,
    name: "Cross-Asset Correlation Matrix",
    category: "dataviz",
    description: "NxN heatmap: rolling Pearson correlation, blue(-1)→white(0)→red(+1). Web Worker for O(N^2) computation. CSS transition 1s for smooth color shifts. Diagonal shows sparklines. Tooltip with exact coefficient + trend arrow.",
    applicability: "Macro Monitor에 자산 간 상관관계 매트릭스 추가 — 레짐 변화 감지 강력한 도구",
    difficulty: "Hard",
    tags: ["correlation", "heatmap", "Web-Worker", "rolling-computation"],
  },
  {
    id: 131,
    name: "Alert Waterfall Cascade",
    category: "notification",
    description: "Stacked notification cards cascading from right with 50ms stagger delay. Each card: condition, price, inline sparkline. 8s auto-dismiss with shrink-fade exit. Framer Motion AnimatePresence. Priority queue with deduplication for volatile markets.",
    applicability: "Radar 페이지 종목 모니터링에 알림 워터폴 추가 — 이벤트 드리븐 의사결정 지원",
    difficulty: "Medium",
    tags: ["notifications", "stagger-animation", "Framer-Motion", "priority-queue"],
  },
  {
    id: 132,
    name: "Live P&L Odometer Ticker",
    category: "finance",
    description: "Bloomberg PORT-style aggregate P&L with odometer digit-roll animation. Individual digit columns spin via translateY per digit span. Sign change crossfades minus sign. Background tints green/red. Hover expands position breakdown.",
    applicability: "IB Helper 대시보드 상단에 포트폴리오 P&L 티커 — 전체 수익 현황 한눈에 파악",
    difficulty: "Medium",
    tags: ["odometer", "portfolio", "P&L", "digit-animation"],
  },
  {
    id: 133,
    name: "Market Breadth McClellan Oscillator",
    category: "dataviz",
    description: "Dual-pane: smoothed McClellan line (19/39-day EMA of net advances) top + raw advance-decline histogram bottom. Zero-line crossings highlighted with vertical markers. Area fill color changes green↔red at precise interpolated crossing point.",
    applicability: "BreadthCard 컴포넌트를 McClellan Oscillator 차트로 확장 — 시장 건강도 정밀 표현",
    difficulty: "Medium",
    tags: ["breadth", "McClellan", "EMA", "zero-crossing"],
  },
  {
    id: 134,
    name: "Intraday VWAP Deviation Bands",
    category: "dataviz",
    description: "VWAP line (bold) flanked by 1/2/3 sigma bands as semi-transparent fills. Characteristic 'trumpet' shape as cumulative variance grows. Band-touch triggers visual pulse. True std-dev produces slightly asymmetric envelopes.",
    applicability: "Stock Analyzer 인트라데이 차트에 VWAP 밴드 오버레이 — 기관 매매 기준선 시각화",
    difficulty: "Medium",
    tags: ["VWAP", "deviation-bands", "cumulative", "institutional"],
  },
  {
    id: 135,
    name: "Options Flow Heatmap",
    category: "dataviz",
    description: "2D grid: strike(X) × expiry(Y). Cell color = net premium (calls green, puts red). Log/quantile scale for heavy-tailed distribution. Unusual activity (vol>3x OI) gets pulsing border. Side panel streams large-block orders.",
    applicability: "Alpha Scout에 옵션 플로우 히트맵 — 스마트머니 추적 기능 강화",
    difficulty: "Hard",
    tags: ["options-flow", "sparse-heatmap", "unusual-activity", "strike-expiry"],
  },
  {
    id: 136,
    name: "News Sentiment Stream",
    category: "notification",
    description: "Reverse-chronological feed with horizontal sentiment bar per headline (red→green, NLP score marker). Two-phase render: headline appears immediately, sentiment bar fills when FinBERT inference completes. Fuzzy dedup across sources (Jaccard threshold).",
    applicability: "SentimentGauge와 연계 — 뉴스 피드 + 실시간 감성 스코어링 통합으로 매크로 시그널 완성",
    difficulty: "Hard",
    tags: ["NLP-sentiment", "two-phase-render", "FinBERT", "deduplication"],
  },
  /* === AWARD-WINNING VISUAL DESIGN (Wave 5) === */
  {
    id: 137,
    name: "Glassmorphism Data Cards",
    category: "layout",
    description: "Frosted-glass panels with backdrop-filter: blur(8-15px) at 70-80% opacity over gradient backgrounds. Subtle border highlights create floating depth. Achieves hierarchy through transparency, not containment — 'focus vs periphery' cognitive model.",
    applicability: "KPI 카드에 반투명 글래스 효과로 고급스러움과 가독성 동시 달성 — 토스/카카오뱅크 미학과 일치",
    difficulty: "Easy",
    tags: ["glassmorphism", "backdrop-filter", "KPI-cards", "CSS"],
  },
  {
    id: 138,
    name: "Neumorphic View Toggles",
    category: "interaction",
    description: "Soft-shadow UI with dual box-shadow (light+dark) creating extruded/pressed appearance. Neumorphism 2.0 (2025+) with higher contrast ratios for WCAG AA. Tactile 'press' feedback satisfies cause-and-effect expectation.",
    applicability: "포트폴리오 뷰 전환(리스트/카드/차트)용 토글에 적합 — 접근성 명도 대비 검증 필수",
    difficulty: "Easy",
    tags: ["neumorphism", "soft-UI", "toggle", "box-shadow"],
  },
  {
    id: 139,
    name: "Animated Gradient Mesh Background",
    category: "modern-css",
    description: "Multi-layered radial gradients animated via CSS @property or background-position keyframes. Organic aurora-like shifting backdrop. Pure CSS 60fps without JS. Subtle ambient motion signals 'alive' interface below conscious attention threshold.",
    applicability: "히어로 섹션/로딩 화면 배경 — CSS 전용으로 번들 증가 없이 시각적 고급감 확보",
    difficulty: "Medium",
    tags: ["gradient-mesh", "CSS-animation", "@property", "ambient-motion"],
  },
  {
    id: 140,
    name: "3D Asset Allocation Globe",
    category: "dataviz",
    description: "WebGL globe (Three.js/globe.gl) with cylindrical 3D data points for geographic asset distribution. Hexagonal binning for density, arc connections between markets. Rotation triggers spatial cognition — 'my money is there' intuition.",
    applicability: "글로벌 자산배분 시각화에 임팩트 극대화 — 모바일 GPU fallback으로 2D 맵 필수",
    difficulty: "Hard",
    tags: ["WebGL", "Three.js", "globe", "geographic-viz"],
  },
  {
    id: 141,
    name: "Isometric Chart Blocks",
    category: "dataviz",
    description: "3D isometric bar charts via CSS 3D transforms or Three.js. Sectors as extruded blocks on isometric grid with shadow casting. Consistent 30-degree angle creates 'board game' aesthetic making data approachable, not intimidating.",
    applicability: "섹터별 수익률 비교에 시각적 흥미 — 정밀 비교 시 툴팁 보완 필요",
    difficulty: "Medium",
    tags: ["isometric", "3D-chart", "CSS-3D-transform", "sector"],
  },
  {
    id: 142,
    name: "Particle Flow Chart Transitions",
    category: "interaction",
    description: "Data points dissolve into particles (D3 force simulation/WebGL) during chart-type transitions, then reassemble. Velocity Verlet physics. Answers 'where did my data go?' — user tracks particles maintaining object constancy across encodings.",
    applicability: "차트 전환 시 데이터 연속성 시각화 — 프레젠테이션/보고서 모드에서 특히 인상적",
    difficulty: "Hard",
    tags: ["particle-system", "D3-force", "chart-transition", "WebGL"],
  },
  {
    id: 143,
    name: "Morphing Number Typography",
    category: "interaction",
    description: "Digits physically transform via SVG path morph (GSAP MorphSVGPlugin) or Framer Motion layoutId. '4' reshapes into '7'. Animation duration encodes change magnitude — larger deltas morph longer, giving intuitive volatility feel. Von Restorff effect.",
    applicability: "실시간 시세/포트폴리오 총액 변화에 '살아있는 숫자' 느낌 — 한글 통화 단위 레이아웃 주의",
    difficulty: "Hard",
    tags: ["SVG-morph", "GSAP", "typography", "Framer-Motion"],
  },
  {
    id: 144,
    name: "Layered Parallax Cards",
    category: "interaction",
    description: "Multi-layer depth cards: background + data + foreground label. Cursor position drives rotateX/Y + inverse translateX/Y on inner layers. 5-15deg max rotation avoids motion sickness. 'Window into depth' illusion via binocular disparity cues.",
    applicability: "자산/종목 카드에 탐색 재미 추가 — prefers-reduced-motion 대응 필수",
    difficulty: "Medium",
    tags: ["parallax", "3D-transform", "hover", "depth-illusion"],
  },
  {
    id: 145,
    name: "Aurora Borealis Header",
    category: "modern-css",
    description: "Stacked CSS gradients with offset background-position keyframes creating flowing emerald/teal/purple waves. Pure CSS via @property. 8-12s slow cycles below conscious attention but above 'static' threshold. Apple-inspired premium signal.",
    applicability: "대시보드 헤더/로그인 화면에 Apple급 프리미엄 느낌을 저비용 CSS 전용으로 구현",
    difficulty: "Easy",
    tags: ["aurora", "CSS-gradient", "hero-section", "Apple-design"],
  },
  {
    id: 146,
    name: "Tufte Data Ink Minimalism",
    category: "layout",
    description: "Every pixel serves data purpose — no gridlines, no axis chrome, no decorative borders. Sparklines inline with text, small multiples over complex charts. Typography hierarchy as sole organizational system. Maximum data-to-ink ratio.",
    applicability: "전문 투자자 대상 대시보드에 최적 — 데이터 밀도 높을수록 이 철학의 효과 극대화",
    difficulty: "Medium",
    tags: ["Tufte", "data-ink-ratio", "minimalism", "small-multiples"],
  },
  {
    id: 147,
    name: "Dark Mode Neon Accents",
    category: "layout",
    description: "Charcoal surfaces (#1a1a2e~#16213e) with 1-2 neon accents as micro-glows on key metrics. Neon as 'controlled energy' — badges/states, not backgrounds. box-shadow glow simulates luminescence (12:1+ contrast). 2025-2026 refined trend.",
    applicability: "트레이딩 대시보드에서 강력 — 빨강(상승)/파랑(하락) 컬러와 네온 조합으로 시각적 차별화",
    difficulty: "Easy",
    tags: ["dark-mode", "neon", "glow", "high-contrast"],
  },
  {
    id: 148,
    name: "Organic Blob Data Shapes",
    category: "dataviz",
    description: "Catmull-Rom splines or quadratic Bezier replacing sharp chart containers. Animated morphing between states via GSAP MorphSVGPlugin. Organic shapes signal 'approachable, human, alive' — softens financial data coldness. Stripe/Wise/Revolut aesthetic.",
    applicability: "자산 배분/리스크 영역에 파이차트 대안 — 정밀도보다 직관적 비율 파악 목적일 때 적합",
    difficulty: "Medium",
    tags: ["blob", "SVG-morph", "organic", "Bezier"],
  },
  {
    id: 149,
    name: "Typography-Driven Big Number Layout",
    category: "layout",
    description: "Oversized numbers (3-5rem+) as primary visual: KPI values occupy 60%+ card area. 'Big Number' pattern validated by Tableau/Power BI/Muzli. Serial position effect: first thing seen is remembered best. Charts become supplementary evidence.",
    applicability: "한글 폰트(Pretendard/SUIT) 숫자 글리프가 균일해서 대형 숫자 표현에 유리 — 원화 포맷과 가독성 극대화",
    difficulty: "Easy",
    tags: ["typography", "KPI-hero", "big-number", "Pretendard"],
  },
  {
    id: 150,
    name: "Cinematic Scroll Storytelling",
    category: "interaction",
    description: "GSAP ScrollTrigger master timeline: camera movements through 3D scenes, SplitText character staggers, layered parallax between WebGL canvas and overlay. Custom easing curves. Scroll as 'director's cut' — data unfolds cinematically. Awwwards SOTD pattern.",
    applicability: "연간 투자 리포트/시장 전망에 '스토리텔링 대시보드' — 프레젠테이션/마케팅 용도 ROI 높음",
    difficulty: "Hard",
    tags: ["GSAP-ScrollTrigger", "cinematic", "scroll-storytelling", "WebGL"],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function DifficultyBadge({ level }: { level: DesignItem["difficulty"] }) {
  const colors = {
    Easy: "bg-green-100 text-green-800 border-green-200",
    Medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    Hard: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[level]}`}>
      {level}
    </span>
  );
}

export default function DesignGalleryPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <section className="bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-900 px-4 py-8 text-white">
        <div className="container mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">100xFenok Admin</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Design Gallery</h1>
          <p className="mt-3 max-w-2xl text-sm text-white/80">
            금융 대시보드에 적용 가능한 {ITEMS.length}개 디자인 패턴. 카테고리별 탐색, 난이도 확인, 우리 시스템 적용 포인트 참조.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <a
                key={cat.key}
                href={`#cat-${cat.key}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                  {ITEMS.filter((i) => i.category === cat.key).length}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <div className="container mx-auto max-w-6xl px-4 py-6">
        {CATEGORIES.map((cat) => {
          const items = ITEMS.filter((i) => i.category === cat.key);
          if (items.length === 0) return null;
          return (
            <section key={cat.key} id={`cat-${cat.key}`} className="mb-8">
              <div className="mb-4 flex items-center gap-3">
                <span className={`inline-flex size-10 items-center justify-center rounded-xl bg-gradient-to-br ${cat.color} text-lg text-white shadow-sm`}>
                  {cat.icon}
                </span>
                <div>
                  <h2 className="text-xl font-black text-slate-900">{cat.label}</h2>
                  <p className="text-xs text-slate-500">{items.length} patterns</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        <span className="mr-1.5 text-xs text-slate-400">#{item.id}</span>
                        {item.name}
                      </h3>
                      <DifficultyBadge level={item.difficulty} />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{item.description}</p>
                    <div className="mt-3 rounded-lg bg-indigo-50 p-2.5">
                      <p className="text-[11px] font-semibold text-indigo-900">🎯 우리 시스템 적용</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-indigo-700">{item.applicability}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {item.reference && (
                      <a
                        href={item.reference}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-[10px] text-indigo-500 hover:underline"
                      >
                        Reference →
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Stats Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 py-6">
        <div className="container mx-auto max-w-6xl text-center">
          <p className="text-sm font-bold text-slate-700">
            Total: {ITEMS.length} patterns across {CATEGORIES.length} categories
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Continuously updated — 2026-03-13 audit
          </p>
        </div>
      </footer>
    </main>
  );
}
