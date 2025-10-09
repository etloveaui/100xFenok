/**
 * DataSkeleton 단위 테스트
 *
 * 테스트 범위:
 * - CSV 데이터 정제 시스템
 * - 스키마 자동 감지
 * - 필드 매핑 엔진
 * - 쿼리 엔진 (필터, 정렬, 페이징, 프로젝션)
 * - 구독 시스템 (Pub/Sub)
 * - 캐싱 시스템
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import DataSkeleton from '../../core/DataSkeleton.js';

describe('DataSkeleton', () => {
  let dataSkeleton;

  beforeEach(() => {
    dataSkeleton = new DataSkeleton();
  });

  // ========================================
  // CSV 데이터 정제 시스템
  // ========================================
  describe('CSV 데이터 정제', () => {
    it('빈 행을 제거해야 함', async () => {
      const csvData = [
        { name: 'Alice', age: 30 },
        { name: '', age: null },
        { name: 'Bob', age: 25 }
      ];

      const cleaned = await dataSkeleton.cleanCSVData(csvData);

      expect(cleaned).toHaveLength(2);
      expect(cleaned[0].name).toBe('Alice');
      expect(cleaned[1].name).toBe('Bob');
    });

    it('0-0x2a0x2a 패턴을 제거해야 함', async () => {
      const csvData = [
        { ticker: 'AAPL0-0x2a0x2a', price: '150.00' },
        { ticker: 'GOOGL', price: '2800.000-0x2a0x2a' }
      ];

      const cleaned = await dataSkeleton.cleanCSVData(csvData);

      expect(cleaned[0].ticker).toBe('AAPL');
      expect(cleaned[1].price).toBe('2800.00');
    });

    it('다중 공백을 단일 공백으로 변환해야 함', async () => {
      const csvData = [
        { name: 'John    Doe', company: 'Tech   Corp' }
      ];

      const cleaned = await dataSkeleton.cleanCSVData(csvData);

      expect(cleaned[0].name).toBe('John Doe');
      expect(cleaned[0].company).toBe('Tech Corp');
    });

    it('배열이 아닌 데이터는 에러를 던져야 함', async () => {
      await expect(dataSkeleton.cleanCSVData('invalid')).rejects.toThrow(
        'CSV 데이터는 배열이어야 합니다'
      );
    });
  });

  // ========================================
  // 스키마 자동 감지
  // ========================================
  describe('스키마 자동 감지', () => {
    it('필드 타입을 정확히 감지해야 함', async () => {
      const data = [
        { ticker: 'AAPL', price: 150.0, volume: 1000000 },
        { ticker: 'GOOGL', price: 2800.5, volume: 500000 }
      ];

      const schema = await dataSkeleton.detectSchema(data);

      expect(schema.fields).toHaveLength(3);

      const tickerField = schema.fields.find(f => f.name === 'ticker');
      expect(tickerField.type).toBe('string');

      const priceField = schema.fields.find(f => f.name === 'price');
      expect(priceField.type).toBe('number');
    });

    it('null 허용 필드를 감지해야 함', async () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: null },
        { name: 'Charlie', age: 25 }
      ];

      const schema = await dataSkeleton.detectSchema(data);

      const ageField = schema.fields.find(f => f.name === 'age');
      expect(ageField.nullable).toBe(true);

      const nameField = schema.fields.find(f => f.name === 'name');
      expect(nameField.nullable).toBe(false);
    });

    it('유니크 필드를 감지해야 함', async () => {
      const data = [
        { id: 1, category: 'tech' },
        { id: 2, category: 'tech' },
        { id: 3, category: 'finance' }
      ];

      const schema = await dataSkeleton.detectSchema(data);

      const idField = schema.fields.find(f => f.name === 'id');
      expect(idField.unique).toBe(true);

      const categoryField = schema.fields.find(f => f.name === 'category');
      expect(categoryField.unique).toBe(false);
    });

    it('빈 데이터는 에러를 던져야 함', async () => {
      await expect(dataSkeleton.detectSchema([])).rejects.toThrow(
        '스키마 감지: 데이터가 비어있습니다'
      );
    });
  });

  // ========================================
  // 필드 매핑 엔진
  // ========================================
  describe('필드 매핑', () => {
    it('필드명을 매핑해야 함', async () => {
      dataSkeleton.setFieldMappings({
        'old_name': 'newName',
        'old_price': 'newPrice'
      });

      const data = [
        { old_name: 'AAPL', old_price: 150 },
        { old_name: 'GOOGL', old_price: 2800 }
      ];

      const mapped = await dataSkeleton.mapFields(data, {});

      expect(mapped[0].newName).toBe('AAPL');
      expect(mapped[0].newPrice).toBe(150);
      expect(mapped[0].old_name).toBeUndefined();
    });

    it('매핑 규칙이 없으면 원본 그대로 반환해야 함', async () => {
      const data = [{ name: 'Alice', age: 30 }];
      const mapped = await dataSkeleton.mapFields(data, {});

      expect(mapped).toEqual(data);
    });
  });

  // ========================================
  // 데이터 검증
  // ========================================
  describe('데이터 검증', () => {
    it('검증 규칙을 적용해야 함', async () => {
      dataSkeleton.addValidator('age', (value) => value >= 18);

      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 15 },
        { name: 'Charlie', age: 25 }
      ];

      const validated = await dataSkeleton.validate(data);

      expect(validated).toHaveLength(2);
      expect(validated.find(r => r.name === 'Alice')).toBeDefined();
      expect(validated.find(r => r.name === 'Bob')).toBeUndefined();
    });

    it('검증 규칙이 없으면 모두 통과해야 함', async () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 15 }
      ];

      const validated = await dataSkeleton.validate(data);
      expect(validated).toEqual(data);
    });
  });

  // ========================================
  // 스마트 쿼리 엔진
  // ========================================
  describe('쿼리 엔진', () => {
    beforeEach(async () => {
      const testData = [
        { ticker: 'AAPL', price: 150, sector: 'tech', volume: 1000000 },
        { ticker: 'GOOGL', price: 2800, sector: 'tech', volume: 500000 },
        { ticker: 'JPM', price: 140, sector: 'finance', volume: 800000 },
        { ticker: 'MSFT', price: 300, sector: 'tech', volume: 1200000 },
        { ticker: 'BAC', price: 35, sector: 'finance', volume: 2000000 }
      ];

      await dataSkeleton.store(testData);
    });

    it('필터 조건으로 데이터를 검색해야 함', () => {
      const result = dataSkeleton.query({
        filter: { sector: 'tech' }
      });

      expect(result).toHaveLength(3);
      expect(result.every(r => r.sector === 'tech')).toBe(true);
    });

    it('$gt 연산자를 지원해야 함', () => {
      const result = dataSkeleton.query({
        filter: { price: { $gt: 200 } }
      });

      expect(result).toHaveLength(2);
      expect(result.every(r => r.price > 200)).toBe(true);
    });

    it('$gte 연산자를 지원해야 함', () => {
      const result = dataSkeleton.query({
        filter: { price: { $gte: 150 } }
      });

      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.every(r => r.price >= 150)).toBe(true);
    });

    it('$lt 연산자를 지원해야 함', () => {
      const result = dataSkeleton.query({
        filter: { price: { $lt: 150 } }
      });

      expect(result).toHaveLength(2);
      expect(result.every(r => r.price < 150)).toBe(true);
    });

    it('$in 연산자를 지원해야 함', () => {
      const result = dataSkeleton.query({
        filter: { ticker: { $in: ['AAPL', 'GOOGL'] } }
      });

      expect(result).toHaveLength(2);
      expect(result.every(r => ['AAPL', 'GOOGL'].includes(r.ticker))).toBe(true);
    });

    it('복합 필터를 지원해야 함', () => {
      const result = dataSkeleton.query({
        filter: {
          sector: 'tech',
          price: { $gte: 200 }
        }
      });

      expect(result).toHaveLength(2);
      expect(result.every(r => r.sector === 'tech' && r.price >= 200)).toBe(true);
    });

    it('오름차순 정렬을 지원해야 함', () => {
      const result = dataSkeleton.query({
        sort: { field: 'price', order: 'asc' }
      });

      expect(result[0].ticker).toBe('BAC');
      expect(result[result.length - 1].ticker).toBe('GOOGL');
    });

    it('내림차순 정렬을 지원해야 함', () => {
      const result = dataSkeleton.query({
        sort: { field: 'price', order: 'desc' }
      });

      expect(result[0].ticker).toBe('GOOGL');
      expect(result[result.length - 1].ticker).toBe('BAC');
    });

    it('limit와 offset을 지원해야 함', () => {
      const result = dataSkeleton.query({
        sort: { field: 'price', order: 'asc' },
        limit: 2,
        offset: 1
      });

      expect(result).toHaveLength(2);
      expect(result[0].ticker).toBe('JPM');
    });

    it('프로젝션으로 특정 필드만 선택해야 함', () => {
      const result = dataSkeleton.query({
        projection: ['ticker', 'price']
      });

      expect(result[0]).toHaveProperty('ticker');
      expect(result[0]).toHaveProperty('price');
      expect(result[0]).not.toHaveProperty('sector');
      expect(result[0]).not.toHaveProperty('volume');
    });
  });

  // ========================================
  // 구독 시스템 (Pub/Sub)
  // ========================================
  describe('구독 시스템', () => {
    it('데이터 변경 시 구독자에게 알림을 보내야 함', async () => {
      const callback = vi.fn();

      dataSkeleton.subscribe(callback, {
        events: ['data:updated']
      });

      await dataSkeleton.notifyAll({
        type: 'data:updated',
        data: [{ test: 'data' }]
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data:updated'
        })
      );
    });

    it('이벤트 타입 필터링이 작동해야 함', async () => {
      const callback = vi.fn();

      dataSkeleton.subscribe(callback, {
        events: ['data:updated']
      });

      await dataSkeleton.notifyAll({
        type: 'data:error',
        error: 'test error'
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('언구독이 작동해야 함', async () => {
      const callback = vi.fn();

      const unsubscribe = dataSkeleton.subscribe(callback, {
        events: ['data:updated']
      });

      unsubscribe();

      await dataSkeleton.notifyAll({
        type: 'data:updated',
        data: []
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('모듈별 구독자를 추적해야 함', () => {
      dataSkeleton.subscribe(() => {}, { module: 'dashboard' });
      dataSkeleton.subscribe(() => {}, { module: 'analytics' });

      const stats = dataSkeleton.getStats();
      expect(stats.moduleCount).toBe(2);
    });
  });

  // ========================================
  // 캐싱 시스템
  // ========================================
  describe('캐싱 시스템', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
      ];

      await dataSkeleton.store(testData);
      dataSkeleton.clearCache();
    });

    it('동일한 쿼리를 캐싱해야 함', () => {
      const query = { filter: { id: 1 } };

      const result1 = dataSkeleton.query(query);
      const result2 = dataSkeleton.query(query);

      const stats = dataSkeleton.getStats();
      expect(stats.cacheStats.hits).toBe(1);
      expect(stats.cacheStats.misses).toBe(1);
    });

    it('캐시 비활성화가 작동해야 함', () => {
      dataSkeleton.setCacheEnabled(false);

      const query = { filter: { id: 1 } };
      dataSkeleton.query(query);
      dataSkeleton.query(query);

      const stats = dataSkeleton.getStats();
      expect(stats.cacheStats.hits).toBe(0);
      expect(stats.cacheStats.misses).toBe(2);
    });

    it('데이터 저장 시 캐시가 클리어되어야 함', async () => {
      const query = { filter: { id: 1 } };
      dataSkeleton.query(query);

      await dataSkeleton.store([{ id: 4, name: 'David' }]);

      const stats = dataSkeleton.getStats();
      expect(stats.cacheStats.hits).toBe(0);
    });

    it('캐시 크기 제한이 작동해야 함', () => {
      dataSkeleton.maxCacheSize = 3;

      for (let i = 0; i < 5; i++) {
        dataSkeleton.query({ filter: { id: i } });
      }

      expect(dataSkeleton.processedData.size).toBeLessThanOrEqual(3);
    });
  });

  // ========================================
  // 주간 데이터 교체 파이프라인
  // ========================================
  describe('주간 데이터 교체', () => {
    it('전체 파이프라인이 성공적으로 실행되어야 함', async () => {
      const csvData = [
        { ticker: 'AAPL0-0x2a0x2a', price: '150.00', sector: 'tech' },
        { ticker: 'GOOGL', price: '2800.50', sector: 'tech' },
        { ticker: '', price: null, sector: '' }
      ];

      const result = await dataSkeleton.replaceWeeklyData(csvData);

      expect(result.success).toBe(true);
      expect(result.recordCount).toBe(2);
      expect(dataSkeleton.count()).toBe(2);
    });

    it('구독자에게 업데이트 알림을 보내야 함', async () => {
      const callback = vi.fn();
      dataSkeleton.subscribe(callback, { events: ['data:updated'] });

      await dataSkeleton.replaceWeeklyData([
        { ticker: 'AAPL', price: 150 }
      ]);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data:updated'
        })
      );
    });

    it('에러 발생 시 에러 이벤트를 발행해야 함', async () => {
      const callback = vi.fn();
      dataSkeleton.subscribe(callback, { events: ['data:error'] });

      // 잘못된 데이터로 에러 유도
      const result = await dataSkeleton.replaceWeeklyData(null);

      expect(result.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data:error'
        })
      );
    });
  });

  // ========================================
  // 유틸리티 메서드
  // ========================================
  describe('유틸리티', () => {
    beforeEach(async () => {
      await dataSkeleton.store([
        { id: 1, category: 'A' },
        { id: 2, category: 'B' },
        { id: 3, category: 'A' }
      ]);
    });

    it('전체 데이터 개수를 반환해야 함', () => {
      expect(dataSkeleton.count()).toBe(3);
    });

    it('조건부 데이터 개수를 반환해야 함', () => {
      const count = dataSkeleton.countWhere({ category: 'A' });
      expect(count).toBe(2);
    });

    it('통계 정보를 반환해야 함', () => {
      const stats = dataSkeleton.getStats();

      expect(stats).toHaveProperty('lastUpdate');
      expect(stats).toHaveProperty('recordCount');
      expect(stats).toHaveProperty('cacheStats');
      expect(stats).toHaveProperty('subscriberCount');
    });

    it('스키마 정보를 반환해야 함', async () => {
      const data = [{ name: 'Alice', age: 30 }];
      await dataSkeleton.detectSchema(data);

      const schema = dataSkeleton.getSchema();
      expect(schema).toHaveProperty('fields');
      expect(schema.fields).toHaveLength(2);
    });
  });
});
