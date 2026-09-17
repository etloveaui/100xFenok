"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchMe,
  onAuthInvalid,
  postAuthLogout,
  type UserProfileClient,
} from "@/lib/auth/clientAuth";

export default function UserAuthPill() {
  const [user, setUser] = useState<UserProfileClient | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingLogout, setLoadingLogout] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((res) => {
        if (!cancelled && res.ok && res.user) {
          setUser(res.user);
        }
      })
      .catch(() => {});

    const unsubscribe = onAuthInvalid(() => {
      if (!cancelled) {
        setUser(null);
        setOpen(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Close popover when tapping outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  if (!user) return null;

  const initial = (user.name || user.email || "U").charAt(0).toUpperCase();

  const handleLogout = async () => {
    setLoadingLogout(true);
    try {
      await postAuthLogout();
      setUser(null);
      setOpen(false);
    } finally {
      setLoadingLogout(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      data-testid="user-auth-pill"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center w-7 h-7 rounded-full border border-[var(--fnk-color-border)] bg-[var(--fnk-color-card)] overflow-hidden cursor-pointer hover:border-[var(--fnk-color-ring)] transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--fnk-color-ring)]"
        aria-label="사용자 계정 메뉴"
        aria-expanded={open}
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name || "사용자 프로필"}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-[12px] font-semibold text-[var(--fnk-neutral-700)]">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="계정 메뉴"
          className="absolute right-0 top-full mt-2 z-50 min-w-[180px] rounded-xl border border-[var(--fnk-color-border)] bg-[var(--fnk-color-card)] p-3 shadow-lg flex flex-col gap-2.5 text-left"
          style={{ boxShadow: "var(--shadow-card-light)" }}
        >
          <div className="flex flex-col gap-0.5">
            {user.name && (
              <span className="text-[13px] font-semibold text-[var(--fnk-color-card-foreground)] truncate max-w-[190px]">
                {user.name}
              </span>
            )}
            <span className="text-[11px] text-[var(--fnk-neutral-500)] truncate max-w-[190px]">
              {user.email}
            </span>
          </div>

          <div className="h-[1px] bg-[var(--fnk-color-border)] my-0.5" />

          <button
            type="button"
            onClick={handleLogout}
            disabled={loadingLogout}
            className="w-full text-left px-2.5 py-1.5 text-[12px] font-medium text-[var(--fnk-color-destructive)] rounded-lg hover:bg-[var(--fnk-color-destructive-soft)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loadingLogout ? "로그아웃 중..." : "로그아웃"}
          </button>
        </div>
      )}
    </div>
  );
}
