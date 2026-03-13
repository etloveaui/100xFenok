type RegimeSignalProps = {
  regimeLabel: string;
  regimeClass: string;
  regimeConfidence: number;
};

export default function RegimeSignal({ regimeLabel, regimeClass, regimeConfidence }: RegimeSignalProps) {
  return (
    <div className="bento-card p-4">
      <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">Regime</h3>
      <div className="flex items-center justify-between gap-3">
        <div className={`regime-badge ${regimeClass}`}>
          <i className="fas fa-rocket text-xs" />
          <span>{regimeLabel}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-600">신호 강도</p>
          <p className="text-xl font-bold text-emerald-800 orbitron">{regimeConfidence}%</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        심리, 섹터 확산, 스트레스 지표를 합쳐 현재 시장의 방향성을 보여줍니다.
      </p>
    </div>
  );
}
