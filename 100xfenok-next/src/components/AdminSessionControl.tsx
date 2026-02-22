'use client';

import { useRouter } from "next/navigation";
import { clearAdminAuthenticated } from "@/lib/client/admin-auth";

export default function AdminSessionControl() {
  const router = useRouter();

  return (
    <div className="container mx-auto px-4 pt-4">
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Admin Session Active
          </p>
          <button
            type="button"
            onClick={() => {
              clearAdminAuthenticated();
              router.push("/");
              router.refresh();
            }}
            className="min-h-9 rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:bg-slate-100"
          >
            세션 종료
          </button>
        </div>
      </div>
    </div>
  );
}
