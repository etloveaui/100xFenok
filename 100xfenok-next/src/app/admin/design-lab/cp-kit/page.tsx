import type { Metadata } from "next";

import {
  CpAccordion,
  CpBandVisual,
  CpCTARow,
  CpDataTable,
  CpDivergingBar,
  CpEmptyState,
  CpGaugeCard,
  CpInsightCard,
  CpMeterRow,
  CpMetricTile,
  CpMetricTileGrid,
  CpSectionCard,
  CpStatChipRow,
  CpTimelineStrip,
  CpVerdictHero,
  type CpDataTableColumn,
} from "@/components/canvas-plus/kit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · CANVAS+ W5 Kit Lab",
  description: "CANVAS+ W5 컴포넌트 킷 눈검수용 랩 페이지",
};

type FinancialRow = {
  year: string;
  revenue: string;
  operatingIncome: string;
  netIncome: string;
  forecast?: boolean;
};

const FINANCIAL_ROWS: FinancialRow[] = [
  { year: "FY23", revenue: "3,829억", operatingIncome: "612억", netIncome: "455억" },
  { year: "FY24", revenue: "4,510억", operatingIncome: "788억", netIncome: "590억" },
  { year: "FY25", revenue: "5,102억", operatingIncome: "902억", netIncome: "701억" },
  { year: "FY26E", revenue: "5,780억", operatingIncome: "1,045억", netIncome: "812억", forecast: true },
];

const FINANCIAL_COLUMNS: readonly CpDataTableColumn<FinancialRow>[] = [
  { key: "year", header: "회계연도", align: "left" },
  { key: "revenue", header: "매출액", forecast: false },
  { key: "operatingIncome", header: "영업이익" },
  { key: "netIncome", header: "순이익", forecast: true },
];

