export default function Loading() {
  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <section className="grid auto-rows-[minmax(138px,auto)] grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 lg:gap-4">
        <div className="col-span-2 rounded-[1.5rem] border border-slate-200 bg-slate-950 p-4 lg:col-span-2 lg:row-span-2">
          <div className="skeleton-bar h-3 w-28 mb-3" />
          <div className="skeleton-bar h-10 w-40 mb-4" />
          <div className="space-y-3">
            <div className="skeleton-bar h-3 w-full" />
            <div className="skeleton-bar h-3 w-[92%]" />
            <div className="skeleton-bar h-3 w-[88%]" />
          </div>
        </div>

        {[
          "col-span-2 sm:col-span-1 lg:col-span-2",
          "col-span-1",
          "col-span-1",
          "col-span-1 sm:col-span-2 lg:col-span-2",
          "col-span-1",
          "col-span-2 sm:col-span-1",
          "col-span-2 sm:col-span-3 lg:col-span-2",
          "col-span-2 sm:col-span-2 lg:col-span-2",
        ].map((tileClass, index) => (
          <div
            key={`bento-loading-${index}`}
            className={`${tileClass} rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm`}
          >
            <div className="skeleton-bar h-3 w-24 mb-3" />
            <div className="skeleton-bar h-7 w-32 mb-3" />
            <div className="skeleton-bar h-16 w-full" />
          </div>
        ))}
      </section>
    </div>
  );
}
