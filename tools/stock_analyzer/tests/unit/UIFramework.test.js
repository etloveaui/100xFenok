/**
 * UIFramework 단위 테스트
 *
 * 테스트 범위:
 * - 컴포넌트 레지스트리
 * - 컴포넌트 팩토리
 * - 테마 시스템
 * - 반응형 레이아웃
 * - BaseComponent 생명주기
 * - 차트 컴포넌트 (Chart.js 통합)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import UIFramework from '../../core/UIFramework.js';
import EventSystem from '../../core/EventSystem.js';
import DataSkeleton from '../../core/DataSkeleton.js';

// Mock Chart.js
vi.mock('chart.js', () => ({
  Chart: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    update: vi.fn(),
    data: { datasets: [] }
  })),
  registerables: []
}));

describe('UIFramework', () => {
  let uiFramework;
  let eventSystem;
  let dataSkeleton;
  let container;

  beforeEach(() => {
    eventSystem = new EventSystem();
    dataSkeleton = new DataSkeleton();
    uiFramework = new UIFramework(eventSystem, dataSkeleton);

    // Mock Chart globally for Chart components
    global.Chart = vi.fn().mockImplementation((canvas, config) => ({
      destroy: vi.fn(),
      update: vi.fn(),
      data: config?.data || { datasets: [] },
      canvas: canvas,
      config: config
    }));

    // Create test container
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    delete global.Chart;
    vi.clearAllMocks();
  });

  // ========================================
  // 컴포넌트 레지스트리
  // ========================================
  describe('컴포넌트 레지스트리', () => {
    it('컴포넌트를 등록할 수 있어야 함', () => {
      class TestComponent {
        init() {}
        render() { return document.createElement('div'); }
      }

      uiFramework.registerComponent('Test', TestComponent);

      expect(uiFramework.componentRegistry.has('Test')).toBe(true);
    });

    it('등록된 컴포넌트를 조회할 수 있어야 함', () => {
      class TestComponent {
        init() {}
        render() { return document.createElement('div'); }
      }

      uiFramework.registerComponent('Test', TestComponent);
      const Component = uiFramework.componentRegistry.get('Test');

      expect(Component).toBe(TestComponent);
    });

    it('기본 컴포넌트들이 등록되어 있어야 함', () => {
      expect(uiFramework.componentRegistry.has('Chart.Line')).toBe(true);
      expect(uiFramework.componentRegistry.has('Chart.Bar')).toBe(true);
      expect(uiFramework.componentRegistry.has('Chart.Pie')).toBe(true);
      expect(uiFramework.componentRegistry.has('Table')).toBe(true);
      expect(uiFramework.componentRegistry.has('Filter.Range')).toBe(true);
    });
  });

  // ========================================
  // 컴포넌트 팩토리
  // ========================================
  describe('컴포넌트 팩토리', () => {
    it('컴포넌트를 생성할 수 있어야 함', () => {
      const component = uiFramework.createComponent('Table', {
        columns: ['name', 'age']
      });

      expect(component).toBeDefined();
      expect(component.config.columns).toEqual(['name', 'age']);
    });

    it('등록되지 않은 컴포넌트는 에러를 던져야 함', () => {
      expect(() => {
        uiFramework.createComponent('NonExistent');
      }).toThrow('컴포넌트를 찾을 수 없습니다: NonExistent');
    });

    it('컴포넌트에 프레임워크 참조가 주입되어야 함', () => {
      const component = uiFramework.createComponent('Table', {});

      expect(component.framework).toBe(uiFramework);
      expect(component.eventSystem).toBe(eventSystem);
      expect(component.dataSkeleton).toBe(dataSkeleton);
    });
  });

  // ========================================
  // 테마 시스템
  // ========================================
  describe('테마 시스템', () => {
    it('테마를 등록할 수 있어야 함', () => {
      const customTheme = {
        '--color-primary': '#ff0000',
        '--color-secondary': '#00ff00'
      };

      uiFramework.registerTheme('custom', customTheme);

      expect(uiFramework.themes.has('custom')).toBe(true);
    });

    it('테마를 적용할 수 있어야 함', () => {
      const lightTheme = {
        '--color-background': '#ffffff',
        '--color-text': '#000000'
      };

      uiFramework.registerTheme('light', lightTheme);
      uiFramework.applyTheme('light');

      const root = document.documentElement;
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('기본 테마가 있어야 함', () => {
      expect(uiFramework.themes.has('default')).toBe(true);
    });

    it('다크 모드가 있어야 함', () => {
      expect(uiFramework.themes.has('dark')).toBe(true);
    });

    it('테마 변경 시 이벤트가 발행되어야 함', async () => {
      const handler = vi.fn();
      eventSystem.on('ui:theme:changed', handler);

      uiFramework.applyTheme('dark');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            theme: 'dark'
          })
        })
      );
    });
  });

  // ========================================
  // BaseComponent 생명주기
  // ========================================
  describe('BaseComponent 생명주기', () => {
    it('init()이 호출되어야 함', async () => {
      const initSpy = vi.fn();

      class TestComponent {
        init() { initSpy(); }
        render() { return document.createElement('div'); }
      }

      uiFramework.registerComponent('Test', TestComponent);
      const component = uiFramework.createComponent('Test', {});

      await component.init();

      expect(initSpy).toHaveBeenCalled();
    });

    it('render()가 DOM 요소를 반환해야 함', () => {
      const component = uiFramework.createComponent('Table', {
        columns: ['name']
      });

      const element = component.render(container);

      expect(element).toBeInstanceOf(HTMLElement);
    });

    it('update() 시 재렌더링되어야 함', () => {
      const component = uiFramework.createComponent('Table', {
        data: [{ name: 'Alice' }]
      });

      component.render(container);
      component.config.data = [{ name: 'Bob' }];
      component.update();

      // Component should re-render with new data
      expect(component.element).toBeDefined();
    });

    it('destroy() 시 DOM에서 제거되어야 함', () => {
      const component = uiFramework.createComponent('Table', {});

      component.render(container);
      const element = component.element;

      component.destroy();

      expect(document.body.contains(element)).toBe(false);
    });
  });

  // ========================================
  // 반응형 레이아웃
  // ========================================
  describe('반응형 레이아웃', () => {
    it('반응형 breakpoint를 설정할 수 있어야 함', () => {
      const breakpoints = {
        mobile: 320,
        tablet: 768,
        desktop: 1024
      };

      uiFramework.setBreakpoints(breakpoints);

      expect(uiFramework.breakpoints).toEqual(breakpoints);
    });

    it('현재 breakpoint를 감지할 수 있어야 함', () => {
      const breakpoints = {
        mobile: 0,
        tablet: 768,
        desktop: 1024
      };

      uiFramework.setBreakpoints(breakpoints);

      // Mock window.innerWidth
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800
      });

      const currentBreakpoint = uiFramework.getCurrentBreakpoint();
      expect(currentBreakpoint).toBe('tablet');
    });

    it('반응형 레이아웃을 적용할 수 있어야 함', () => {
      const layouts = {
        mobile: { columns: 1 },
        tablet: { columns: 2 },
        desktop: { columns: 3 }
      };

      const layout = uiFramework.createResponsiveLayout(container, layouts);

      expect(layout.element).toBe(container);
      expect(layout.layouts).toEqual(layouts);
    });
  });

  // ========================================
  // 테이블 컴포넌트
  // ========================================
  describe('테이블 컴포넌트', () => {
    it('테이블을 생성할 수 있어야 함', () => {
      const table = uiFramework.createComponent('Table', {
        columns: ['name', 'age'],
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 }
        ]
      });

      const element = table.render(container);

      expect(element.tagName).toBe('TABLE');
      expect(element.querySelectorAll('thead th')).toHaveLength(2);
      expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    });

    it('컬럼 정렬을 지원해야 함', () => {
      const table = uiFramework.createComponent('Table', {
        columns: ['name', 'age'],
        data: [
          { name: 'Bob', age: 25 },
          { name: 'Alice', age: 30 }
        ],
        sortable: true
      });

      table.render(container);
      table.sort('name', 'asc');

      expect(table.getSortedData()[0].name).toBe('Alice');
    });

    it('페이징을 지원해야 함', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`
      }));

      const table = uiFramework.createComponent('Table', {
        columns: ['id', 'name'],
        data,
        pageSize: 10
      });

      table.render(container);

      expect(table.getCurrentPageData()).toHaveLength(10);
    });
  });

  // ========================================
  // 필터 컴포넌트
  // ========================================
  describe('필터 컴포넌트', () => {
    it('Range 필터를 생성할 수 있어야 함', () => {
      const filter = uiFramework.createComponent('Filter.Range', {
        field: 'price',
        min: 0,
        max: 1000,
        step: 10
      });

      const element = filter.render(container);

      expect(element).toBeDefined();
      expect(filter.config.field).toBe('price');
    });

    it('Select 필터를 생성할 수 있어야 함', () => {
      const filter = uiFramework.createComponent('Filter.Select', {
        field: 'category',
        options: ['tech', 'finance', 'healthcare']
      });

      const element = filter.render(container);

      expect(element.tagName).toBe('SELECT');
      expect(element.querySelectorAll('option')).toHaveLength(3);
    });

    it('Search 필터를 생성할 수 있어야 함', () => {
      const filter = uiFramework.createComponent('Filter.Search', {
        fields: ['name', 'ticker'],
        placeholder: 'Search...'
      });

      const element = filter.render(container);

      expect(element.tagName).toBe('INPUT');
      expect(element.getAttribute('type')).toBe('search');
    });

    it('필터 변경 시 이벤트가 발행되어야 함', async () => {
      const handler = vi.fn();
      eventSystem.on('ui:filter:changed', handler);

      const filter = uiFramework.createComponent('Filter.Range', {
        field: 'price',
        min: 0,
        max: 1000
      });

      filter.render(container);
      filter.setValue(500);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalled();
    });
  });

  // ========================================
  // 레이아웃 컴포넌트
  // ========================================
  describe('레이아웃 컴포넌트', () => {
    it('Grid 레이아웃을 생성할 수 있어야 함', () => {
      const grid = uiFramework.createComponent('Layout.Grid', {
        columns: 3,
        gap: '20px'
      });

      const element = grid.render(container);

      expect(element.style.display).toBe('grid');
      expect(element.style.gridTemplateColumns).toContain('3');
    });

    it('Flex 레이아웃을 생성할 수 있어야 함', () => {
      const flex = uiFramework.createComponent('Layout.Flex', {
        direction: 'row',
        justify: 'space-between',
        align: 'center'
      });

      const element = flex.render(container);

      expect(element.style.display).toBe('flex');
      expect(element.style.flexDirection).toBe('row');
    });

    it('Responsive 레이아웃을 생성할 수 있어야 함', () => {
      const responsive = uiFramework.createComponent('Layout.Responsive', {
        layouts: {
          mobile: { columns: 1 },
          tablet: { columns: 2 },
          desktop: { columns: 3 }
        }
      });

      const element = responsive.render(container);

      expect(element).toBeDefined();
    });
  });

  // ========================================
  // 카드 컴포넌트
  // ========================================
  describe('카드 컴포넌트', () => {
    it('Card를 생성할 수 있어야 함', () => {
      const card = uiFramework.createComponent('Card', {
        title: 'Test Card',
        content: 'Card content here'
      });

      const element = card.render(container);

      expect(element.classList.contains('card')).toBe(true);
      expect(element.querySelector('.card-title').textContent).toBe('Test Card');
    });

    it('통계 카드를 생성할 수 있어야 함', () => {
      const statCard = uiFramework.createComponent('Card.Stat', {
        label: 'Total Revenue',
        value: '$1,234,567',
        change: '+12.5%',
        trend: 'up'
      });

      const element = statCard.render(container);

      expect(element.querySelector('.stat-value').textContent).toBe('$1,234,567');
      expect(element.querySelector('.stat-change').textContent).toBe('+12.5%');
    });
  });

  // ========================================
  // 차트 컴포넌트 (Chart.js 통합)
  // ========================================
  describe('차트 컴포넌트', () => {
    it('Line 차트를 생성할 수 있어야 함', () => {
      const chart = uiFramework.createComponent('Chart.Line', {
        labels: ['Jan', 'Feb', 'Mar'],
        datasets: [{
          label: 'Sales',
          data: [100, 200, 150]
        }]
      });

      const element = chart.render(container);

      expect(element.tagName).toBe('CANVAS');
    });

    it('Bar 차트를 생성할 수 있어야 함', () => {
      const chart = uiFramework.createComponent('Chart.Bar', {
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        datasets: [{
          label: 'Revenue',
          data: [1000, 1500, 1200, 1800]
        }]
      });

      const element = chart.render(container);

      expect(element.tagName).toBe('CANVAS');
    });

    it('Pie 차트를 생성할 수 있어야 함', () => {
      const chart = uiFramework.createComponent('Chart.Pie', {
        labels: ['Tech', 'Finance', 'Healthcare'],
        datasets: [{
          data: [30, 40, 30]
        }]
      });

      const element = chart.render(container);

      expect(element.tagName).toBe('CANVAS');
    });

    it('차트 업데이트가 작동해야 함', () => {
      const chart = uiFramework.createComponent('Chart.Line', {
        labels: ['A', 'B'],
        datasets: [{ data: [1, 2] }]
      });

      chart.render(container);
      chart.updateData({
        labels: ['A', 'B', 'C'],
        datasets: [{ data: [1, 2, 3] }]
      });

      expect(chart.chartInstance.update).toHaveBeenCalled();
    });

    it('차트 파괴가 작동해야 함', () => {
      const chart = uiFramework.createComponent('Chart.Line', {
        labels: ['A', 'B'],
        datasets: [{ data: [1, 2] }]
      });

      chart.render(container);
      chart.destroy();

      expect(chart.chartInstance.destroy).toHaveBeenCalled();
    });
  });

  // ========================================
  // 유틸리티
  // ========================================
  describe('유틸리티', () => {
    it('컴포넌트 목록을 조회할 수 있어야 함', () => {
      const components = uiFramework.listComponents();

      expect(components.length).toBeGreaterThan(0);
      expect(components).toContain('Table');
      expect(components).toContain('Chart.Line');
    });

    it('통계 정보를 조회할 수 있어야 함', () => {
      uiFramework.createComponent('Table', {});
      uiFramework.createComponent('Chart.Line', {});

      const stats = uiFramework.getStats();

      expect(stats).toHaveProperty('componentCount');
      expect(stats).toHaveProperty('themeCount');
    });

    it('CSS 클래스를 생성할 수 있어야 함', () => {
      const classes = uiFramework.createClasses([
        'card',
        'card--primary',
        { 'card--active': true },
        { 'card--disabled': false }
      ]);

      expect(classes).toBe('card card--primary card--active');
    });
  });

  // ========================================
  // 복잡한 시나리오
  // ========================================
  describe('복잡한 시나리오', () => {
    it('DataSkeleton 데이터를 테이블에 표시해야 함', async () => {
      await dataSkeleton.store([
        { ticker: 'AAPL', price: 150 },
        { ticker: 'GOOGL', price: 2800 }
      ]);

      const table = uiFramework.createComponent('Table', {
        columns: ['ticker', 'price'],
        dataSource: 'dataSkeleton'
      });

      table.render(container);

      expect(table.config.data).toHaveLength(2);
    });

    it('필터 + 테이블 통합이 작동해야 함', async () => {
      await dataSkeleton.store([
        { ticker: 'AAPL', price: 150, sector: 'tech' },
        { ticker: 'JPM', price: 140, sector: 'finance' },
        { ticker: 'GOOGL', price: 2800, sector: 'tech' }
      ]);

      const filter = uiFramework.createComponent('Filter.Select', {
        field: 'sector',
        options: ['tech', 'finance']
      });

      const table = uiFramework.createComponent('Table', {
        columns: ['ticker', 'price', 'sector'],
        dataSource: 'dataSkeleton'
      });

      filter.render(container);
      table.render(container);

      filter.setValue('tech');

      // Filter should update table data
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(table.getFilteredData().every(r => r.sector === 'tech')).toBe(true);
    });

    it('테마 변경 시 모든 컴포넌트가 업데이트되어야 함', () => {
      const card1 = uiFramework.createComponent('Card', { title: 'Card 1' });
      const card2 = uiFramework.createComponent('Card', { title: 'Card 2' });

      card1.render(container);
      card2.render(container);

      uiFramework.applyTheme('dark');

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
