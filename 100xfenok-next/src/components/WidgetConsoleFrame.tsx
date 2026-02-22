'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WidgetConsoleFrameProps = {
  src: string;
  title: string;
  widgetId: string;
  payload?: unknown;
  loading?: 'eager' | 'lazy';
  timeoutMs?: number;
};

export default function WidgetConsoleFrame({
  src,
  title,
  widgetId,
  payload,
  loading = 'lazy',
  timeoutMs = 10000,
}: WidgetConsoleFrameProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const frameKey = `${src}:${widgetId}:${reloadToken}`;

  return (
    <WidgetConsoleFrameInner
      key={frameKey}
      src={src}
      title={title}
      widgetId={widgetId}
      payload={payload}
      loading={loading}
      timeoutMs={timeoutMs}
      onRetry={() => setReloadToken((prev) => prev + 1)}
    />
  );
}

type WidgetConsoleFrameInnerProps = WidgetConsoleFrameProps & {
  onRetry: () => void;
};

function WidgetConsoleFrameInner({
  src,
  title,
  widgetId,
  payload,
  loading,
  timeoutMs,
  onRetry,
}: WidgetConsoleFrameInnerProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<'timeout' | 'load-error' | null>(null);
  const [isPayloadLinked, setIsPayloadLinked] = useState(false);
  const [lastDispatchAt, setLastDispatchAt] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadStartedAtRef = useRef<number>(getNowMs());
  const readyFallbackTimerRef = useRef<number | null>(null);

  const railStateLabel = failed ? 'ERROR' : ready ? 'READY' : 'LOADING';
  const railStateClass = failed ? 'is-error' : ready ? 'is-ready' : 'is-loading';
  const railBridgeLabel = !payload ? 'LOCAL' : isPayloadLinked ? 'LINKED' : 'WAIT';
  const railBridgeClass = !payload ? 'is-local' : isPayloadLinked ? 'is-linked' : 'is-waiting';
  const bridgeTimeLabel = lastDispatchAt ? formatTimeLabel(lastDispatchAt) : '--';
  const compactPath = formatWidgetPath(src);

  const markPayloadLinked = useCallback(() => {
    if (!payload) return;
    setIsPayloadLinked(true);
    setLastDispatchAt(new Date().toISOString());
  }, [payload]);

  const dispatchPayload = useCallback(() => {
    if (!payload || !iframeRef.current?.contentWindow) return;
    try {
      const targetOrigin = resolveTargetOrigin(src);
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'WIDGET_DATA_UPDATE',
          widgetId,
          payload,
        },
        targetOrigin,
      );
      emitWidgetTelemetry({
        event: 'data-dispatch',
        src,
        title,
        widgetId,
      });
    } catch {
      // payload 전달 실패는 로딩/렌더 동작에 영향이 없으므로 무시
    }
  }, [payload, src, title, widgetId]);

  useEffect(() => {
    if (ready || failed) return;

    const timeoutId = window.setTimeout(() => {
      setFailureReason('timeout');
      setFailed(true);
      emitWidgetTelemetry({
        event: 'load-timeout',
        src,
        title,
        widgetId,
        timeoutMs,
      });
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [failed, ready, src, timeoutMs, title, widgetId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;

      const payload = event.data as {
        type?: string;
        widgetId?: string;
      };
      if (payload.type !== 'WIDGET_READY' || payload.widgetId !== widgetId) return;

      if (readyFallbackTimerRef.current !== null) {
        window.clearTimeout(readyFallbackTimerRef.current);
        readyFallbackTimerRef.current = null;
      }
      setFailed(false);
      setFailureReason(null);
      setReady(true);
      dispatchPayload();
      markPayloadLinked();
      emitWidgetTelemetry({
        event: 'widget-ready',
        src,
        title,
        widgetId,
        elapsedMs: Math.round(Math.max(0, getNowMs() - loadStartedAtRef.current)),
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [dispatchPayload, markPayloadLinked, src, title, widgetId]);

  useEffect(() => {
    return () => {
      if (readyFallbackTimerRef.current !== null) {
        window.clearTimeout(readyFallbackTimerRef.current);
        readyFallbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    dispatchPayload();
  }, [dispatchPayload, payload, ready]);

  const handleFrameLoad = () => {
    if (failed || ready) return;

    dispatchPayload();
    markPayloadLinked();

    if (readyFallbackTimerRef.current !== null) {
      window.clearTimeout(readyFallbackTimerRef.current);
    }

    // 일부 레거시 위젯은 READY 신호 없이 로드만 완료될 수 있어 fallback을 둔다.
    readyFallbackTimerRef.current = window.setTimeout(() => {
      setReady(true);
      emitWidgetTelemetry({
        event: 'load-fallback-ready',
        src,
        title,
        widgetId,
        elapsedMs: Math.round(Math.max(0, getNowMs() - loadStartedAtRef.current)),
      });
      readyFallbackTimerRef.current = null;
    }, 1800);
  };

  const handleFrameError = () => {
    if (readyFallbackTimerRef.current !== null) {
      window.clearTimeout(readyFallbackTimerRef.current);
      readyFallbackTimerRef.current = null;
    }
    setReady(false);
    setFailureReason('load-error');
    setFailed(true);
    emitWidgetTelemetry({
      event: 'load-error',
      src,
      title,
      widgetId,
      elapsedMs: Math.round(Math.max(0, getNowMs() - loadStartedAtRef.current)),
    });
  };

  const handleRetry = () => {
    if (readyFallbackTimerRef.current !== null) {
      window.clearTimeout(readyFallbackTimerRef.current);
      readyFallbackTimerRef.current = null;
    }
    setReady(false);
    setFailed(false);
    setFailureReason(null);
    setIsPayloadLinked(false);
    setLastDispatchAt(null);
    loadStartedAtRef.current = getNowMs();
    emitWidgetTelemetry({
      event: 'retry',
      src,
      title,
      widgetId,
      timeoutMs,
    });
    onRetry();
  };

  return (
    <div className="widget-console-shell">
      <div className="widget-console-rail">
        <span className="widget-console-chip" aria-hidden="true">WIDGET</span>
        <span className={`widget-console-health ${railStateClass}`} aria-live="polite">{railStateLabel}</span>
        <span className={`widget-console-bridge ${railBridgeClass}`} aria-live="polite">DATA {railBridgeLabel}</span>
        {payload ? <span className="widget-console-bridge-time">SYNC {bridgeTimeLabel}</span> : null}
        <span className="widget-console-path" title={compactPath}>{compactPath}</span>
        <button type="button" className="widget-console-rail-btn" onClick={handleRetry}>
          Reload
        </button>
        <a href={src} target="_blank" rel="noreferrer" className="widget-console-rail-link">
          Open
        </a>
      </div>

      <div className="widget-console-stage">
        {!ready ? (
          <div className={`widget-console-state ${failed ? 'is-error' : 'is-loading'}`} role={failed ? 'alert' : 'status'} aria-live="polite">
            {failed ? (
              <div className="widget-console-message">
                <p className="widget-console-title">콘솔 로딩 실패</p>
                <p className="widget-console-subtitle">
                  {failureReason === 'timeout'
                    ? '응답 시간이 길어지고 있습니다. 다시 시도해 주세요.'
                    : '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'}
                </p>
                <div className="widget-console-actions">
                  <button type="button" className="widget-console-btn" onClick={handleRetry}>
                    다시 시도
                  </button>
                  <a href={src} target="_blank" rel="noreferrer" className="widget-console-link">
                    새 창에서 열기
                  </a>
                </div>
              </div>
            ) : (
              <div className="widget-console-message">
                <div className="widget-console-spinner" aria-hidden="true" />
                <p className="widget-console-title">콘솔 동기화 중...</p>
                <p className="widget-console-subtitle">위젯 신호를 기다리는 중입니다.</p>
              </div>
            )}
          </div>
        ) : null}

        <iframe
          ref={iframeRef}
          src={src}
          title={title}
          loading={loading}
          className="insight-tab-iframe"
          onLoad={handleFrameLoad}
          onError={handleFrameError}
        />
      </div>
    </div>
  );
}

function formatWidgetPath(src: string): string {
  const compact = src.replace(/^\//, '');
  if (compact.length <= 44) return compact;
  return `...${compact.slice(-44)}`;
}

type WidgetTelemetryEvent =
  | 'widget-ready'
  | 'load-timeout'
  | 'load-error'
  | 'retry'
  | 'load-fallback-ready'
  | 'data-dispatch';

type WidgetTelemetryDetail = {
  event: WidgetTelemetryEvent;
  src: string;
  title: string;
  widgetId: string;
  elapsedMs?: number;
  timeoutMs?: number;
  at: string;
};

function emitWidgetTelemetry(detail: Omit<WidgetTelemetryDetail, 'at'>): void {
  try {
    window.dispatchEvent(
      new CustomEvent<WidgetTelemetryDetail>('fenok:widget-frame', {
        detail: {
          ...detail,
          at: new Date().toISOString(),
        },
      }),
    );
  } catch {
    // 텔레메트리 실패는 UI 동작에 영향이 없으므로 무시
  }
}

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function formatTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function resolveTargetOrigin(src: string): string {
  if (typeof window === 'undefined') return '*';
  try {
    return new URL(src, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}
