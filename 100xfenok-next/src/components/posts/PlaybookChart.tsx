"use client";

import { Chart as ChartJS, registerables, type ChartConfiguration, type ChartOptions } from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(...registerables);
type PlaybookChartId = "debtChart" | "rrpChart" | "financialRepressionChart" | "debtBurdenChart" | "liquidityImpactChart";

const configs: Record<PlaybookChartId, ChartConfiguration<"line" | "bar">> = {} as Record<PlaybookChartId, ChartConfiguration<"line" | "bar">>;
const vibrantPalette = {
    blue: '#4ECDC4',
    red: '#FF6B6B',
    dark: '#1A535C',
    yellow: '#FFE66D',
    light: '#F7FFF7',
    gray: '#555B6E'
};

const mandatoryTooltipOptions: ChartOptions<"line" | "bar"> = {
    plugins: {
        tooltip: {
            callbacks: {
                title: function (tooltipItems) {
                    const item = tooltipItems[0];
                    if (!item) return "";
                    const label = item.chart.data.labels?.[item.dataIndex];
                    if (Array.isArray(label)) {
                        return label.join(' ');
                    } else {
                        return String(label ?? "");
                    }
                }
            }
        }
    }
};

const commonChartOptions: ChartOptions<"line" | "bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    ...mandatoryTooltipOptions,
    interaction: {
        mode: 'index',
        intersect: false,
    },
};

configs.debtChart = {
    type: 'line',
    data: {
        labels: ['2015', '2017', '2019', '2021', '2023', '2025 (E)'],
        datasets: [{
            label: '미국 연방 정부 부채 (조 달러)',
            data: [18.1, 20.2, 22.7, 28.4, 33.1, 37.5],
            borderColor: vibrantPalette.red,
            backgroundColor: 'rgba(255, 107, 107, 0.2)',
            fill: true,
            tension: 0.4
        }]
    },
    options: { ...commonChartOptions }
};

configs.rrpChart = {
    type: 'line',
    data: {
        labels: ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2'],
        datasets: [{
            label: '연준 RRP 잔고 (조 달러)',
            data: [2.3, 2.1, 1.5, 0.9, 0.5, 0.1],
            borderColor: vibrantPalette.dark,
            backgroundColor: 'rgba(26, 83, 92, 0.2)',
            fill: 'start',
            tension: 0.1
        }]
    },
    options: { ...commonChartOptions }
};

configs.financialRepressionChart = {
    type: 'line',
    data: {
        labels: ['2022', '2023', '2024', '2025(E)', '2026(E)'],
        datasets: [{
            label: '명목 GDP 성장률 (%)',
            data: [9.1, 6.3, 5.2, 4.8, 4.5],
            borderColor: vibrantPalette.blue,
            backgroundColor: 'transparent',
            borderWidth: 3,
            pointBackgroundColor: vibrantPalette.blue,
            pointRadius: 5,
        }, {
            label: '정책 금리 (%)',
            data: [2.5, 5.2, 5.5, 4.75, 4.0],
            borderColor: vibrantPalette.red,
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            borderWidth: 3,
            pointBackgroundColor: vibrantPalette.red,
            pointRadius: 5,
        }]
    },
    options: {
        ...commonChartOptions,
        plugins: {
            ...commonChartOptions.plugins,
            legend: {
                position: 'bottom'
            }
        }
    }
};

configs.debtBurdenChart = {
    type: 'bar',
    data: {
        labels: ['2010', '2015', '2020', '2025 (E)'],
        datasets: [
            {
                label: '연방정부 부채 (GDP 대비 %)',
                data: [62, 73, 100, 106],
                backgroundColor: vibrantPalette.red,
            },
            {
                label: '주/지방정부 부채 (GDP 대비 %)',
                data: [20, 18, 16, 15],
                backgroundColor: vibrantPalette.gray,
            }
        ]
    },
    options: {
        ...commonChartOptions,
        scales: {
            x: { stacked: false },
            y: { stacked: false, title: { display: true, text: 'GDP 대비 부채 비율 (%)' } }
        },
        plugins: {
            ...commonChartOptions.plugins,
            legend: {
                position: 'bottom'
            }
        }
    }
};

const stablecoinLabels = ['2024', '2025 (E)', '2026 (E)', '2027 (E)'];
const tBillDemand = [128, 240, 440, 800];
const liquidityIndex = [100, 120, 150, 200];

configs.liquidityImpactChart = {
    type: 'bar',
    data: {
        labels: stablecoinLabels,
        datasets: [
            {
                type: 'bar',
                label: '단기 국채 신규 수요 (10억 달러)',
                data: tBillDemand,
                backgroundColor: 'rgba(78, 205, 196, 0.7)',
                yAxisID: 'y'
            },
            {
                type: 'line',
                label: '유동성 공급 효과 (지수)',
                data: liquidityIndex,
                borderColor: vibrantPalette.red,
                backgroundColor: 'transparent',
                borderWidth: 4,
                pointRadius: 6,
                pointBackgroundColor: vibrantPalette.red,
                yAxisID: 'y1',
                tension: 0.4
            }
        ]
    },
    options: {
        ...commonChartOptions,
        scales: {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                title: {
                    display: true,
                    text: '국채 수요 (10억 달러)'
                }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                title: {
                    display: true,
                    text: '유동성 효과 (지수)'
                },
                grid: {
                    drawOnChartArea: false,
                },
            }
        },
        plugins: {
            ...commonChartOptions.plugins,
            legend: {
                position: 'bottom'
            }
        }
    }
};

export default function PlaybookChart({ id }: { id: PlaybookChartId }) {
  const config = configs[id];
  return <Chart type={config.type} data={config.data} options={config.options}
    aria-label={config.data.datasets.map((series) => series.label).join(" · ")} role="img" />;
}