export default function CpKitLabPage() {
  return (
    <main className="canvas-plus cp-w5-kit-lab" data-canvas-plus data-canvas-plus-w5-kit-preview>
      <div className="cp-lab">
        <header className="cp-lab__header">
          <p className="cp-lab__eyebrow">CANVAS+ · W5 COMPONENT KIT</p>
          <h1 className="cp-lab__title">컴포넌트 킷 눈검수 랩</h1>
          <p className="cp-lab__summary">
            docs/references/cp-design-system-spec.md 섹션 C 레시피를 그대로 구현한 14개 프레젠테이션 컴포넌트입니다.
            아래 각 카드는 실제 데이터가 아닌 눈검수용 샘플입니다.
          </p>
        </header>

        <div className="cp-lab__grid">
          <div className="cp-lab__span-12">
            <CpVerdictHero
              eyebrow="VALUATION · PER 밴드 위치 (8년)"
              verdict={
                <>
                  저점 대비 <b className="up">+29.0%</b> 올랐지만, 52주 고점까지는 아직{" "}
                  <b className="warn">18.6%</b> 남았다
                </>
              }
              sub="8년 평균 PER 대비 현재 밸류에이션은 중립권 상단에 위치합니다. 실적 서프라이즈가 이어지지 않으면 추가 리레이팅 여력은 제한적입니다."
              trustChips={[
                { label: "현재가", value: "₩128,400", freshness: true },
                { label: "기준일", value: "2026-07-02" },
                { label: "커버리지", value: "8년", tone: "neutral" },
              ]}
            />
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpMetricTile / CpMetricTileGrid" meta="default + large 변형">
              <CpMetricTileGrid>
                <CpMetricTile label="PER" value="18.4" unit="배" sub="8년 평균 16.9배" tone="warning" />
                <CpMetricTile label="PBR" value="2.1" unit="배" sub="업종 평균 대비 +0.3배" />
                <CpMetricTile label="배당수익률" value="1.8" unit="%" sub="전년 대비 +0.2%p" tone="positive" />
                <CpMetricTile label="부채비율" value="42.6" unit="%" sub="업종 중위 51%" tone="positive" />
              </CpMetricTileGrid>
              <CpMetricTileGrid size="large">
                <CpMetricTile size="large" label="시가총액" value="18.2" unit="조원" sub="코스피 12위" />
                <CpMetricTile size="large" label="52주 최고/최저" value="152,000 / 96,500" sub="현재가 대비 -15.5% / +33.1%" />
              </CpMetricTileGrid>
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpStatChipRow" meta="가격/시총/PER/PBR/배당 압축 스트립">
              <CpStatChipRow
                items={[
                  { value: "₩128,400", label: "현재가" },
                  { value: "18.2조원", label: "시가총액" },
                  { value: "18.4배", label: "PER" },
                  { value: "2.1배", label: "PBR" },
                  { value: "1.8%", label: "배당수익률", tone: "positive" },
                ]}
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard
              title="CpMeterRow — boxed"
              meta="스크리너 검증 강도"
              eyebrow="SCREENER · VERDICT METERS"
            >
              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                <CpMeterRow variant="boxed" label="밸류에이션 매력도" value="82" percent={82} tone="strong" />
                <CpMeterRow variant="boxed" label="모멘텀 지속성" value="46" percent={46} tone="watch" />
              </div>
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpMeterRow — axis" variant="edge" eyebrow="EDGE · 5축 분해" meta="8개 지표 기준일 2026-07-02">
              <CpMeterRow variant="axis" label="밸류에이션" value="72" percent={72} tone="positive" toneWord="강함" />
              <CpMeterRow variant="axis" label="모멘텀" value="38" percent={38} tone="warning" toneWord="주의" />
              <CpMeterRow variant="axis" label="수급" value="55" percent={55} tone="neutral" toneWord="중립" />
              <CpMeterRow variant="axis" label="퀄리티" value="20" percent={20} tone="negative" toneWord="약함" />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpGaugeCard" meta="Edge 종합 점수">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "center" }}>
                <CpGaugeCard
                  value={72}
                  displayValue={72}
                  unitLabel="EDGE SCORE"
                  tone="positive"
                  sub={
                    <>
                      단기 우위 <b>긍정적</b> — 8개 지표 중 6개가 개선 방향입니다.
                    </>
                  }
                />
                <CpGaugeCard value={34} unitLabel="SHORT SCORE" tone="warning" sub="단기 모멘텀은 관망 구간입니다." size={160} />
              </div>
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpBandVisual" meta="PER 밴드 (8년)">
              <CpBandVisual
                label="현재 PER 위치"
                currentLabel="현재"
                currentValue="18.4x"
                position={62}
                lowLabel="12.4x"
                midLabel="17.1x"
                highLabel="23.6x"
                summary="8년 평균 대비 상단 62% 구간 — 중립권 상단에서 등락 중입니다."
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpDivergingBar" meta="매수/매도 의견 분포 + 보유기관 순증감">
              <CpDivergingBar
                segments={[
                  { label: "매수 62%", percent: 62, tone: "positive" },
                  { label: "중립 28%", percent: 28, tone: "neutral" },
                  { label: "매도 10%", percent: 10, tone: "negative" },
                ]}
                net={{ label: "기관 순매수", value: "+1.8조원", direction: "up", sub: "최근 4개 분기 누적" }}
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpTimelineStrip" meta="공시 캘린더">
              <CpTimelineStrip
                rows={[
                  {
                    typeLabel: "10-K",
                    events: [
                      { state: "done", tone: "positive", dateLabel: "02-14" },
                      { state: "pending", tone: "neutral", dateLabel: "예정" },
                    ],
                  },
                  {
                    typeLabel: "8-K",
                    events: [
                      { state: "done", tone: "warning", dateLabel: "01-08" },
                      { state: "highlight", tone: "negative", dateLabel: "05-22" },
                      { state: "pending", tone: "neutral", dateLabel: "예정" },
                    ],
                  },
                ]}
                legendItems={[
                  { label: "정기공시", tone: "positive" },
                  { label: "주요사항", tone: "warning" },
                  { label: "핵심 이벤트", tone: "negative" },
                ]}
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpDataTable" meta="다년 재무제표 (dense 밀도)">
              <CpDataTable
                columns={FINANCIAL_COLUMNS}
                rows={FINANCIAL_ROWS}
                getRowKey={(row) => row.year}
                density="dense"
                emphRowKeys={new Set(["FY25"])}
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpAccordion" meta="전체 보기 디스클로저">
              <CpAccordion title="분기별 실적 상세" meta="최근 12개 분기">
                <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
                  분기별 매출/영업이익/순이익 추이와 컨센서스 대비 서프라이즈율이 여기에 표시됩니다.
                </p>
              </CpAccordion>
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpInsightCard" meta="공시 피드 카드">
              <CpInsightCard
                badgeLabel="8-K"
                badgeTone="warning"
                dateLabel="2026-05-22"
                headline="이사회, 자사주 3,000억원 추가 매입 승인"
                bullets={[
                  { tone: "fact", tagLabel: "FACT", text: "자사주 매입 한도를 기존 대비 2배로 확대했습니다." },
                  { tone: "risk", tagLabel: "RISK", text: "매입 재원은 단기차입금으로 조달 예정 — 부채비율 상승 요인." },
                  { tone: "claim", tagLabel: "CLAIM", text: "경영진은 '저평가 구간에서의 주주환원 강화'라고 설명했습니다." },
                ]}
                expandHref="#"
                expandLabel="원문 근거 보기"
              />
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpEmptyState" meta="axis / skip-note 변형">
              <div style={{ display: "grid", gap: 10 }}>
                <CpEmptyState variant="axis" message="이 지표는 최근 4분기 데이터가 부족해 표시를 생략합니다." />
                <CpEmptyState variant="skip-note" message="이 축은 표시 생략 — 커버리지 기준 미충족" />
              </div>
            </CpSectionCard>
          </div>

          <div className="cp-lab__span-12">
            <CpSectionCard title="CpCTARow" meta="Footer 액션 행">
              <CpCTARow
                primary={{ label: "전체 리포트 보기", href: "#" }}
                secondary={{ label: "관심종목 추가", href: "#" }}
                note="투자 조언 아님"
              />
              <CpCTARow
                primary={{ label: "비활성 예시", disabled: true }}
                secondary={{ label: "비활성 예시", disabled: true }}
              />
            </CpSectionCard>
          </div>
        </div>
      </div>
    </main>
  );
}
