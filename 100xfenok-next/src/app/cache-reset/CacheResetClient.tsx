"use client";

import { useEffect, useState } from "react";
import { ROUTES } from "@/lib/routes";

type ResetStatus = {
  label: string;
  state: "pending" | "done" | "failed";
  detail?: string;
};

const INITIAL_STEPS: ResetStatus[] = [
  { label: "HTTP cache reset signal", state: "pending" },
  { label: "Service workers", state: "pending" },
  { label: "CacheStorage buckets", state: "pending" },
  { label: "Legacy design cookie", state: "pending" },
  { label: "Return to home", state: "pending" },
];

function expireCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function updateStep(
  steps: ResetStatus[],
  index: number,
  next: Partial<ResetStatus>,
): ResetStatus[] {
  return steps.map((step, current) => (current === index ? { ...step, ...next } : step));
}

export default function CacheResetClient() {
  const [steps, setSteps] = useState<ResetStatus[]>(INITIAL_STEPS);

  useEffect(() => {
    let cancelled = false;

    const setStep = (index: number, next: Partial<ResetStatus>) => {
      if (!cancelled) setSteps((current) => updateStep(current, index, next));
    };

    const run = async () => {
      try {
        await fetch(`/api/cache-reset/?ts=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
        });
        setStep(0, { state: "done" });
      } catch (error) {
        setStep(0, { state: "failed", detail: error instanceof Error ? error.message : "request failed" });
      }

      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          setStep(1, { state: "done", detail: `${registrations.length} removed` });
        } else {
          setStep(1, { state: "done", detail: "not supported" });
        }
      } catch (error) {
        setStep(1, { state: "failed", detail: error instanceof Error ? error.message : "unregister failed" });
      }

      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
          setStep(2, { state: "done", detail: `${keys.length} removed` });
        } else {
          setStep(2, { state: "done", detail: "not supported" });
        }
      } catch (error) {
        setStep(2, { state: "failed", detail: error instanceof Error ? error.message : "cache delete failed" });
      }

      try {
        expireCookie("fenok_design_version");
        setStep(3, { state: "done" });
      } catch (error) {
        setStep(3, { state: "failed", detail: error instanceof Error ? error.message : "cookie delete failed" });
      }

      window.setTimeout(() => {
        setStep(4, { state: "done" });
        window.location.replace(`${ROUTES.home}?reset=${Date.now()}`);
      }, 1200);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase text-brand-interactive">100xFenok</p>
        <h1 className="mt-3 text-2xl font-black">Cache reset</h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          Clearing stale browser cache and any old service worker, then returning to the current home.
        </p>
        <div className="mt-6 space-y-3">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-bold">{step.label}</p>
                {step.detail ? <p className="mt-1 text-xs text-slate-500">{step.detail}</p> : null}
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-black ${
                  step.state === "done"
                    ? "bg-emerald-50 text-emerald-700"
                    : step.state === "failed"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {step.state}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
