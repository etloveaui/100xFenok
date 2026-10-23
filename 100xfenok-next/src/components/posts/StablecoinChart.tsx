"use client";

import { Chart as ChartJS, registerables, type ChartConfiguration } from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(...registerables);
type StablecoinChartId = "rrpFlowChart" | "assetAttractivenessChart";
const configs: Record<StablecoinChartId, ChartConfiguration<"line" | "radar">> = {} as Record<StablecoinChartId, ChartConfiguration<"line" | "radar">>;
// RRP 플로우 차트
configs.rrpFlowChart = {
    type: 'line',
    data: {
        labels: ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2', '2025-Q1'],
        datasets: [{
            label: 'RRP 잔고 (조 달러)',
            data: [2.3, 2.1, 1.5, 0.9, 0.5, 0.2, 0.0],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            fill: true,
            tension: 0.4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#e2e8f0'
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: '#e2e8f0'
                }
            },
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: '#e2e8f0'
                }
            }
        }
    }
};

// 자산 매력도 레이더 차트
configs.assetAttractivenessChart = {
    type: 'radar',
    data: {
        labels: ['AI/반도체', '방산', '원자재', '금', '부동산', '에너지'],
        datasets: [{
            label: '매력도 점수',
            data: [9.5, 8.5, 8.0, 7.5, 7.0, 8.5],
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            borderColor: '#3b82f6',
            pointBackgroundColor: '#3b82f6',
            pointBorderColor: '#ffffff',
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#3b82f6'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            r: {
                angleLines: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                pointLabels: {
                    color: '#e2e8f0',
                    font: {
                        size: 14
                    }
                },
                ticks: {
                    display: false,
                    backdropColor: 'transparent'
                }
            }
        },
        plugins: {
            legend: {
                labels: {
                    color: '#e2e8f0'
                }
            }
        }
    }
};

export default function StablecoinChart({ id }: { id: StablecoinChartId }) {
  const config = configs[id];
  return <Chart type={config.type} data={config.data} options={config.options}
    aria-label={config.data.datasets.map((series) => series.label).join(" · ")} role="img" />;
}
