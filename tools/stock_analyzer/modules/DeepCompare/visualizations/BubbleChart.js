/**
 * BubbleChart - DeepCompare 전용 4차원 버블 차트
 *
 * Chart.js 4.x의 bubble 타입을 활용해 ROE, 성장률, 시가총액(버블 크기),
 * PER(색상)을 동시에 표현합니다.
 */
const DeepCompareBubbleChart = (() => {
    let chart = null;

    function render(canvas, dataset = []) {
        if (!canvas) {
            console.warn('[DeepCompareBubbleChart] canvas 요소가 없습니다.');
            return;
        }

        if (!window.Chart) {
            console.warn('[DeepCompareBubbleChart] Chart.js가 로드되지 않았습니다.');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (chart) {
            chart.destroy();
        }

        chart = new Chart(ctx, {
            type: 'bubble',
            data: {
                datasets: [{
                    label: 'DeepCompare 4D',
                    data: dataset,
                    parsing: false,
                    borderColor: 'rgba(30, 64, 175, 0.3)',
                    borderWidth: 1,
                    hoverBorderWidth: 2,
                    hoverBorderColor: 'rgba(30, 64, 175, 0.8)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'ROE (Fwd)' },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                        ticks: { callback: value => `${(value * 100).toFixed(0)}%` }
                    },
                    y: {
                        title: { display: true, text: 'Sales Growth 3Y' },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                        ticks: { callback: value => `${(value * 100).toFixed(0)}%` }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: items => items[0]?.raw?.label || '',
                            label: context => {
                                const meta = context.raw.meta || {};
                                return [
                                    `ROE: ${(context.raw.x * 100).toFixed(1)}%`,
                                    `Growth: ${(context.raw.y * 100).toFixed(1)}%`,
                                    `Market Cap: $${(meta.marketCap || 0).toLocaleString()}M`,
                                    `PER: ${meta.per ? meta.per.toFixed(1) : 'N/A'}`,
                                    `Momentum: ${(meta.momentum * 100).toFixed(1)}%`
                                ];
                            }
                        }
                    },
                    legend: {
                        display: false
                    }
                },
                animation: {
                    duration: 850,
                    easing: 'easeOutQuart'
                },
                onClick: (_, elements) => {
                    if (!elements.length) return;
                    const { raw } = elements[0].element.$context;
                    if (!raw?.meta?.id) return;
                    document.dispatchEvent(new CustomEvent('deepCompare:itemSelected', {
                        detail: raw.meta
                    }));
                }
            }
        });
    }

    return { render };
})();

window.DeepCompareBubbleChart = DeepCompareBubbleChart;

console.log('✅ DeepCompare BubbleChart 모듈 로드 완료');
