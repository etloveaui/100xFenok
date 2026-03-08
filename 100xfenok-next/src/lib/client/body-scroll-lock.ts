type BodyScrollLockState = {
  keys: Set<string>;
  snapshot:
    | {
        overflow: string;
        position: string;
        top: string;
        left: string;
        right: string;
        width: string;
        scrollY: number;
      }
    | null;
};

declare global {
  interface Window {
    __fenokBodyScrollLockState__?: BodyScrollLockState;
  }
}

function getLockState(): BodyScrollLockState | null {
  if (typeof window === "undefined") return null;

  if (!window.__fenokBodyScrollLockState__) {
    window.__fenokBodyScrollLockState__ = {
      keys: new Set<string>(),
      snapshot: null,
    };
  }

  return window.__fenokBodyScrollLockState__;
}

export function lockBodyScroll(key: string): void {
  const state = getLockState();
  if (!state || !key) return;

  if (state.keys.has(key)) {
    return;
  }

  if (state.keys.size === 0) {
    const body = document.body;
    state.snapshot = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      scrollY: window.scrollY,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${state.snapshot.scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
  }

  state.keys.add(key);
}

export function unlockBodyScroll(key: string): void {
  const state = getLockState();
  if (!state || !key) return;

  state.keys.delete(key);
  if (state.keys.size > 0 || !state.snapshot) {
    return;
  }

  const body = document.body;
  const snapshot = state.snapshot;

  body.style.overflow = snapshot.overflow;
  body.style.position = snapshot.position;
  body.style.top = snapshot.top;
  body.style.left = snapshot.left;
  body.style.right = snapshot.right;
  body.style.width = snapshot.width;
  window.scrollTo(0, snapshot.scrollY);

  state.snapshot = null;
}
