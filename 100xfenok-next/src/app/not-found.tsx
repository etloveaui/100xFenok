'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[calc(100dvh-8rem)] flex items-center justify-center px-4">
      <div className="text-center max-w-lg w-full">
        {/* Animated 404 Number */}
        <div className="relative mb-8">
          <div className="text-[120px] sm:text-[180px] font-black text-slate-100 leading-none select-none orbitron">
            404
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl sm:text-8xl font-black orbitron bg-gradient-to-br from-brand-navy to-brand-interactive bg-clip-text text-transparent">
              404
            </span>
          </div>
        </div>

        {/* Icon */}
        <div className="mb-6">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 flex items-center justify-center shadow-lg">
            <i className="fas fa-compass text-3xl text-brand-navy animate-pulse" />
          </div>
        </div>

        {/* Message */}
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-3 orbitron">
          Page Not Found
        </h1>
        <p className="text-slate-500 mb-8 text-base sm:text-lg leading-relaxed">
          The page you are looking for does not exist or has been moved.
          <br className="hidden sm:block" />
          Please check the URL or return to the dashboard.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-brand-navy text-white font-bold rounded-xl shadow-lg shadow-brand-navy/25 hover:shadow-xl hover:shadow-brand-navy/30 hover:-translate-y-0.5 transition-all duration-300"
          >
            <i className="fas fa-home" />
            Go to Dashboard
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white text-slate-700 font-bold rounded-xl border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all duration-300"
          >
            <i className="fas fa-arrow-left" />
            Go Back
          </button>
        </div>

        {/* Decorative Elements */}
        <div className="mt-12 flex justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-slate-200" />
          <span className="w-2 h-2 rounded-full bg-slate-300" />
          <span className="w-2 h-2 rounded-full bg-slate-200" />
        </div>

        {/* Brand */}
        <div className="mt-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-navy to-brand-interactive flex items-center justify-center text-white text-xs font-bold">
              100x
            </div>
            <span className="font-bold orbitron text-slate-700 group-hover:text-brand-navy transition-colors">
              FENOK
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
