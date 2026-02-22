'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type RouteEmbedFrameProps = {
  src: string;
  title: string;
  loading?: 'eager' | 'lazy';
  timeoutMs?: number;
  hideEmbeddedShell?: boolean;
};

export default function RouteEmbedFrame({
  src,
  title,
  loading = 'eager',
  timeoutMs = 12000,
  hideEmbeddedShell = true,
}: RouteEmbedFrameProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const effectiveSrc = appendEmbedParam(src, hideEmbeddedShell);
  const frameKey = `${effectiveSrc}:${reloadToken}`;

  return (
    <RouteEmbedFrameInner
      key={frameKey}
      src={effectiveSrc}
      title={title}
      loading={loading}
      timeoutMs={timeoutMs}
      hideEmbeddedShell={hideEmbeddedShell}
      onRetry={() => setReloadToken((prev) => prev + 1)}
    />
  );
}

type RouteEmbedFrameInnerProps = RouteEmbedFrameProps & {
  onRetry: () => void;
};

function RouteEmbedFrameInner({
  src,
  title,
  loading,
  timeoutMs,
  hideEmbeddedShell = true,
  onRetry,
}: RouteEmbedFrameInnerProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<'timeout' | 'load-error' | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const setIframeRef = useCallback((node: HTMLIFrameElement | null) => {
    if (iframeRef.current && iframeRef.current !== node) {
      disconnectLegacyShellObserver(iframeRef.current);
    }
    iframeRef.current = node;
  }, []);
  const loadStartedAtRef = useRef<number>(getNowMs());
  const railLabel = formatEmbedRailLabel(src);
  const railStateLabel = failed ? 'ERROR' : ready ? 'READY' : 'LOADING';
  const railStateClass = failed ? 'is-error' : ready ? 'is-ready' : 'is-loading';
  const shellGuardLabel = hideEmbeddedShell ? 'SHELL ON' : 'SHELL OFF';
  const shellGuardClass = hideEmbeddedShell ? 'is-on' : 'is-off';

  useEffect(() => {
    if (ready || failed) return;
    const timer = window.setTimeout(() => {
      setFailureReason('timeout');
      setFailed(true);
      emitEmbedTelemetry({
        event: 'load-timeout',
        src,
        title,
        hideEmbeddedShell,
        timeoutMs,
      });
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [failed, hideEmbeddedShell, ready, src, timeoutMs, title]);

  const handleFrameLoad = () => {
    if (hideEmbeddedShell) {
      maskLegacyShell(iframeRef.current);
      window.setTimeout(() => maskLegacyShell(iframeRef.current), 180);
      window.setTimeout(() => maskLegacyShell(iframeRef.current), 900);
    }
    setFailed(false);
    setFailureReason(null);
    setReady(true);
    emitEmbedTelemetry({
      event: 'load-success',
      src,
      title,
      hideEmbeddedShell,
      elapsedMs: Math.round(Math.max(0, getNowMs() - loadStartedAtRef.current)),
    });
  };

  const handleFrameError = () => {
    disconnectLegacyShellObserver(iframeRef.current);
    setReady(false);
    setFailureReason('load-error');
    setFailed(true);
    emitEmbedTelemetry({
      event: 'load-error',
      src,
      title,
      hideEmbeddedShell,
      elapsedMs: Math.round(Math.max(0, getNowMs() - loadStartedAtRef.current)),
    });
  };

  const handleRetry = () => {
    disconnectLegacyShellObserver(iframeRef.current);
    setReady(false);
    setFailed(false);
    setFailureReason(null);
    loadStartedAtRef.current = getNowMs();
    emitEmbedTelemetry({
      event: 'retry',
      src,
      title,
      hideEmbeddedShell,
      timeoutMs,
    });
    onRetry();
  };

  return (
    <div className="route-embed-shell route-embed-shell-framed">
      <div className="route-embed-rail">
        <span className="route-embed-chip" aria-hidden="true">EMBED</span>
        <span className={`route-embed-health ${railStateClass}`} aria-live="polite">
          {railStateLabel}
        </span>
        <span className={`route-embed-shell-guard ${shellGuardClass}`} aria-live="polite">
          {shellGuardLabel}
        </span>
        <span className="route-embed-path" title={railLabel}>{railLabel}</span>
        <button type="button" className="route-embed-rail-btn" onClick={handleRetry}>
          Reload
        </button>
        <a href={src} target="_blank" rel="noreferrer" className="route-embed-rail-link">
          새 창
        </a>
      </div>
      <div className="route-embed-stage">
        {!ready ? (
          <div
            className={`route-embed-state ${failed ? 'is-error' : 'is-loading'}`}
            role={failed ? 'alert' : 'status'}
            aria-live="polite"
          >
            {failed ? (
              <div className="route-embed-message">
                <p className="route-embed-title">콘텐츠를 불러오지 못했습니다.</p>
                <p className="route-embed-subtitle">
                  {failureReason === 'timeout'
                    ? '응답 시간이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
                    : '네트워크 상태를 확인하고 다시 시도해 주세요.'}
                </p>
                <div className="route-embed-actions">
                  <button type="button" className="route-embed-btn" onClick={handleRetry}>
                    다시 시도
                  </button>
                  <a href={src} target="_blank" rel="noreferrer" className="route-embed-link">
                    새 창에서 열기
                  </a>
                </div>
              </div>
            ) : (
              <div className="route-embed-message">
                <div className="route-embed-spinner" aria-hidden="true" />
                <p className="route-embed-title">콘텐츠 로딩 중...</p>
                <p className="route-embed-subtitle">환경에 따라 수 초가 소요될 수 있습니다.</p>
              </div>
            )}
          </div>
        ) : null}

        <iframe
          ref={setIframeRef}
          src={src}
          title={title}
          loading={loading}
          className="route-embed-frame"
          onLoad={handleFrameLoad}
          onError={handleFrameError}
        />
      </div>
    </div>
  );
}

function appendEmbedParam(src: string, enabled: boolean): string {
  if (!enabled) return src;

  const [baseAndQuery, hash = ''] = src.split('#', 2);
  const cleaned = baseAndQuery
    .replace(/([?&])embed=[^&#]*/g, '$1')
    .replace(/[?&]+$/, '')
    .replace(/\?&/, '?');
  const glue = cleaned.includes('?') ? '&' : '?';
  return `${cleaned}${glue}embed=1${hash ? `#${hash}` : ''}`;
}

function formatEmbedRailLabel(src: string): string {
  const compact = src
    .replace(/([?&])embed=1(&|$)/, '$1')
    .replace(/[?&]$/, '')
    .replace(/^\//, '');
  if (compact.length <= 52) return compact;
  return `...${compact.slice(-52)}`;
}

type EmbedTelemetryEvent = 'load-success' | 'load-timeout' | 'load-error' | 'retry';

type EmbedTelemetryDetail = {
  event: EmbedTelemetryEvent;
  src: string;
  title: string;
  hideEmbeddedShell: boolean;
  elapsedMs?: number;
  timeoutMs?: number;
  at: string;
};

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function emitEmbedTelemetry(detail: Omit<EmbedTelemetryDetail, 'at'>): void {
  try {
    window.dispatchEvent(
      new CustomEvent<EmbedTelemetryDetail>('fenok:embed-frame', {
        detail: {
          ...detail,
          at: new Date().toISOString(),
        },
      }),
    );
  } catch {
    // 이벤트 전송 실패는 기능에 영향이 없으므로 무시
  }
}

const EMBED_SHELL_SELECTOR = [
  '#mainNav',
  'nav#mainNav',
  'body > nav',
  'body > header nav',
  '.sticky-header',
  'header.sticky-header',
  '.top-nav',
  '.global-nav',
  '.nav-wrapper',
  '.navbar',
  'footer',
  '[role="contentinfo"]',
  '#mainFooter',
  '#footer',
  '.site-footer',
  '.footer',
  '[aria-label*="footer" i]',
  '[id*="footer" i]',
  '[class*="footer" i]',
].join(', ');

type EmbedShellObserverState = {
  doc: Document;
  observer: MutationObserver;
};

const embedShellObserverMap = new WeakMap<HTMLIFrameElement, EmbedShellObserverState>();

function disconnectLegacyShellObserver(frame: HTMLIFrameElement | null): void {
  if (!frame) return;
  const state = embedShellObserverMap.get(frame);
  if (!state) return;
  state.observer.disconnect();
  embedShellObserverMap.delete(frame);
}

function hideLegacyShellNodes(doc: Document): void {
  const shellNodes = doc.querySelectorAll(EMBED_SHELL_SELECTOR);
  shellNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.setAttribute('data-next-embed-hidden', '1');
    node.style.display = 'none';
  });
}

function ensureLegacyShellObserver(frame: HTMLIFrameElement, doc: Document): void {
  const currentState = embedShellObserverMap.get(frame);
  if (currentState && currentState.doc === doc) {
    return;
  }

  currentState?.observer.disconnect();

  const observer = new MutationObserver(() => {
    hideLegacyShellNodes(doc);
  });

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id', 'style'],
  });

  embedShellObserverMap.set(frame, { doc, observer });
}

function maskLegacyShell(frame: HTMLIFrameElement | null): void {
  if (!frame) return;

  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.documentElement || !doc.body) return;

    doc.documentElement.setAttribute('data-next-embed-shell', '1');
    doc.body.setAttribute('data-next-embed-shell', '1');

    if (!doc.getElementById('next-embed-shell-style')) {
      const style = doc.createElement('style');
      style.id = 'next-embed-shell-style';
      style.textContent = `
        html[data-next-embed-shell="1"] body {
          margin-top: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html[data-next-embed-shell="1"] #mainNav,
        html[data-next-embed-shell="1"] nav#mainNav,
        html[data-next-embed-shell="1"] body > nav,
        html[data-next-embed-shell="1"] body > header nav,
        html[data-next-embed-shell="1"] .sticky-header,
        html[data-next-embed-shell="1"] header.sticky-header,
        html[data-next-embed-shell="1"] .top-nav,
        html[data-next-embed-shell="1"] .global-nav,
        html[data-next-embed-shell="1"] .nav-wrapper,
        html[data-next-embed-shell="1"] .navbar,
        html[data-next-embed-shell="1"] footer,
        html[data-next-embed-shell="1"] [role="contentinfo"],
        html[data-next-embed-shell="1"] #mainFooter,
        html[data-next-embed-shell="1"] #footer,
        html[data-next-embed-shell="1"] .site-footer,
        html[data-next-embed-shell="1"] .footer,
        html[data-next-embed-shell="1"] [aria-label*="footer" i],
        html[data-next-embed-shell="1"] [id*="footer" i],
        html[data-next-embed-shell="1"] [class*="footer" i] {
          display: none !important;
        }
      `;
      doc.head?.appendChild(style);
    }

    hideLegacyShellNodes(doc);
    ensureLegacyShellObserver(frame, doc);
  } catch {
    // iframe 문서 접근 불가(cross-origin 등) 시 조용히 건너뜀
  }
}
