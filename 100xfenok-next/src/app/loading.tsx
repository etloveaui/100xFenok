// Route-level Suspense fallback shown during navigation. Kept light + neutral
// so it matches the v5 light theme for every surface (the old V1 bento
// skeleton had a dark `bg-slate-950` hero tile that flashed jarringly when
// navigating away from the v5 home).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-x-hidden px-3 py-4 sm:px-4">
      {/* top status bar */}
      <div className="mb-4 h-14 w-full rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="skeleton-bar h-3 w-40" />
      </div>
      {/* hero / lead block */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="skeleton-bar mb-3 h-3 w-28" />
        <div className="skeleton-bar mb-4 h-9 w-64" />
        <div className="space-y-2.5">
          <div className="skeleton-bar h-3 w-full" />
          <div className="skeleton-bar h-3 w-[88%]" />
        </div>
      </div>
      {/* content cards */}
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={`loading-card-${i}`}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="skeleton-bar mb-3 h-3 w-32" />
            <div className="skeleton-bar mb-2 h-4 w-full" />
            <div className="skeleton-bar h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
