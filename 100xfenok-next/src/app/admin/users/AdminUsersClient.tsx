"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export interface UserEntryView {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  firstSeen: string;
  lastSeen: string;
  loginCount: number;
  devices: string[];
  blocked: boolean;
}

export interface UserStatsView {
  now: number;
  today: number;
  sevenDays: number;
  total: number;
}

function formatRelativeTime(isoString: string, nowMs: number): { text: string; isRecent: boolean } {
  const time = new Date(isoString).getTime();
  const diffMs = Math.max(0, nowMs - time);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return { text: "방금 전", isRecent: true };
  if (diffMin < 5) return { text: `${diffMin}분 전`, isRecent: true };
  if (diffMin < 60) return { text: `${diffMin}분 전`, isRecent: false };
  if (diffHour < 24) return { text: `${diffHour}시간 전`, isRecent: false };
  return { text: `${diffDay}일 전`, isRecent: false };
}

function formatDateDisplay(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

export default function AdminUsersClient() {
  const [stats, setStats] = useState<UserStatsView | null>(null);
  const [users, setUsers] = useState<UserEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "blocked">("all");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const fetchUsers = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; stats: UserStatsView; users: UserEntryView[] };
        if (data.ok) {
          setStats(data.stats);
          setUsers(data.users);
          setNowMs(Date.now());
        }
      }
    } catch {
      // Ignore background network error
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(() => {
      fetchUsers();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  const handleBlockToggle = async (user: UserEntryView) => {
    const action = user.blocked ? "unblock" : "block";
    const confirmed = window.confirm(
      user.blocked
        ? `[${user.name || user.email}] 사용자의 차단을 해제하시겠습니까?`
        : `[${user.name || user.email}] 사용자를 차단하시겠습니까? 즉시 로그인이 거부됩니다.`,
    );
    if (!confirmed) return;

    setActionInProgress(`${action}:${user.sub}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sub: user.sub }),
      });
      if (res.ok) {
        await fetchUsers(true);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRevokeAll = async (user: UserEntryView) => {
    const confirmed = window.confirm(
      `[${user.name || user.email}] 사용자의 모든 기기 세션을 초기화하시겠습니까? 연결된 모든 브라우저에서 즉시 로그아웃됩니다.`,
    );
    if (!confirmed) return;

    setActionInProgress(`revokeAll:${user.sub}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revokeAll", sub: user.sub }),
      });
      if (res.ok) {
        await fetchUsers(true);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (filterMode === "active") {
        const diff = nowMs - new Date(u.lastSeen).getTime();
        if (diff > 5 * 60 * 1000) return false;
      } else if (filterMode === "blocked") {
        if (!u.blocked) return false;
      }

      if (!query) return true;
      return (
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.sub.toLowerCase().includes(query)
      );
    });
  }, [users, searchQuery, filterMode, nowMs]);

  return (
    <main className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Navigation Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Link href="/admin" className="hover:text-slate-900 transition-colors">
          Admin Hub
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-bold">사용자 접속 현황 (User Registry)</span>
      </div>

      {/* Header Banner */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                WHO IS VIEWING
              </span>
              <span className="text-xs text-white/70">Durable Object SQLite</span>
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-black tracking-tight">사용자 레지스트리</h1>
            <p className="mt-1 text-xs md:text-sm text-white/80">
              실시간 접속자(5분 이내), 당일 및 7일 접속 통계, 로그인 이력, 계정 차단 및 원격 기기 세션 초기화
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchUsers(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20 disabled:opacity-50 cursor-pointer"
            >
              <i className={`fas fa-rotate-right ${refreshing ? "fa-spin" : ""}`} aria-hidden="true" />
              <span>새로고침</span>
            </button>
          </div>
        </div>
      </section>

      {/* KPI Cards Grid */}
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Card 1: Now (Live active) */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">지금 접속 중</span>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {stats ? stats.now : "-"}
            </span>
            <span className="text-xs text-slate-500">명</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">최근 5분 이내 활성</p>
        </div>

        {/* Card 2: Today */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">오늘 접속</span>
            <i className="fas fa-calendar-day text-slate-500 text-xs" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {stats ? stats.today : "-"}
            </span>
            <span className="text-xs text-slate-500">명</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">오늘 (KST 기준)</p>
        </div>

        {/* Card 3: 7 Days */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">최근 7일</span>
            <i className="fas fa-calendar-week text-slate-500 text-xs" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {stats ? stats.sevenDays : "-"}
            </span>
            <span className="text-xs text-slate-500">명</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">최근 7일 활성 계정</p>
        </div>

        {/* Card 4: Total */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">전체 등록</span>
            <i className="fas fa-users text-slate-500 text-xs" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {stats ? stats.total : "-"}
            </span>
            <span className="text-xs text-slate-500">명</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">누적 가입 사용자</p>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                filterMode === "all"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              전체 ({users.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("active")}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                filterMode === "active"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              접속 중 ({stats ? stats.now : 0})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("blocked")}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                filterMode === "blocked"
                  ? "bg-rose-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              차단됨 ({users.filter((u) => u.blocked).length})
            </button>
          </div>

          <div className="relative min-w-[240px] max-w-md">
            <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="이름, 이메일 검색..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-slate-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Users Table */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 font-medium">
            사용자 목록을 불러오는 중입니다...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 font-medium">
            조건에 일치하는 사용자가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3">사용자</th>
                  <th scope="col" className="px-4 py-3">최초 등록</th>
                  <th scope="col" className="px-4 py-3">최근 활동</th>
                  <th scope="col" className="px-4 py-3 text-center">로그인 수</th>
                  <th scope="col" className="px-4 py-3">기기</th>
                  <th scope="col" className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredUsers.map((user) => {
                  const rel = formatRelativeTime(user.lastSeen, nowMs);
                  const isBlockingThis = actionInProgress === `block:${user.sub}` || actionInProgress === `unblock:${user.sub}`;
                  const isRevokingThis = actionInProgress === `revokeAll:${user.sub}`;

                  return (
                    <tr
                      key={user.sub}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        user.blocked ? "bg-rose-50/30" : ""
                      }`}
                    >
                      {/* User profile */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          {user.picture ? (
                            <img
                              src={user.picture}
                              alt={user.name || "사용자"}
                              className="size-9 rounded-full object-cover border border-slate-200"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="size-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600">
                              {(user.name || user.email || "U").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-sm truncate max-w-[160px]">
                                {user.name || "(이름 없음)"}
                              </span>
                              {user.blocked && (
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-bold text-rose-700">
                                  차단됨
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 truncate max-w-[200px]">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* First Seen */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-600">
                        {formatDateDisplay(user.firstSeen)}
                      </td>

                      {/* Last Seen */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {rel.isRecent ? (
                            <span className="size-2 rounded-full bg-emerald-500" />
                          ) : (
                            <span className="size-2 rounded-full bg-slate-300" />
                          )}
                          <span className={`font-semibold ${rel.isRecent ? "text-emerald-700 font-bold" : "text-slate-800"}`}>
                            {rel.text}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDateDisplay(user.lastSeen)}
                        </p>
                      </td>

                      {/* Login Count */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <span className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                          {user.loginCount.toLocaleString()} 회
                        </span>
                      </td>

                      {/* Devices */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {user.devices && user.devices.length > 0 ? (
                            user.devices.map((dev, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 truncate max-w-[120px]"
                                title={dev}
                              >
                                {dev}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">-</span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Block / Unblock */}
                          <button
                            type="button"
                            onClick={() => handleBlockToggle(user)}
                            disabled={isBlockingThis}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer border ${
                              user.blocked
                                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                : "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                            } disabled:opacity-50`}
                          >
                            {isBlockingThis
                              ? "처리 중..."
                              : user.blocked
                                ? "차단 해제"
                                : "차단"}
                          </button>

                          {/* Revoke All Devices */}
                          <button
                            type="button"
                            onClick={() => handleRevokeAll(user)}
                            disabled={isRevokingThis}
                            title="모든 기기 세션 초기화 (로그아웃)"
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50 cursor-pointer"
                          >
                            {isRevokingThis ? "초기화 중..." : "세션 초기화"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
