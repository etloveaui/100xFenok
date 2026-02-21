export default function Loading() {
  return (
    <main className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <section className="command-toolbar">
        <div className="command-main">
          <div className="tab-pills">
            <div className="skeleton-bar h-11 w-20 rounded-full" />
            <div className="skeleton-bar h-11 w-20 rounded-full" />
            <div className="skeleton-bar h-11 w-20 rounded-full" />
          </div>
          <div className="skeleton-bar h-11 w-24 rounded-xl" />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bento-card p-4">
          <div className="skeleton-bar mb-3 h-3 w-24" />
          <div className="skeleton-bar h-8 w-28" />
        </div>
        <div className="bento-card p-4">
          <div className="skeleton-bar mb-3 h-3 w-24" />
          <div className="skeleton-bar h-8 w-20" />
        </div>
        <div className="bento-card p-4">
          <div className="skeleton-bar mb-3 h-3 w-24" />
          <div className="skeleton-bar h-8 w-32" />
        </div>
      </section>
    </main>
  );
}
