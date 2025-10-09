/**
 * E2E 통합 테스트 - 전체 워크플로우 검증
 *
 * 테스트 시나리오:
 * 1. CSV 데이터 로드 → DataSkeleton 파싱
 * 2. UI 컴포넌트 생성 (Table, Chart, Filter)
 * 3. 이벤트 기반 통합 작동 검증
 * 4. 30초 데이터 교체 파이프라인
 * 5. 테마 및 반응형 시스템
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import DataSkeleton from '../../core/DataSkeleton.js';
import EventSystem from '../../core/EventSystem.js';
import UIFramework from '../../core/UIFramework.js';

// CSV 문자열을 객체 배열로 파싱하는 헬퍼 함수
function parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    const headers = lines[0].split(',');

    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, index) => {
            const value = values[index].trim();
            // 숫자로 변환 시도
            obj[header.trim()] = isNaN(value) ? value : parseFloat(value);
        });
        return obj;
    });
}

describe('E2E: 전체 워크플로우 통합 테스트', () => {
    let eventSystem;
    let dataSkeleton;
    let uiFramework;
    let container;

    // 실제 주식 데이터 샘플 (CSV 형식)
    const sampleStockCSV = `ticker,name,sector,price,volume,market_cap
AAPL,Apple Inc,Technology,150.25,50000000,2500000000000
MSFT,Microsoft Corp,Technology,380.50,30000000,2800000000000
GOOGL,Alphabet Inc,Technology,140.75,25000000,1800000000000
TSLA,Tesla Inc,Automotive,245.00,80000000,750000000000
JPM,JPMorgan Chase,Financial,155.30,20000000,450000000000
BAC,Bank of America,Financial,32.50,60000000,250000000000
JNJ,Johnson & Johnson,Healthcare,165.80,15000000,425000000000
PFE,Pfizer Inc,Healthcare,28.90,40000000,160000000000`;

    beforeEach(() => {
        // 전역 시스템 초기화
        eventSystem = new EventSystem();
        dataSkeleton = new DataSkeleton();
        uiFramework = new UIFramework(eventSystem, dataSkeleton);

        // Chart.js mock
        global.Chart = vi.fn().mockImplementation((canvas, config) => ({
            destroy: vi.fn(),
            update: vi.fn((mode) => { /* 차트 업데이트 */ }),
            data: config?.data || { datasets: [] },
            canvas: canvas,
            config: config
        }));

        // DOM 컨테이너
        container = document.createElement('div');
        container.id = 'app-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
        delete global.Chart;
        vi.clearAllMocks();
        eventSystem.clearAllSubscriptions();
        eventSystem.clearQueue();
    });

    describe('시나리오 1: CSV 로드 → 테이블 렌더링', () => {
        it('CSV 데이터를 로드하고 테이블에 표시해야 함', async () => {
            // 1. CSV 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 데이터 검증
            const allData = dataSkeleton.query();
            expect(allData).toHaveLength(8);
            expect(allData[0].ticker).toBe('AAPL');
            expect(allData[0].price).toBe(150.25);

            // 2. 테이블 컴포넌트 생성
            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price'],
                pagination: { pageSize: 5, enabled: true }
            });

            const tableElement = table.render();
            container.appendChild(tableElement);

            // 테이블 검증
            expect(tableElement.tagName).toBe('TABLE');
            expect(tableElement.querySelectorAll('thead tr').length).toBeGreaterThan(0);

            // 현재 페이지 데이터 확인
            const currentPageData = table.getCurrentPageData();
            expect(currentPageData).toBeDefined();
            expect(Array.isArray(currentPageData)).toBe(true);
            expect(currentPageData.length).toBeGreaterThan(0);
            expect(currentPageData[0].ticker).toBe('AAPL');

            // 전체 데이터 접근 가능 확인
            const allTableData = table.getFilteredData();
            expect(allTableData).toHaveLength(8);
        });

        it('스키마 자동 감지가 올바르게 작동해야 함', async () => {
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            const schema = dataSkeleton.getSchema();
            expect(schema).toBeDefined();
            expect(schema.fields).toBeDefined();

            // 필드 타입 검증
            const tickerField = schema.fields.find(f => f.name === 'ticker');
            const priceField = schema.fields.find(f => f.name === 'price');

            expect(tickerField.type).toBe('string');
            expect(priceField.type).toBe('number');
            expect(tickerField.unique).toBe(true); // ticker는 unique
        });
    });

    describe('시나리오 2: 필터 + 테이블 통합', () => {
        it('필터 변경 시 테이블이 자동으로 업데이트되어야 함', async () => {
            // 1. 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 2. 테이블 생성
            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price']
            });

            // 3. 필터 생성 (sector 필드)
            const filter = uiFramework.createComponent('Filter.Select', {
                field: 'sector',
                options: ['Technology', 'Financial', 'Healthcare', 'Automotive']
            });

            container.appendChild(filter.render());
            container.appendChild(table.render());

            // 4. 필터 적용 (Technology 선택)
            eventSystem.emit('ui:filter:changed', {
                field: 'sector',
                value: 'Technology'
            }, { async: false });

            // 5. 테이블 필터링 확인
            const filteredData = table.getFilteredData();
            expect(filteredData).toHaveLength(3); // AAPL, MSFT, GOOGL
            expect(filteredData.every(row => row.sector === 'Technology')).toBe(true);

            // 6. 필터 해제 (빈 문자열)
            eventSystem.emit('ui:filter:changed', {
                field: 'sector',
                value: ''
            }, { async: false });

            // getFilteredData()는 항상 배열 반환 (config.data fallback)
            expect(table.currentFilter).toBeNull(); // currentFilter는 null
            expect(table.getFilteredData()).toHaveLength(8); // 전체 데이터로 복귀
        });

        it('여러 필터가 순차적으로 적용되어야 함', async () => {
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price']
            });

            container.appendChild(table.render());

            // Technology 필터
            eventSystem.emit('ui:filter:changed', {
                field: 'sector',
                value: 'Technology'
            }, { async: false });

            let filtered = table.getFilteredData();
            expect(filtered).toHaveLength(3);

            // Financial 필터로 변경
            eventSystem.emit('ui:filter:changed', {
                field: 'sector',
                value: 'Financial'
            }, { async: false });

            filtered = table.getFilteredData();
            expect(filtered).toHaveLength(2); // JPM, BAC
            expect(filtered.every(row => row.sector === 'Financial')).toBe(true);
        });
    });

    describe('시나리오 3: 차트 + 데이터 통합', () => {
        it('데이터를 로드하고 차트로 시각화해야 함', async () => {
            // 1. 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));
            const data = dataSkeleton.query();

            // 2. 차트 데이터 변환
            const chartData = {
                labels: data.map(row => row.ticker),
                datasets: [{
                    label: 'Stock Prices',
                    data: data.map(row => row.price),
                    backgroundColor: 'rgba(54, 162, 235, 0.5)'
                }]
            };

            // 3. 차트 생성
            const chart = uiFramework.createComponent('Chart.Bar', {
                data: chartData,
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });

            const chartElement = chart.render();
            container.appendChild(chartElement);

            // 4. 차트 검증
            expect(chartElement.tagName).toBe('CANVAS');
            expect(chart.chartInstance).toBeDefined();
            expect(chart.chartInstance.data.labels).toHaveLength(8);
            expect(chart.chartInstance.data.datasets[0].data[0]).toBe(150.25); // AAPL
        });

        it('필터 적용 시 차트도 업데이트되어야 함', async () => {
            // 1. 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 2. 초기 차트 생성
            const allData = dataSkeleton.query();
            let chartData = {
                labels: allData.map(row => row.ticker),
                datasets: [{
                    label: 'All Stocks',
                    data: allData.map(row => row.price)
                }]
            };

            const chart = uiFramework.createComponent('Chart.Line', {
                data: chartData
            });

            container.appendChild(chart.render());

            // 초기 데이터 확인
            expect(chart.chartInstance.data.labels).toHaveLength(8);

            // 3. Technology 섹터 필터링
            const techData = dataSkeleton.query({
                filter: { sector: 'Technology' }
            });

            // 4. 차트 데이터 업데이트
            const updatedChartData = {
                labels: techData.map(row => row.ticker),
                datasets: [{
                    label: 'Technology Stocks',
                    data: techData.map(row => row.price)
                }]
            };

            chart.updateData(updatedChartData);

            // 5. 업데이트 확인
            expect(chart.chartInstance.data.labels).toHaveLength(3);
            expect(chart.chartInstance.data.labels).toEqual(['AAPL', 'MSFT', 'GOOGL']);
            expect(chart.chartInstance.update).toHaveBeenCalled();
        });
    });

    describe('시나리오 4: 30초 데이터 교체 파이프라인', () => {
        it('새 CSV 데이터로 교체 시 모든 컴포넌트가 업데이트되어야 함', async () => {
            // 1. 초기 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 2. 컴포넌트 생성
            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price']
            });

            container.appendChild(table.render());

            // 초기 데이터 확인
            expect(dataSkeleton.query()).toHaveLength(8);
            expect(table.getCurrentPageData()[0].ticker).toBe('AAPL');

            // 3. 새 CSV 데이터 (업데이트된 가격)
            const updatedCSV = `ticker,name,sector,price,volume,market_cap
AAPL,Apple Inc,Technology,155.00,52000000,2550000000000
MSFT,Microsoft Corp,Technology,385.00,31000000,2850000000000
GOOGL,Alphabet Inc,Technology,145.00,26000000,1850000000000`;

            // 4. 데이터 교체 리스너 설정
            let dataUpdated = false;
            dataSkeleton.subscribe((event) => {
                if (event.type === 'data:updated') {
                    dataUpdated = true;
                }
            }, { events: ['data:updated'] });

            // 5. 데이터 교체 실행
            await dataSkeleton.replaceWeeklyData(parseCSV(updatedCSV));

            // 6. 검증
            expect(dataUpdated).toBe(true); // 이벤트 발행 확인
            expect(dataSkeleton.query()).toHaveLength(3); // 새 데이터로 교체됨

            const newData = dataSkeleton.query();
            expect(newData[0].price).toBe(155.00); // AAPL 가격 업데이트
            expect(newData[1].price).toBe(385.00); // MSFT 가격 업데이트
        });

        it('데이터 교체 시 구독자들에게 알림이 가야 함', async () => {
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 여러 구독자 설정
            const notifications = [];

            dataSkeleton.subscribe((event) => {
                notifications.push({ type: event.type, payload: event });
            }, { events: ['data:updated'] });

            // 새 데이터 로드
            const newCSV = `ticker,name,price
AAPL,Apple,160.00
MSFT,Microsoft,390.00`;

            await dataSkeleton.replaceWeeklyData(parseCSV(newCSV));

            // 알림 확인
            expect(notifications.length).toBeGreaterThan(0);

            const updateEvent = notifications.find(n => n.type === 'data:updated');
            expect(updateEvent).toBeDefined();
        });
    });

    describe('시나리오 5: 테마 시스템 통합', () => {
        it('테마 변경 시 CSS 변수가 업데이트되어야 함', () => {
            // 1. 초기 테마 (default/light)
            uiFramework.applyTheme('light');

            // CSS 변수 확인
            let primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--color-primary').trim();
            expect(primaryColor).toBe('#2563eb');

            // 2. Dark 테마로 변경
            uiFramework.applyTheme('dark');

            primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--color-primary').trim();
            expect(primaryColor).toBe('#3b82f6');
        });

        it('테마 변경 이벤트가 발행되어야 함', () => {
            const themeChanges = [];

            eventSystem.on('ui:theme:changed', (event) => {
                themeChanges.push(event.payload.theme);
            });

            uiFramework.applyTheme('light');
            uiFramework.applyTheme('dark');
            uiFramework.applyTheme('default');

            expect(themeChanges).toEqual(['light', 'dark', 'default']);
        });
    });

    describe('시나리오 6: 반응형 레이아웃', () => {
        it('브레이크포인트에 따라 레이아웃이 변경되어야 함', () => {
            // 1. 반응형 브레이크포인트 설정
            uiFramework.setBreakpoints({
                mobile: 768,
                tablet: 1024,
                desktop: 1440,
                wide: 1920
            });

            // 2. 모바일 해상도 (600px) - < 768
            global.window.innerWidth = 600;
            let breakpoint = uiFramework.getCurrentBreakpoint();
            expect(breakpoint).toBe('mobile');

            // 3. 태블릿 해상도 (1100px) - >= 1024
            global.window.innerWidth = 1100;
            breakpoint = uiFramework.getCurrentBreakpoint();
            expect(breakpoint).toBe('tablet');

            // 4. 데스크톱 해상도 (1600px) - >= 1440
            global.window.innerWidth = 1600;
            breakpoint = uiFramework.getCurrentBreakpoint();
            expect(breakpoint).toBe('desktop');

            // 5. 와이드 해상도 (2000px) - >= 1920
            global.window.innerWidth = 2000;
            breakpoint = uiFramework.getCurrentBreakpoint();
            expect(breakpoint).toBe('wide');
        });

        it('반응형 레이아웃을 생성할 수 있어야 함', async () => {
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'price']
            });

            // 반응형 레이아웃 생성
            const layout = uiFramework.createResponsiveLayout(container, {
                mobile: { columns: 1 },
                tablet: { columns: 2 },
                desktop: { columns: 3 }
            });

            // layout.element는 container이므로 container에 직접 추가
            container.appendChild(table.render());

            expect(layout).toBeDefined();
            expect(layout.element).toBe(container);
            expect(container.children.length).toBeGreaterThan(0);
        });
    });

    describe('시나리오 7: 복합 워크플로우 (전체 통합)', () => {
        it('전체 시스템이 함께 작동해야 함 (CSV → Filter → Table → Chart → Theme)', async () => {
            // 1. 데이터 로드
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));
            expect(dataSkeleton.query()).toHaveLength(8);

            // 2. 테마 적용
            uiFramework.applyTheme('dark');

            // 3. 필터 생성
            const filter = uiFramework.createComponent('Filter.Select', {
                field: 'sector',
                options: ['Technology', 'Financial', 'Healthcare']
            });

            // 4. 테이블 생성
            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price'],
                pagination: { pageSize: 5, enabled: true }
            });

            // 5. 차트 생성
            const allData = dataSkeleton.query();
            const chart = uiFramework.createComponent('Chart.Bar', {
                data: {
                    labels: allData.map(row => row.ticker),
                    datasets: [{
                        label: 'Prices',
                        data: allData.map(row => row.price)
                    }]
                }
            });

            // 6. DOM에 추가
            container.appendChild(filter.render());
            container.appendChild(table.render());
            container.appendChild(chart.render());

            // 7. 필터 적용 → Technology
            eventSystem.emit('ui:filter:changed', {
                field: 'sector',
                value: 'Technology'
            }, { async: false });

            // 8. 필터링 결과 확인
            const filtered = table.getFilteredData();
            expect(filtered).toHaveLength(3);
            expect(filtered.every(row => row.sector === 'Technology')).toBe(true);

            // 9. 차트 업데이트
            const techData = dataSkeleton.query({
                filter: { sector: 'Technology' }
            });

            chart.updateData({
                labels: techData.map(row => row.ticker),
                datasets: [{
                    label: 'Technology Prices',
                    data: techData.map(row => row.price)
                }]
            });

            expect(chart.chartInstance.data.labels).toHaveLength(3);
            expect(chart.chartInstance.update).toHaveBeenCalled();

            // 10. 테마 변경 확인
            const primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--color-primary').trim();
            expect(primaryColor).toBe('#3b82f6'); // dark theme
        });
    });

    describe('시나리오 8: 에러 처리 및 복구', () => {
        it('잘못된 CSV 데이터를 처리해야 함', async () => {
            const invalidCSV = `ticker,name,price
AAPL,Apple,invalid_price
MSFT,Microsoft,200`;

            await dataSkeleton.replaceWeeklyData(parseCSV(invalidCSV));

            // 데이터 정제 후 검증
            const data = dataSkeleton.query();
            expect(data.length).toBeGreaterThanOrEqual(1);

            // MSFT는 유효한 데이터로 존재해야 함
            const msftData = data.find(row => row.ticker === 'MSFT');
            expect(msftData).toBeDefined();
            expect(msftData.price).toBe(200);
        });

        it('이벤트 핸들러 에러가 격리되어야 함', () => {
            let handler1Called = false;
            let handler2Called = false;

            eventSystem.on('test:event', () => {
                handler1Called = true;
                throw new Error('Handler 1 error');
            });

            eventSystem.on('test:event', () => {
                handler2Called = true;
            });

            // 에러 핸들러 등록
            let errorCaught = false;
            eventSystem.onError(() => {
                errorCaught = true;
            });

            eventSystem.emit('test:event', {}, { async: false });

            // 두 핸들러 모두 실행되어야 함 (에러 격리)
            expect(handler1Called).toBe(true);
            expect(handler2Called).toBe(true);
            expect(errorCaught).toBe(true);
        });
    });

    describe('시나리오 9: 성능 및 메모리', () => {
        it('대량 쿼리가 정상적으로 작동해야 함', async () => {
            // 100개의 쿼리 실행
            await dataSkeleton.replaceWeeklyData(parseCSV(sampleStockCSV));

            // 여러 번 쿼리 실행해도 정상 작동 확인
            for (let i = 0; i < 100; i++) {
                const result = dataSkeleton.query({
                    filter: { sector: i % 2 === 0 ? 'Technology' : 'Financial' }
                });

                // 쿼리 결과가 유효한지 확인
                expect(Array.isArray(result)).toBe(true);
                if (i % 2 === 0) {
                    // Technology 쿼리
                    expect(result.every(row => row.sector === 'Technology')).toBe(true);
                } else {
                    // Financial 쿼리
                    expect(result.every(row => row.sector === 'Financial')).toBe(true);
                }
            }

            // 데이터 일관성 확인
            const finalData = dataSkeleton.query();
            expect(finalData).toHaveLength(8);
        });

        it('이벤트 히스토리가 크기 제한을 준수해야 함', () => {
            eventSystem.maxHistorySize = 10;

            // 20개 이벤트 발행
            for (let i = 0; i < 20; i++) {
                eventSystem.emit(`test:event:${i}`, { index: i }, { async: false });
            }

            const history = eventSystem.getHistory();
            expect(history.length).toBeLessThanOrEqual(10);
        });
    });
});
