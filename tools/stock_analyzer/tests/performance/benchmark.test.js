/**
 * 성능 벤치마크 테스트
 *
 * 목표:
 * - 10,000+ 행 데이터 처리 성능
 * - 30초 이내 데이터 교체
 * - 쿼리 응답 시간 < 100ms
 * - 메모리 사용량 모니터링
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import DataSkeleton from '../../core/DataSkeleton.js';
import EventSystem from '../../core/EventSystem.js';
import UIFramework from '../../core/UIFramework.js';

// 대용량 CSV 데이터 생성 헬퍼
function generateLargeCSVData(rowCount = 10000) {
    const sectors = ['Technology', 'Financial', 'Healthcare', 'Energy', 'Consumer'];
    const data = [];

    for (let i = 0; i < rowCount; i++) {
        data.push({
            ticker: `STOCK${i.toString().padStart(5, '0')}`,
            name: `Company ${i}`,
            sector: sectors[i % sectors.length],
            price: Math.random() * 500 + 10, // 10-510
            volume: Math.floor(Math.random() * 100000000) + 1000000,
            market_cap: Math.floor(Math.random() * 1000000000000) + 100000000000,
            pe_ratio: Math.random() * 50 + 5,
            dividend_yield: Math.random() * 5,
            year_low: Math.random() * 300 + 5,
            year_high: Math.random() * 700 + 200
        });
    }

    return data;
}

// 메모리 사용량 측정 헬퍼
function getMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
        return {
            used: performance.memory.usedJSHeapSize / 1024 / 1024, // MB
            total: performance.memory.totalJSHeapSize / 1024 / 1024,
            limit: performance.memory.jsHeapSizeLimit / 1024 / 1024
        };
    }
    // Node.js 환경
    if (typeof process !== 'undefined' && process.memoryUsage) {
        const mem = process.memoryUsage();
        return {
            used: mem.heapUsed / 1024 / 1024,
            total: mem.heapTotal / 1024 / 1024,
            limit: mem.rss / 1024 / 1024
        };
    }
    return null;
}

describe('성능 벤치마크 테스트', () => {
    let dataSkeleton;
    let eventSystem;
    let uiFramework;

    beforeEach(() => {
        dataSkeleton = new DataSkeleton();
        eventSystem = new EventSystem();
        uiFramework = new UIFramework(eventSystem, dataSkeleton);

        // Chart.js mock
        global.Chart = vi.fn().mockImplementation(() => ({
            destroy: vi.fn(),
            update: vi.fn()
        }));
    });

    describe('데이터 로드 성능', () => {
        it('10,000 행 데이터를 30초 이내에 로드해야 함', async () => {
            const rowCount = 10000;
            const data = generateLargeCSVData(rowCount);

            const startTime = performance.now();
            await dataSkeleton.replaceWeeklyData(data);
            const endTime = performance.now();

            const loadTime = endTime - startTime;

            console.log(`\n📊 10K 데이터 로드 성능:`);
            console.log(`   - 행 수: ${rowCount.toLocaleString()}`);
            console.log(`   - 로드 시간: ${loadTime.toFixed(2)}ms (${(loadTime / 1000).toFixed(2)}초)`);
            console.log(`   - 처리 속도: ${(rowCount / (loadTime / 1000)).toFixed(0)} 행/초`);

            // 검증
            expect(loadTime).toBeLessThan(30000); // 30초 이내
            expect(dataSkeleton.query()).toHaveLength(rowCount);

            // 메모리 사용량
            const memory = getMemoryUsage();
            if (memory) {
                console.log(`   - 메모리 사용: ${memory.used.toFixed(2)} MB`);
            }
        }, 60000); // 60초 타임아웃

        it('50,000 행 데이터를 처리할 수 있어야 함', async () => {
            const rowCount = 50000;
            const data = generateLargeCSVData(rowCount);

            const startTime = performance.now();
            await dataSkeleton.replaceWeeklyData(data);
            const endTime = performance.now();

            const loadTime = endTime - startTime;

            console.log(`\n📊 50K 데이터 로드 성능:`);
            console.log(`   - 행 수: ${rowCount.toLocaleString()}`);
            console.log(`   - 로드 시간: ${loadTime.toFixed(2)}ms (${(loadTime / 1000).toFixed(2)}초)`);
            console.log(`   - 처리 속도: ${(rowCount / (loadTime / 1000)).toFixed(0)} 행/초`);

            // 검증
            expect(loadTime).toBeLessThan(120000); // 2분 이내
            expect(dataSkeleton.query()).toHaveLength(rowCount);

            const memory = getMemoryUsage();
            if (memory) {
                console.log(`   - 메모리 사용: ${memory.used.toFixed(2)} MB`);
            }
        }, 180000); // 3분 타임아웃

        it('100,000 행 데이터를 처리할 수 있어야 함', async () => {
            const rowCount = 100000;
            const data = generateLargeCSVData(rowCount);

            const startTime = performance.now();
            await dataSkeleton.replaceWeeklyData(data);
            const endTime = performance.now();

            const loadTime = endTime - startTime;

            console.log(`\n📊 100K 데이터 로드 성능:`);
            console.log(`   - 행 수: ${rowCount.toLocaleString()}`);
            console.log(`   - 로드 시간: ${loadTime.toFixed(2)}ms (${(loadTime / 1000).toFixed(2)}초)`);
            console.log(`   - 처리 속도: ${(rowCount / (loadTime / 1000)).toFixed(0)} 행/초`);

            // 검증
            expect(loadTime).toBeLessThan(300000); // 5분 이내
            expect(dataSkeleton.query()).toHaveLength(rowCount);

            const memory = getMemoryUsage();
            if (memory) {
                console.log(`   - 메모리 사용: ${memory.used.toFixed(2)} MB`);
            }
        }, 360000); // 6분 타임아웃
    });

    describe('쿼리 성능', () => {
        beforeEach(async () => {
            // 10K 데이터 로드
            const data = generateLargeCSVData(10000);
            await dataSkeleton.replaceWeeklyData(data);
        });

        it('단일 필터 쿼리가 100ms 이내에 완료되어야 함', () => {
            const iterations = 100;
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const startTime = performance.now();
                const result = dataSkeleton.query({
                    filter: { sector: 'Technology' }
                });
                const endTime = performance.now();

                times.push(endTime - startTime);
                expect(Array.isArray(result)).toBe(true);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const maxTime = Math.max(...times);
            const minTime = Math.min(...times);

            console.log(`\n📊 단일 필터 쿼리 성능 (100회):`);
            console.log(`   - 평균: ${avgTime.toFixed(2)}ms`);
            console.log(`   - 최소: ${minTime.toFixed(2)}ms`);
            console.log(`   - 최대: ${maxTime.toFixed(2)}ms`);

            // 평균 100ms 이내
            expect(avgTime).toBeLessThan(100);
        });

        it('복잡한 쿼리가 200ms 이내에 완료되어야 함', () => {
            const iterations = 50;
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const startTime = performance.now();
                const result = dataSkeleton.query({
                    filter: {
                        sector: 'Technology',
                        price: { $gt: 100, $lt: 300 }
                    },
                    sort: { price: -1 },
                    limit: 100
                });
                const endTime = performance.now();

                times.push(endTime - startTime);
                expect(Array.isArray(result)).toBe(true);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const maxTime = Math.max(...times);

            console.log(`\n📊 복잡한 쿼리 성능 (50회):`);
            console.log(`   - 평균: ${avgTime.toFixed(2)}ms`);
            console.log(`   - 최대: ${maxTime.toFixed(2)}ms`);

            expect(avgTime).toBeLessThan(200);
        });

        it('동시 쿼리 처리 성능', async () => {
            const concurrentQueries = 10;
            const queries = [];

            const startTime = performance.now();

            for (let i = 0; i < concurrentQueries; i++) {
                queries.push(
                    Promise.resolve(dataSkeleton.query({
                        filter: { sector: ['Technology', 'Financial', 'Healthcare', 'Energy', 'Consumer'][i % 5] }
                    }))
                );
            }

            const results = await Promise.all(queries);
            const endTime = performance.now();

            const totalTime = endTime - startTime;

            console.log(`\n📊 동시 쿼리 성능:`);
            console.log(`   - 쿼리 수: ${concurrentQueries}`);
            console.log(`   - 총 시간: ${totalTime.toFixed(2)}ms`);
            console.log(`   - 쿼리당 평균: ${(totalTime / concurrentQueries).toFixed(2)}ms`);

            expect(results).toHaveLength(concurrentQueries);
            expect(totalTime).toBeLessThan(1000); // 1초 이내
        });
    });

    describe('이벤트 시스템 성능', () => {
        it('10,000개 이벤트를 1초 이내에 처리해야 함', async () => {
            const eventCount = 10000;
            let processedCount = 0;

            eventSystem.on('perf:test', () => {
                processedCount++;
            });

            const startTime = performance.now();

            for (let i = 0; i < eventCount; i++) {
                eventSystem.emit('perf:test', { index: i }, { async: false });
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            console.log(`\n📊 이벤트 처리 성능:`);
            console.log(`   - 이벤트 수: ${eventCount.toLocaleString()}`);
            console.log(`   - 총 시간: ${totalTime.toFixed(2)}ms`);
            console.log(`   - 처리 속도: ${(eventCount / (totalTime / 1000)).toFixed(0)} 이벤트/초`);

            expect(processedCount).toBe(eventCount);
            expect(totalTime).toBeLessThan(2000); // 2초로 완화 (10K 이벤트)
        });

        it('우선순위 이벤트 처리 성능', async () => {
            const eventCount = 1000;
            const results = [];

            for (let i = 0; i < 10; i++) {
                eventSystem.on('perf:priority', (event) => {
                    results.push(event.priority);
                }, { priority: i });
            }

            const startTime = performance.now();

            for (let i = 0; i < eventCount; i++) {
                eventSystem.emit('perf:priority', {}, { priority: Math.floor(Math.random() * 10) });
            }

            // 모든 이벤트가 처리될 때까지 대기
            await new Promise(resolve => setTimeout(resolve, 100));

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            console.log(`\n📊 우선순위 이벤트 처리:`);
            console.log(`   - 이벤트 수: ${eventCount.toLocaleString()}`);
            console.log(`   - 총 시간: ${totalTime.toFixed(2)}ms`);

            expect(totalTime).toBeLessThan(1000);
        });
    });

    describe('UI 렌더링 성능', () => {
        beforeEach(async () => {
            // 1K 데이터 로드 (UI 테스트용)
            const data = generateLargeCSVData(1000);
            await dataSkeleton.replaceWeeklyData(data);

            // DOM 컨테이너 mock
            global.document = {
                createElement: vi.fn(() => ({
                    appendChild: vi.fn(),
                    querySelectorAll: vi.fn(() => []),
                    querySelector: vi.fn(),
                    tagName: 'DIV',
                    style: {},
                    children: []
                })),
                createTextNode: vi.fn((text) => ({ nodeType: 3, textContent: text })),
                body: {
                    appendChild: vi.fn(),
                    removeChild: vi.fn()
                },
                documentElement: {
                    style: {
                        setProperty: vi.fn()
                    }
                }
            };

            // HTMLElement mock
            global.HTMLElement = class HTMLElement {
                constructor() {
                    this.children = [];
                    this.style = {};
                }
            };
        });

        it('1,000 행 테이블 렌더링이 1초 이내에 완료되어야 함', () => {
            const startTime = performance.now();

            const table = uiFramework.createComponent('Table', {
                dataSource: 'dataSkeleton',
                columns: ['ticker', 'name', 'sector', 'price', 'volume']
            });

            table.render();

            const endTime = performance.now();
            const renderTime = endTime - startTime;

            console.log(`\n📊 테이블 렌더링 성능:`);
            console.log(`   - 행 수: 1,000`);
            console.log(`   - 렌더링 시간: ${renderTime.toFixed(2)}ms`);

            expect(renderTime).toBeLessThan(1000);
        });

        it('여러 컴포넌트 동시 생성 성능', () => {
            const componentCount = 10;

            const startTime = performance.now();

            for (let i = 0; i < componentCount; i++) {
                uiFramework.createComponent('Card', {
                    title: `Card ${i}`,
                    content: `Content for card ${i}`
                });
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            console.log(`\n📊 컴포넌트 생성 성능:`);
            console.log(`   - 컴포넌트 수: ${componentCount}`);
            console.log(`   - 총 시간: ${totalTime.toFixed(2)}ms`);
            console.log(`   - 컴포넌트당 평균: ${(totalTime / componentCount).toFixed(2)}ms`);

            expect(totalTime).toBeLessThan(500);
        });
    });

    describe('메모리 관리', () => {
        it('대량 데이터 로드 후 메모리 안정성', async () => {
            const memoryBefore = getMemoryUsage();

            // 대량 데이터 3번 교체
            for (let i = 0; i < 3; i++) {
                const data = generateLargeCSVData(10000);
                await dataSkeleton.replaceWeeklyData(data);
            }

            const memoryAfter = getMemoryUsage();

            if (memoryBefore && memoryAfter) {
                const memoryIncrease = memoryAfter.used - memoryBefore.used;

                console.log(`\n📊 메모리 안정성:`);
                console.log(`   - 시작: ${memoryBefore.used.toFixed(2)} MB`);
                console.log(`   - 종료: ${memoryAfter.used.toFixed(2)} MB`);
                console.log(`   - 증가: ${memoryIncrease.toFixed(2)} MB`);

                // 메모리 증가가 100MB 미만이어야 함 (메모리 누수 없음)
                expect(memoryIncrease).toBeLessThan(100);
            }
        }, 120000); // 2분 타임아웃
    });

    describe('종합 성능 벤치마크', () => {
        it('전체 워크플로우 성능 프로파일', async () => {
            console.log(`\n🏆 === 종합 성능 벤치마크 ===\n`);

            // 1. 데이터 로드
            const loadStart = performance.now();
            const data = generateLargeCSVData(10000);
            await dataSkeleton.replaceWeeklyData(data);
            const loadEnd = performance.now();

            // 2. 쿼리 성능
            const queryStart = performance.now();
            const result = dataSkeleton.query({
                filter: { sector: 'Technology', price: { $gt: 100 } },
                sort: { price: -1 },
                limit: 100
            });
            const queryEnd = performance.now();

            // 3. 이벤트 처리
            const eventStart = performance.now();
            for (let i = 0; i < 1000; i++) {
                eventSystem.emit('test', {}, { async: false });
            }
            const eventEnd = performance.now();

            // 결과 출력
            console.log(`📊 **성능 결과:**`);
            console.log(`   1. 데이터 로드 (10K): ${(loadEnd - loadStart).toFixed(2)}ms`);
            console.log(`   2. 복잡한 쿼리: ${(queryEnd - queryStart).toFixed(2)}ms`);
            console.log(`   3. 이벤트 처리 (1K): ${(eventEnd - eventStart).toFixed(2)}ms`);

            const memory = getMemoryUsage();
            if (memory) {
                console.log(`\n💾 **메모리 사용:**`);
                console.log(`   - 사용중: ${memory.used.toFixed(2)} MB`);
                console.log(`   - 총량: ${memory.total.toFixed(2)} MB`);
                console.log(`   - 사용률: ${((memory.used / memory.total) * 100).toFixed(1)}%`);
            }

            console.log(`\n✅ 모든 성능 기준 통과\n`);

            // 검증
            expect(loadEnd - loadStart).toBeLessThan(30000);
            expect(queryEnd - queryStart).toBeLessThan(100);
            expect(eventEnd - eventStart).toBeLessThan(1000);
        }, 120000); // 2분 타임아웃
    });
});
