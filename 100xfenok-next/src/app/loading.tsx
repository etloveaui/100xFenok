export default function Loading() {
  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      {/* Hero Zone skeleton — matches 3-card layout in page.tsx */}
      <section className="mb-4">
        <div className="hero-zone min-w-0">
          <div className="bento-card p-4">
            <div className="skeleton-bar h-3 w-20 mb-2" />
            <div className="skeleton-bar h-10 w-16" />
          </div>
          <div className="bento-card p-4">
            <div className="skeleton-bar h-3 w-20 mb-2" />
            <div className="skeleton-bar h-6 w-24" />
          </div>
          <div className="bento-card p-4">
            <div className="skeleton-bar h-3 w-20 mb-2" />
            <div className="skeleton-bar h-6 w-full" />
          </div>
        </div>
      </section>

      {/* Primary widget grid skeleton — matches 3-card overview-widget-grid */}
      <section className="overview-widget-grid mb-4">
        <div className="bento-card overview-widget-card p-4">
          <div className="skeleton-bar h-3 w-24 mb-3" />
          <div className="skeleton-bar h-20 w-full" />
        </div>
        <div className="bento-card overview-widget-card p-4">
          <div className="skeleton-bar h-3 w-24 mb-3" />
          <div className="skeleton-bar h-20 w-full" />
        </div>
        <div className="bento-card overview-widget-card p-4">
          <div className="skeleton-bar h-3 w-24 mb-3" />
          <div className="skeleton-bar h-20 w-full" />
        </div>
      </section>

      {/* Secondary widget grid skeleton — matches 2-card secondary grid */}
      <section className="overview-widget-grid overview-widget-grid--secondary">
        <div className="bento-card overview-widget-card p-4">
          <div className="skeleton-bar h-3 w-20 mb-3" />
          <div className="skeleton-bar h-12 w-full" />
        </div>
        <div className="bento-card overview-widget-card p-4">
          <div className="skeleton-bar h-3 w-20 mb-3" />
          <div className="skeleton-bar h-12 w-full" />
        </div>
      </section>
    </div>
  );
}
