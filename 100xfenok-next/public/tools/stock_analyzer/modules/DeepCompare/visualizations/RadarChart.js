/**
 * RadarChart - DeepCompare 용 다중 레이더 차트
 *
 * 기업별 핵심 지표를 0~100 스케일로 시각화합니다.
 */
const DeepCompareRadarChart = (() => {
    let chart = null;

    function render(canvas, dataset) {
        if (!canvas) {
            console.warn('[DeepCompareRadarChart] canvas 요소가 없습니다.');
            return;
        }

        if (!window.Chart) {
            console.warn('[DeepCompareRadarChart] Chart.js가 로드되지 않았습니다.');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (chart) {
            chart.destroy();
        }

        chart = new Chart(ctx, {
            type: 'radar',
            data: dataset,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: {
                            display: true,
                            stepSize: 20
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.2)'
                        },
                        angleLines: {
                            color: 'rgba(148, 163, 184, 0.2)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.dataset.label}: ${context.formattedValue}%`
                        }
                    }
                },
                animation: {
                    duration: 650,
                    easing: 'easeOutQuad'
                }
            }
        });
    }

    return { render };
})();

window.DeepCompareRadarChart = DeepCompareRadarChart;

console.log('✅ DeepCompare RadarChart 모듈 로드 완료');
