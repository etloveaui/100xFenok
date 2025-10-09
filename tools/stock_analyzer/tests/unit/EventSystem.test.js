/**
 * EventSystem 단위 테스트
 *
 * 테스트 범위:
 * - 이벤트 발행 (emit)
 * - 이벤트 구독 (on, once, off)
 * - 우선순위 기반 처리
 * - 에러 격리 및 복구
 * - 이벤트 히스토리 추적
 * - 성능 모니터링
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import EventSystem from '../../core/EventSystem.js';

describe('EventSystem', () => {
  let eventSystem;

  beforeEach(() => {
    eventSystem = new EventSystem();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // 이벤트 발행 (Emit)
  // ========================================
  describe('이벤트 발행', () => {
    it('이벤트를 발행하고 구독자가 받아야 함', async () => {
      const handler = vi.fn();
      eventSystem.on('test:event', handler);

      eventSystem.emit('test:event', { data: 'test' });

      // 비동기 큐 처리 대기
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test:event',
          payload: { data: 'test' }
        })
      );
    });

    it('동기 모드에서 즉시 처리되어야 함', () => {
      const handler = vi.fn();
      eventSystem.on('test:event', handler);

      eventSystem.emit('test:event', { data: 'sync' }, { async: false });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('이벤트에 고유 ID가 부여되어야 함', async () => {
      const handler = vi.fn();
      eventSystem.on('test:event', handler);

      eventSystem.emit('test:event', {});

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String)
        })
      );
    });

    it('타임스탬프가 기록되어야 함', async () => {
      const handler = vi.fn();
      eventSystem.on('test:event', handler);

      const beforeEmit = Date.now();
      eventSystem.emit('test:event', {});

      await new Promise(resolve => setTimeout(resolve, 10));

      const event = handler.mock.calls[0][0];
      expect(event.timestamp).toBeGreaterThanOrEqual(beforeEmit);
      expect(event.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  // ========================================
  // 이벤트 구독 (On, Once, Off)
  // ========================================
  describe('이벤트 구독', () => {
    it('구독 해제가 작동해야 함', async () => {
      const handler = vi.fn();
      const unsubscribe = eventSystem.on('test:event', handler);

      unsubscribe();

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it('once() 구독은 한 번만 실행되어야 함', async () => {
      const handler = vi.fn();
      eventSystem.once('test:event', handler);

      eventSystem.emit('test:event', { data: 1 });
      eventSystem.emit('test:event', { data: 2 });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { data: 1 }
        })
      );
    });

    it('off()로 모든 핸들러를 제거할 수 있어야 함', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventSystem.on('test:event', handler1);
      eventSystem.on('test:event', handler2);

      eventSystem.off('test:event');

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('off()로 특정 핸들러만 제거할 수 있어야 함', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventSystem.on('test:event', handler1);
      eventSystem.on('test:event', handler2);

      eventSystem.off('test:event', handler1);

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('모듈 정보를 구독에 포함할 수 있어야 함', () => {
      eventSystem.on('test:event', () => {}, { module: 'dashboard' });

      const subscribers = eventSystem.getSubscribers('test:event');
      expect(subscribers[0].module).toBe('dashboard');
    });
  });

  // ========================================
  // 우선순위 기반 처리
  // ========================================
  describe('우선순위 처리', () => {
    it('높은 우선순위 핸들러가 먼저 실행되어야 함', async () => {
      const executionOrder = [];

      eventSystem.on('test:event', () => {
        executionOrder.push('low');
      }, { priority: 0 });

      eventSystem.on('test:event', () => {
        executionOrder.push('high');
      }, { priority: 10 });

      eventSystem.on('test:event', () => {
        executionOrder.push('medium');
      }, { priority: 5 });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executionOrder).toEqual(['high', 'medium', 'low']);
    });

    it('우선순위 이벤트가 먼저 처리되어야 함', async () => {
      const executionOrder = [];

      eventSystem.on('event1', () => {
        executionOrder.push('event1');
      });

      eventSystem.on('event2', () => {
        executionOrder.push('event2');
      });

      eventSystem.emit('event1', {}, { priority: 0 });
      eventSystem.emit('event2', {}, { priority: 10 });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executionOrder[0]).toBe('event2');
    });
  });

  // ========================================
  // 에러 격리 및 복구
  // ========================================
  describe('에러 처리', () => {
    it('핸들러 에러가 다른 핸들러에 영향을 주지 않아야 함', async () => {
      const handler1 = vi.fn(() => {
        throw new Error('Handler 1 error');
      });

      const handler2 = vi.fn();

      eventSystem.on('test:event', handler1);
      eventSystem.on('test:event', handler2);

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('에러 핸들러에 에러 정보가 전달되어야 함', async () => {
      const errorHandler = vi.fn();
      const testError = new Error('Test error');

      eventSystem.onError(errorHandler);

      eventSystem.on('test:event', () => {
        throw testError;
      });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system:error',
          error: expect.objectContaining({
            message: 'Test error'
          })
        })
      );
    });

    it('에러 통계가 업데이트되어야 함', async () => {
      eventSystem.on('test:event', () => {
        throw new Error('Test error');
      });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = eventSystem.getStats();
      expect(stats.errorStats.totalErrors).toBe(1);
    });

    it('system:error 이벤트가 발행되어야 함', async () => {
      const systemErrorHandler = vi.fn();
      eventSystem.on('system:error', systemErrorHandler);

      eventSystem.on('test:event', () => {
        throw new Error('Test error');
      });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(systemErrorHandler).toHaveBeenCalled();
    });
  });

  // ========================================
  // 이벤트 히스토리
  // ========================================
  describe('이벤트 히스토리', () => {
    it('이벤트가 히스토리에 기록되어야 함', () => {
      eventSystem.emit('test:event1', { data: 1 });
      eventSystem.emit('test:event2', { data: 2 });

      const history = eventSystem.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('특정 이벤트의 히스토리를 조회할 수 있어야 함', () => {
      eventSystem.emit('test:event1', { data: 1 });
      eventSystem.emit('test:event2', { data: 2 });
      eventSystem.emit('test:event1', { data: 3 });

      const history = eventSystem.getHistory('test:event1');
      expect(history.length).toBe(2);
      expect(history.every(e => e.name === 'test:event1')).toBe(true);
    });

    it('히스토리 크기 제한이 작동해야 함', () => {
      eventSystem.maxHistorySize = 10;

      for (let i = 0; i < 20; i++) {
        eventSystem.emit(`test:event${i}`, {});
      }

      const history = eventSystem.getHistory();
      expect(history.length).toBeLessThanOrEqual(10);
    });
  });

  // ========================================
  // 성능 모니터링
  // ========================================
  describe('성능 모니터링', () => {
    it('이벤트 통계가 업데이트되어야 함', () => {
      eventSystem.emit('test:event1', {});
      eventSystem.emit('test:event2', {});
      eventSystem.emit('test:event1', {});

      const stats = eventSystem.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.byType.get('test:event1')).toBe(2);
      expect(stats.byType.get('test:event2')).toBe(1);
    });

    it('평균 처리 시간이 계산되어야 함', async () => {
      eventSystem.on('test:event', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 20));

      const stats = eventSystem.getStats();
      expect(stats.avgProcessingTime).toBeGreaterThan(0);
    });

    it('구독자 수가 정확해야 함', () => {
      eventSystem.on('test:event1', () => {});
      eventSystem.on('test:event1', () => {});
      eventSystem.on('test:event2', () => {});

      const stats = eventSystem.getStats();
      expect(stats.subscriberCount).toBe(3);
    });

    it('큐 크기를 조회할 수 있어야 함', () => {
      eventSystem.emit('test:event1', {});
      eventSystem.emit('test:event2', {});

      const stats = eventSystem.getStats();
      expect(stats.queueSize).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================
  // 비동기 핸들러 처리
  // ========================================
  describe('비동기 핸들러', () => {
    it('Promise 반환 핸들러를 처리해야 함', async () => {
      const asyncHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done';
      });

      eventSystem.on('test:event', asyncHandler);

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(asyncHandler).toHaveBeenCalled();
    });

    it('비동기 핸들러의 에러를 처리해야 함', async () => {
      const errorHandler = vi.fn();
      eventSystem.onError(errorHandler);

      eventSystem.on('test:event', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      eventSystem.emit('test:event', {});
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  // ========================================
  // 디버그 모드
  // ========================================
  describe('디버그 모드', () => {
    it('디버그 모드를 활성화/비활성화할 수 있어야 함', () => {
      eventSystem.setDebugMode(true);
      expect(eventSystem.debugMode).toBe(true);

      eventSystem.setDebugMode(false);
      expect(eventSystem.debugMode).toBe(false);
    });
  });

  // ========================================
  // 구독자 조회
  // ========================================
  describe('구독자 조회', () => {
    it('특정 이벤트의 구독자를 조회할 수 있어야 함', () => {
      eventSystem.on('test:event', () => {}, { module: 'module1', priority: 5 });
      eventSystem.on('test:event', () => {}, { module: 'module2', priority: 3 });

      const subscribers = eventSystem.getSubscribers('test:event');
      expect(subscribers).toHaveLength(2);
      expect(subscribers[0].module).toBe('module1');
      expect(subscribers[0].priority).toBe(5);
    });

    it('모든 이벤트의 구독자를 조회할 수 있어야 함', () => {
      eventSystem.on('test:event1', () => {});
      eventSystem.on('test:event2', () => {});

      const allSubscribers = eventSystem.getSubscribers();
      expect(allSubscribers).toHaveProperty('test:event1');
      expect(allSubscribers).toHaveProperty('test:event2');
    });
  });

  // ========================================
  // 큐 및 구독 관리
  // ========================================
  describe('큐 및 구독 관리', () => {
    it('큐를 클리어할 수 있어야 함', () => {
      eventSystem.emit('test:event1', {});
      eventSystem.emit('test:event2', {});

      eventSystem.clearQueue();

      expect(eventSystem.eventQueue).toHaveLength(0);
    });

    it('모든 구독을 제거할 수 있어야 함', () => {
      eventSystem.on('test:event1', () => {});
      eventSystem.on('test:event2', () => {});

      eventSystem.clearAllSubscriptions();

      const stats = eventSystem.getStats();
      expect(stats.subscriberCount).toBe(0);
    });
  });

  // ========================================
  // 복잡한 시나리오
  // ========================================
  describe('복잡한 시나리오', () => {
    it('여러 모듈이 동일 이벤트를 구독해도 격리되어야 함', async () => {
      const module1Handler = vi.fn();
      const module2Handler = vi.fn(() => {
        throw new Error('Module 2 error');
      });

      eventSystem.on('data:updated', module1Handler, { module: 'module1' });
      eventSystem.on('data:updated', module2Handler, { module: 'module2' });

      eventSystem.emit('data:updated', { records: 100 });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(module1Handler).toHaveBeenCalled();
      expect(module2Handler).toHaveBeenCalled();
    });

    it('체인 이벤트가 정상 작동해야 함', async () => {
      const executionOrder = [];

      eventSystem.on('step1', () => {
        executionOrder.push('step1');
        eventSystem.emit('step2', {});
      });

      eventSystem.on('step2', () => {
        executionOrder.push('step2');
        eventSystem.emit('step3', {});
      });

      eventSystem.on('step3', () => {
        executionOrder.push('step3');
      });

      eventSystem.emit('step1', {});
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(executionOrder).toEqual(['step1', 'step2', 'step3']);
    });
  });
});
