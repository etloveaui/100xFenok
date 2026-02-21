'use client';

import { useEffect, useState } from 'react';

type RouteEmbedFrameProps = {
  src: string;
  title: string;
  loading?: 'eager' | 'lazy';
  timeoutMs?: number;
};

export default function RouteEmbedFrame({
  src,
  title,
  loading = 'eager',
  timeoutMs = 12000,
}: RouteEmbedFrameProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const frameKey = `${src}:${reloadToken}`;

  return (
    <RouteEmbedFrameInner
      key={frameKey}
      src={src}
      title={title}
      loading={loading}
      timeoutMs={timeoutMs}
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
  onRetry,
}: RouteEmbedFrameInnerProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ready || failed) return;
    const timer = window.setTimeout(() => setFailed(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [failed, ready, timeoutMs]);

  return (
    <div className="route-embed-shell route-embed-shell-framed">
      {!ready ? (
        <div
          className={`route-embed-state ${failed ? 'is-error' : 'is-loading'}`}
          role={failed ? 'alert' : 'status'}
          aria-live="polite"
        >
          {failed ? (
            <div className="route-embed-message">
              <p className="route-embed-title">콘텐츠를 불러오지 못했습니다.</p>
              <p className="route-embed-subtitle">네트워크 상태를 확인하고 다시 시도해 주세요.</p>
              <div className="route-embed-actions">
                <button type="button" className="route-embed-btn" onClick={onRetry}>
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
        src={src}
        title={title}
        loading={loading}
        className="route-embed-frame"
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
