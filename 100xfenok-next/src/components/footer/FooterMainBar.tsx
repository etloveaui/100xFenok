type FooterMainBarProps = {
  statusLabel: string;
  statusClassName: string;
  etClock: string;
  hasAdminSession: boolean;
  showInstallAction: boolean;
  onShareClick: () => void;
  onMarketStatusClick: () => void;
  onNotificationClick: () => void;
  onAdminClick: () => void;
  onInstallClick: () => void;
};

export default function FooterMainBar({
  statusLabel,
  statusClassName,
  etClock,
  hasAdminSession,
  showInstallAction,
  onShareClick,
  onMarketStatusClick,
  onNotificationClick,
  onAdminClick,
  onInstallClick,
}: FooterMainBarProps) {
  return (
    <div className="bg-white/95 backdrop-blur-md border-t border-brand-navy/20 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="h-12 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onShareClick}
            className="flex items-center gap-2 group cursor-pointer min-w-0"
            aria-label="Copy URL"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-navy/10 to-brand-interactive/10 flex items-center justify-center text-brand-navy group-hover:from-brand-navy group-hover:to-brand-interactive group-hover:text-white transition-all duration-300 flex-shrink-0">
              <i className="fas fa-chart-line" />
            </div>
            <div className="hidden sm:flex flex-col">
              <span className="font-[800] orbitron text-slate-800 text-sm group-hover:text-brand-interactive transition-colors leading-none">
                100x <span className="text-brand-gold">FENOK</span>
              </span>
              <span className="text-[8px] text-slate-600">© 2025 All rights reserved</span>
            </div>
          </button>

          <div className="flex-1 flex justify-center min-w-0">
            <p className="hidden md:block text-[11px] text-slate-600 truncate max-w-[400px]">
              모든 정보는 투자 참고용이며, <span className="font-bold text-slate-800">최종 판단과 책임은 본인에게 있습니다.</span>
            </p>
            <div className="md:hidden flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={onMarketStatusClick}
                className={`min-h-11 px-3 py-1.5 rounded text-white text-[10px] font-bold tracking-wide shadow-sm ${statusClassName}`}
                aria-label="Market Status"
              >
                {statusLabel}
              </button>
              <button
                type="button"
                onClick={onMarketStatusClick}
                className="text-[10px] font-semibold text-slate-500"
                aria-label="Market time"
              >
                LIVE ET {etClock}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onNotificationClick}
              className="w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
              aria-label="Notifications"
            >
              <i className="fas fa-bell text-sm" />
            </button>
            <button
              type="button"
              onClick={onAdminClick}
              className={`w-11 h-11 rounded-lg border flex items-center justify-center transition-all duration-200 ${hasAdminSession ? 'bg-brand-navy text-white border-brand-navy hover:bg-brand-interactive' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-brand-interactive'}`}
              aria-label={hasAdminSession ? 'Admin (authenticated)' : 'Admin'}
              aria-haspopup="dialog"
            >
              <i className="fas fa-cog text-sm" />
            </button>
            <button
              type="button"
              onClick={onInstallClick}
              className={`w-11 h-11 rounded-lg border flex items-center justify-center transition-all duration-200 ${
                showInstallAction
                  ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-brand-interactive'
                  : 'bg-slate-50/60 border-slate-200 text-slate-300'
              }`}
              aria-label="앱 설치"
              disabled={!showInstallAction}
            >
              <i className="fas fa-download text-sm" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
