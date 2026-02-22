import Image from "next/image";

const gridImages = [
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-1.jpg",
    alt: "Profile sample grid image 1",
    heightClass: "h-[220px]",
  },
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-3.jpg",
    alt: "Profile sample grid image 3",
    heightClass: "h-[310px]",
  },
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-5.jpg",
    alt: "Profile sample grid image 5",
    heightClass: "h-[310px]",
  },
];

const gridImagesRight = [
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-2.jpg",
    alt: "Profile sample grid image 2",
    heightClass: "h-[310px]",
  },
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-4.jpg",
    alt: "Profile sample grid image 4",
    heightClass: "h-[310px]",
  },
  {
    src: "/admin/design-lab/screenshots/figma-profile-grid-6.jpg",
    alt: "Profile sample grid image 6",
    heightClass: "h-[220px]",
  },
];

function DotIcon({ className }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-current ${className ?? "size-1.5"}`} aria-hidden="true" />;
}

export default function DesignLabProfilePreview() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-100 to-slate-200 p-4 shadow-sm">
      <div className="mx-auto w-full max-w-[375px] overflow-hidden rounded-[30px] border border-slate-300 bg-[#f2f2f2] shadow-[0_24px_55px_-38px_rgba(15,23,42,0.65)]">
        <header className="flex items-center justify-between px-5 pb-5 pt-4 text-[15px] font-semibold text-black">
          <span>9:27</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-900">
            <DotIcon className="size-[6px]" />
            <DotIcon className="size-[6px]" />
            <span className="inline-flex h-[10px] w-[18px] rounded-sm border border-current" aria-hidden="true">
              <span className="ml-auto h-full w-2/3 rounded-[2px] bg-current" />
            </span>
          </span>
        </header>

        <div className="px-4 pb-5">
          <div className="mx-auto size-32 overflow-hidden rounded-full ring-2 ring-white/60">
            <Image
              src="/admin/design-lab/screenshots/figma-profile-avatar.jpg"
              alt="Jane profile avatar"
              width={128}
              height={128}
              className="size-full object-cover"
              priority
            />
          </div>

          <h2
            className="mt-4 text-center text-[52px] leading-none tracking-[-0.03em] text-black"
            style={{ fontFamily: "'Comfortaa', var(--font-sans)" }}
          >
            Jane
          </h2>
          <p className="mt-3 text-center text-[23px] font-black uppercase tracking-[0.04em] text-black">San Francisco, CA</p>

          <div className="mt-8 space-y-4">
            <button
              type="button"
              className="min-h-[52px] w-full rounded-lg border-2 border-black bg-black text-[16px] font-black uppercase tracking-[0.06em] text-white"
            >
              Follow Jane
            </button>
            <button
              type="button"
              className="min-h-[52px] w-full rounded-lg border-2 border-black bg-white text-[16px] font-black uppercase tracking-[0.06em] text-black"
            >
              Message
            </button>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-[9px]">
            <div className="space-y-[9px]">
              {gridImages.map((item) => (
                <div key={item.src} className={`relative overflow-hidden rounded-[2px] ${item.heightClass}`}>
                  <Image src={item.src} alt={item.alt} fill sizes="(max-width: 768px) 45vw, 167px" className="object-cover" />
                </div>
              ))}
            </div>
            <div className="space-y-[9px]">
              {gridImagesRight.map((item) => (
                <div key={item.src} className={`relative overflow-hidden rounded-[2px] ${item.heightClass}`}>
                  <Image src={item.src} alt={item.alt} fill sizes="(max-width: 768px) 45vw, 167px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="grid grid-cols-5 items-center gap-2 text-slate-700">
            <button type="button" className="inline-flex min-h-10 items-center justify-center text-xs font-medium">
              Home
            </button>
            <button type="button" className="inline-flex min-h-10 items-center justify-center text-xs font-medium">
              Search
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-orange-500 px-5 text-lg font-bold text-white"
            >
              +
            </button>
            <button type="button" className="inline-flex min-h-10 items-center justify-center text-xs font-medium">
              Chat
            </button>
            <button type="button" className="inline-flex min-h-10 items-center justify-center text-xs font-medium">
              Profile
            </button>
          </div>
          <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-black" />
        </div>
      </div>
    </section>
  );
}
