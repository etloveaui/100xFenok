/**
 * 100x Daily Wrap 데이터 렌더러 (renderer.js) - 최종 완성본
 * 기능:
 * 1. URL 파라미터 또는 오늘 날짜를 기준으로 data.json 파일 경로를 결정합니다.
 * 2. 해당 JSON 파일을 불러옵니다.
 * 3. 불러온 데이터를 daily-wrap-viewer.html의 각 요소에 채워 넣습니다.
 * 4. 데이터가 없을 경우, 에러 메시지를 표시합니다.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 로딩 인디케이터를 먼저 표시
    const loadingIndicator = document.getElementById('loading-indicator');
    const contentWrapper = document.getElementById('report-content-wrapper');
    loadingIndicator.style.display = 'block';
    contentWrapper.style.visibility = 'hidden';

    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');

    // 뷰어 URL 기준으로 basePath 계산 (DOMContentLoaded 시 document.currentScript는 null일 수 있음)
    const basePath = new URL('.', window.location.href).pathname.replace(/\/$/, '');

    loadReportData(basePath, dateParam)
        .then(({ data, dataUrl, fallbackFromUrl }) => {
            try {
                populatePage(data);
            } catch (renderError) {
                renderError.dataUrl = dataUrl;
                throw renderError;
            }
            // 데이터 로딩 성공 시, 로딩 인디케이터 숨기고 콘텐츠 표시
            loadingIndicator.style.display = 'none';
            contentWrapper.style.visibility = 'visible';

            if (fallbackFromUrl) {
                console.warn('[DailyWrap] 오늘자 파일이 없어 최신 데이터로 fallback 로드했습니다.', {
                    from: fallbackFromUrl,
                    to: dataUrl,
                });
            } else {
                console.info('[DailyWrap] 리포트 데이터 로드 성공:', dataUrl);
            }

            // Alpine.js가 동적으로 추가된 컴포넌트를 초기화하도록 강제
            if (window.Alpine) {
                window.Alpine.start();
            }
        })
        .catch(error => {
            const failedUrl = error && error.dataUrl ? error.dataUrl : '(unknown)';
            console.error('리포트 데이터를 불러오는 데 실패했습니다:', error);
            const errorHtml = `
                <div style="text-align: center; padding: 50px; color: #333;">
                    <h2 style="font-size: 1.5rem; font-weight: bold;">리포트를 불러올 수 없습니다.</h2>
                    <p style="color: #666;">선택하신 날짜의 리포트가 존재하지 않거나, 아직 발행되지 않았습니다.</p>
                    <p style="color: #999; font-size: 0.8rem;">(요청 경로: ${failedUrl})</p>
                </div>
            `;
            // 로딩 인디케이터 영역에 에러 메시지 표시
            loadingIndicator.innerHTML = errorHtml;
        });
});

// --- 헬퍼 함수 ---
const setText = (id, text) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text || '';
};

const setHtml = (id, htmlString) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = htmlString || '';
};

const FALLBACK_CACHE_KEY = 'dailyWrap.latestDataDate';
const KNOWN_DATA_FALLBACK_DATES = ['2025-07-12', '2025-07-11'];
const DATE_ONLY_REGEX = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_JSON_REGEX = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DATE_DATA_JSON_REGEX = /^(\d{4}-\d{2}-\d{2})-data\.json$/;

const formatDateForFile = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const buildDataUrl = (basePath, dateString) => `${basePath}/data/${dateString}-data.json`;

const createLoadError = (message, dataUrl, status) => {
    const error = new Error(message);
    if (dataUrl) error.dataUrl = dataUrl;
    if (typeof status === 'number') error.status = status;
    return error;
};

const getCachedFallbackDate = () => {
    try {
        const cached = window.localStorage.getItem(FALLBACK_CACHE_KEY);
        return cached && /^\d{4}-\d{2}-\d{2}$/.test(cached) ? cached : null;
    } catch {
        return null;
    }
};

const setCachedFallbackDate = (dateString) => {
    try {
        window.localStorage.setItem(FALLBACK_CACHE_KEY, dateString);
    } catch {
        // localStorage unavailable 환경은 조용히 무시
    }
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const extractDateCandidate = (value) => {
    if (typeof value !== 'string') return null;

    if (DATE_ONLY_REGEX.test(value)) {
        return value;
    }

    const dataMatch = value.match(DATE_DATA_JSON_REGEX);
    if (dataMatch) {
        return dataMatch[1];
    }

    const jsonMatch = value.match(DATE_JSON_REGEX);
    if (jsonMatch) {
        return jsonMatch[1];
    }

    return null;
};

const collectUniqueDates = (list) => {
    if (!Array.isArray(list)) return [];

    const dates = [];
    const uniqueDates = new Set();

    list.forEach((item) => {
        const date = extractDateCandidate(item);
        if (!date || uniqueDates.has(date)) return;
        uniqueDates.add(date);
        dates.push(date);
    });

    return dates;
};

function normalizeLegacyDailyWrapData(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    if (data.s08_techRadar && Array.isArray(data.s08_techRadar.keyTickers)) {
        data.s08_techRadar.keyTickers = { items: data.s08_techRadar.keyTickers };
    }

    if (data.s09_tradeSignals) {
        const { s09_tradeSignals } = data;

        if (!s09_tradeSignals.brokerScanner && s09_tradeSignals.brokerAlpha) {
            const brokerAlpha = s09_tradeSignals.brokerAlpha;
            const rawItems = [brokerAlpha.hottest, brokerAlpha.upgrade, brokerAlpha.gem];
            const brokerItems = rawItems
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    title: item.title || '브로커 시그널',
                    icon: item.icon || 'fas fa-chart-line',
                    color: item.color || 'blue',
                    color_to: item.color_to || item.color || 'indigo',
                    details_left: toArray(item.details_left),
                    details_right: toArray(item.details_right),
                }));

            s09_tradeSignals.brokerScanner = {
                title: brokerAlpha.title || '브로커 스캐너',
                items: brokerItems,
            };
        }

        const rank = s09_tradeSignals.signalRank;
        if (rank && typeof rank === 'object') {
            const hasLegacyRankShape = typeof rank.highestConviction === 'string' && !rank.highestConviction?.details;
            if (hasLegacyRankShape) {
                rank.highestConviction = {
                    title: rank.highestConviction || 'Highest Conviction',
                    convictionScore: rank.score || '',
                    details: [
                        { label: '투자 논리', value: rank.thesis || '' },
                        { label: '핵심 근거', value: rank.evidence || '' },
                        { label: '차별화 포인트', value: rank.edge || '' },
                        { label: '리스크', value: rank.risk || '' },
                    ],
                };
            }
        }
    }

    if (data.s10_catalystCalendar && !data.s10_catalysts) {
        const legacy = data.s10_catalystCalendar;
        data.s10_catalysts = {
            title: legacy.title || '내일의 주요 이벤트',
            economicCalendar: {
                title: legacy.economic?.title || '경제 캘린더',
                items: toArray(legacy.economic?.items).map((item) => ({
                    release: item.release || '',
                    time: item.time || item.date || '',
                    consensus: item.consensus || '-',
                    prior: item.prior || '-',
                    interpretation: item.interpretation || '',
                    color: item.color || 'indigo',
                })),
            },
            earningsCalendar: {
                title: legacy.earnings?.title || '실적 캘린더',
                items: toArray(legacy.earnings?.items).map((item) => ({
                    company: item.company || item.ticker || 'N/A',
                    ticker: item.ticker || 'N/A',
                    reportingTime: item.reportingTime || item.time || 'TBD',
                    time_color: item.time_color || 'teal',
                    epsConsensus: item.epsConsensus || '-',
                    revenueConsensus: item.revenueConsensus || '-',
                    impliedMove: item.impliedMove || '-',
                })),
            },
            corporateEvents: {
                title: legacy.events?.title || '기업/정책 이벤트',
                items: toArray(legacy.events?.items).map((item) => ({
                    event: item.event || '',
                    time: item.time || item.date || '',
                    agency: item.agency || '',
                    impact_label: item.impact_label || '영향도',
                    impact_text: item.impact_text || item.impact || '',
                    color: item.color || 'purple',
                })),
            },
        };
    }

    if (data.s11_appendix) {
        const { s11_appendix } = data;
        if (!s11_appendix.futuresMovements && s11_appendix.futures) {
            s11_appendix.futuresMovements = s11_appendix.futures;
        }
        if (!s11_appendix.chartSummaries && s11_appendix.charts) {
            s11_appendix.chartSummaries = s11_appendix.charts;
        }
    }

    return data;
}

async function fetchJsonFromUrl(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store' });

    if (options.allowNotFound && response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw createLoadError(`리포트 파일(${response.status})을 찾을 수 없습니다.`, url, response.status);
    }

    try {
        return await response.json();
    } catch (error) {
        throw createLoadError(`리포트 JSON 파싱 실패: ${error.message}`, url, response.status);
    }
}

async function loadLatestDateCandidates() {
    const reportsIndexUrl = '/100x/data/reports-index.json';
    const reportsList = await fetchJsonFromUrl(reportsIndexUrl, { allowNotFound: true });
    return collectUniqueDates(reportsList);
}

async function tryLoadDateData(basePath, dateString) {
    const url = buildDataUrl(basePath, dateString);
    const data = await fetchJsonFromUrl(url, { allowNotFound: true });
    if (!data) return null;
    return { data, dataUrl: url, date: dateString };
}

async function findLatestExistingData(basePath, candidateDates) {
    if (!Array.isArray(candidateDates) || candidateDates.length === 0) {
        return null;
    }

    const successByIndex = new Map();
    const testedIndexes = new Set();

    let step = 1;
    let index = 0;
    let lastMissIndex = -1;
    let foundIndex = -1;

    while (index < candidateDates.length) {
        testedIndexes.add(index);
        const candidate = await tryLoadDateData(basePath, candidateDates[index]);
        if (candidate) {
            successByIndex.set(index, candidate);
            foundIndex = index;
            break;
        }

        lastMissIndex = index;
        index += step;
        step *= 2;
    }

    const scanStart = Math.max(0, lastMissIndex + 1);
    const scanEnd = foundIndex >= 0 ? foundIndex : candidateDates.length - 1;

    for (let i = scanStart; i <= scanEnd; i += 1) {
        if (successByIndex.has(i)) {
            return successByIndex.get(i);
        }
        if (testedIndexes.has(i)) {
            continue;
        }

        const candidate = await tryLoadDateData(basePath, candidateDates[i]);
        if (candidate) {
            return candidate;
        }
    }

    return null;
}

async function loadReportData(basePath, dateParam) {
    if (dateParam) {
        const explicitUrl = buildDataUrl(basePath, dateParam);
        const explicitData = normalizeLegacyDailyWrapData(await fetchJsonFromUrl(explicitUrl));
        return { data: explicitData, dataUrl: explicitUrl, fallbackFromUrl: null };
    }

    const todayDate = formatDateForFile(new Date());
    const todayUrl = buildDataUrl(basePath, todayDate);
    let fallbackDates = [];

    try {
        fallbackDates = await loadLatestDateCandidates();
    } catch (error) {
        console.warn('[DailyWrap] reports-index 조회 실패. today/cached fallback으로 진행합니다.', error);
    }

    const knownDateSet = fallbackDates.length > 0 ? new Set(fallbackDates) : null;
    const shouldTryToday = !knownDateSet || knownDateSet.has(todayDate);

    if (shouldTryToday) {
        const todayData = await fetchJsonFromUrl(todayUrl, { allowNotFound: true });
        if (todayData) {
            return { data: normalizeLegacyDailyWrapData(todayData), dataUrl: todayUrl, fallbackFromUrl: null };
        }
    }

    const cachedDate = getCachedFallbackDate();
    const shouldTryCached = cachedDate
        && cachedDate !== todayDate
        && (!knownDateSet || knownDateSet.has(cachedDate) || KNOWN_DATA_FALLBACK_DATES.includes(cachedDate));
    if (shouldTryCached) {
        const cachedCandidate = await tryLoadDateData(basePath, cachedDate);
        if (cachedCandidate) {
            return {
                data: normalizeLegacyDailyWrapData(cachedCandidate.data),
                dataUrl: cachedCandidate.dataUrl,
                fallbackFromUrl: todayUrl,
            };
        }
    }

    const filteredDates = KNOWN_DATA_FALLBACK_DATES.filter((date) => date !== todayDate && date !== cachedDate);
    const latestCandidate = await findLatestExistingData(basePath, filteredDates);

    if (latestCandidate) {
        setCachedFallbackDate(latestCandidate.date);
        return {
            data: normalizeLegacyDailyWrapData(latestCandidate.data),
            dataUrl: latestCandidate.dataUrl,
            fallbackFromUrl: todayUrl,
        };
    }

    throw createLoadError('오늘자 및 fallback 리포트를 모두 찾을 수 없습니다.', todayUrl, 404);
}

/**
 * JSON 데이터를 HTML 요소에 채워 넣는 메인 함수
 * @param {object} data - 파싱된 JSON 데이터
 */
function populatePage(data) {
    // --- Meta & Header ---
    document.title = data.reportMeta.title;
    setText('report-title-date', data.reportMeta.date);
    setHtml('todays-thesis-headline', data.header.todaysThesis);

    // --- Key Indicators ---
    const kiContainer = document.getElementById('key-indicators-container');
    if (kiContainer && data.keyIndicators) {
        kiContainer.innerHTML = data.keyIndicators.map(indicator => {
            const valueColor = indicator.movement === 'up' ? 'text-green-600' : 'text-red-600';
            return `
                <div class="bg-white rounded-lg p-4 text-center card-shadow">
                    <h4 class="text-sm font-semibold text-gray-500">${indicator.name}</h4>
                    <p class="text-2xl font-bold ${valueColor}">${indicator.value}</p>
                    <p class="text-sm font-semibold ${valueColor}">${indicator.change}</p>
                </div>
            `;
        }).join('');
    }

    // --- S01: Thesis ---
    if (data.s01_thesis) {
        setHtml('s01-title', `<i class="fas fa-receipt mr-3 text-blue-600"></i>${data.s01_thesis.title}`);
        const s01CardsContainer = document.getElementById('s01-cards-container');
        if (s01CardsContainer) {
            s01CardsContainer.innerHTML = data.s01_thesis.cards.map(card => `
                <div class="bg-${card.color}-50 p-6 rounded-lg border border-${card.color}-200 transition hover:shadow-lg hover:border-${card.color}-300">
                    <div class="flex items-start">
                        <i class="${card.icon} text-2xl text-${card.color}-500 mr-4 mt-1"></i>
                        <div>
                            <h4 class="font-bold text-lg text-gray-800">${card.title}</h4>
                            <p class="text-base text-gray-600 mt-1">${card.content}</p>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }
    
    // --- S02: Market Pulse ---
    if (data.s02_marketPulse) {
        const { s02_marketPulse } = data;
        setHtml('s02-title', `<i class="fas fa-heartbeat mr-3 text-blue-600"></i>${s02_marketPulse.title}`);
        
        const s02ContentContainer = document.getElementById('s02-content-container');
        if (s02ContentContainer) {
            const kcdHtml = `
                <div>
                    <h3 class="text-xl font-bold mb-4">${s02_marketPulse.keyChangeDrivers.title}</h3>
                    <div class="space-y-4">
                        ${s02_marketPulse.keyChangeDrivers.items.map(item => `
                            <div class="bg-gray-50 p-4 rounded-lg flex items-center space-x-4">
                                <i class="${item.icon} fa-lg w-6 text-center"></i>
                                <div>
                                    <p class="font-semibold text-gray-800">${item.title}</p>
                                    <p class="text-sm text-gray-600">${item.content}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            const poHtml = `
                <div class="bg-gray-50 p-6 rounded-lg border flex flex-col">
                    <h3 class="text-xl font-bold mb-4">${s02_marketPulse.primaryOpportunities.title}</h3>
                    <ul class="space-y-3 text-sm">
                        ${s02_marketPulse.primaryOpportunities.items.map(item => `
                            <li class="flex items-start">
                                <i class="${item.icon} w-5 text-center mr-3 mt-1"></i>
                                <div><b>${item.title}:</b> ${item.content}</div>
                            </li>
                        `).join('')}
                    </ul>
                </div>`;
            s02ContentContainer.innerHTML = kcdHtml + poHtml;
        }

        const { liquidityIndicator } = s02_marketPulse;
        const liContainer = document.getElementById('s02-liquidity-indicator-container');
        if (liContainer && liquidityIndicator) {
            liContainer.innerHTML = `
            <div class="bg-white rounded-xl card-shadow p-6 md:p-8 mt-6">
                <h2 class="text-2xl md:text-2xl font-bold mb-6 text-gray-800 flex items-center">
                    <i class="fas fa-water mr-3 text-blue-600"></i>${liquidityIndicator.title}
                </h2>
                <div class="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-r-lg">
                    <div class="flex justify-between items-center mb-2">
                        <p class="font-semibold text-blue-800 text-lg">유동성 점수</p>
                        <span class="font-bold text-2xl text-blue-600">${liquidityIndicator.scoreText}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-3 mb-4">
                        <div class="bg-blue-500 h-3 rounded-full" style="width: ${liquidityIndicator.scoreValue}%"></div>
                    </div>
                    <p class="text-sm text-gray-700 mb-6">${liquidityIndicator.commentary}</p>
                    <div>
                        <h4 class="font-semibold text-gray-700 mb-3 border-b pb-2">상세 기여도</h4>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                            ${liquidityIndicator.contributors.map(c => {
                                const statusColor = c.movement === 'up' ? 'text-green-600' : c.movement === 'down' ? 'text-red-600' : 'text-gray-600';
                                return `
                                <div class="bg-white p-3 rounded-lg shadow-sm">
                                    <p class="text-sm text-gray-900 font-bold mb-2">${c.name}</p>
                                    <p class="font-bold text-sm text-gray-400 mb-1">${c.value}</p>
                                    <p class="font-bold text-lg ${statusColor}">${c.status}</p>
                                </div>`;
                            }).join('')}
                        </div>
                        <p class="text-sm text-center mt-4"><b>Key Driver:</b> ${liquidityIndicator.keyDriver}</p>
                    </div>
                </div>
            </div>`;
        }
    }

    // --- S03: Multi-Asset Dashboard ---
    if (data.s03_multiAsset) {
        const { s03_multiAsset } = data;
        setHtml('s03-title', `<i class="fas fa-tachometer-alt mr-3 text-blue-600"></i>${s03_multiAsset.title}`);

        const gainersLosersContainer = document.getElementById('s03-gainers-losers-container');
        if (gainersLosersContainer) {
            const gainersHtml = `
                <div>
                    <h3 class="text-xl font-bold mb-4 text-green-700 flex items-center"><i class="fas fa-arrow-trend-up mr-2"></i>${s03_multiAsset.gainers.title}</h3>
                    <div class="space-y-4">
                        ${s03_multiAsset.gainers.items.map((item, index) => `
                            <div class="bg-green-50 p-4 rounded-lg flex items-center space-x-4 transition hover:shadow-md">
                                <div class="bg-green-500 text-white rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${index + 1}</div>
                                <div class="flex-1">
                                    <p class="font-bold text-gray-800">${item.ticker} <span class="font-normal text-green-600 ml-2">${item.change}</span></p>
                                    <p class="text-xs text-gray-500">${item.reason}</p>
                                </div>
                            </div>`).join('')}
                    </div>
                </div>`;
            const losersHtml = `
                <div>
                    <h3 class="text-xl font-bold mb-4 text-red-700 flex items-center"><i class="fas fa-arrow-trend-down mr-2"></i>${s03_multiAsset.losers.title}</h3>
                    <div class="space-y-4">
                        ${s03_multiAsset.losers.items.map((item, index) => `
                            <div class="bg-red-50 p-4 rounded-lg flex items-center space-x-4 transition hover:shadow-md">
                                <div class="bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${index + 1}</div>
                                <div class="flex-1">
                                    <p class="font-bold text-gray-800">${item.ticker} <span class="font-normal text-red-600 ml-2">${item.change}</span></p>
                                    <p class="text-xs text-gray-500">${item.reason}</p>
                                </div>
                            </div>`).join('')}
                    </div>
                </div>`;
            gainersLosersContainer.innerHTML = gainersHtml + losersHtml;
        }

        const performanceContainer = document.getElementById('s03-performance-summary-container');
        if (performanceContainer && s03_multiAsset.performanceSummary) {
            const summary = s03_multiAsset.performanceSummary;
            performanceContainer.innerHTML = `
                <h3 class="text-xl font-bold mb-4">${summary.title}</h3>
                <div x-data="{ tab: 'indices' }" class="w-full">
                    <div class="border-b border-gray-200 mb-4 flex space-x-4 text-sm font-semibold">
                        <div class="flex space-x-4 text-sm font-semibold px-1 py-2">
                            ${summary.tabs.map(tab => `<button @click="tab = '${tab.id}'" :class="tab === '${tab.id}' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'" class="pb-1">${tab.name}</button>`).join('')}
                        </div>
                    </div>
                    <div class="pt-5">
                        ${summary.tabs.map(tab => `
                            <div x-show="tab === '${tab.id}'" class="space-y-2" style="display: none;">
                                ${tab.items.map(item => {
                                    const changeColor = item.movement === 'up' ? 'text-green-600' : 'text-red-600';
                                    const ytdColor = item.ytd_movement === 'up' ? 'text-green-600' : 'text-red-600';
                                    return `
                                    <div x-data="{ open: false }" class="border rounded-lg">
                                        <button @click="open = !open" class="w-full flex justify-between items-center p-4">
                                            <div class="flex items-center"><i class="${item.icon} w-6 text-center mr-3"></i><span class="font-semibold text-gray-800">${item.name}</span></div>
                                            <div class="flex items-center"><span class="font-bold text-lg ${changeColor}">${item.change}</span><i class="fas fa-chevron-down ml-4 transition-transform" :class="open && 'rotate-180'"></i></div>
                                        </button>
                                        <div x-show="open" x-transition class="p-4 border-t bg-gray-50 text-sm" style="display: none;">
                                            <p><b>${item.value_label || '종가'}:</b> ${item.value} / <b>YTD:</b> <span class="${ytdColor}">${item.ytd}</span></p>
                                            <p class="mt-1 text-xs text-gray-600">${item.comment}</p>
                                        </div>
                                    </div>`;
                                }).join('')}
                            </div>
                        `).join('')}
                    </div>
                </div>`;
        }
    }

    // --- S04: Correlation & Volatility ---
    if (data.s04_correlation) {
        const { s04_correlation } = data;
        setHtml('s04-title', `<i class="fas fa-wave-square mr-3 text-blue-600"></i>${s04_correlation.title}`);
        const s04Container = document.getElementById('s04-content-container');
        if (s04Container) {
            s04Container.innerHTML = `
                <div class="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-r-lg">
                    <h3 class="text-xl font-bold mb-6 text-blue-800 flex items-center"><i class="fas fa-project-diagram mr-2"></i>${s04_correlation.coreMatrix.title}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        ${s04_correlation.coreMatrix.items.map(item => {
                            const corrColor = item.value > 0 ? 'text-green-600' : 'text-red-600';
                            const corrIcon = item.value > 0 ? 'fa-link' : 'fa-link-slash';
                            return `
                            <div class="bg-white rounded-lg p-4 text-center shadow-md">
                                <p class="text-sm font-semibold text-gray-700">${item.assetPair}</p>
                                <p class="text-3xl font-bold my-2 ${corrColor} flex items-center justify-center"><i class="fas ${corrIcon} mr-2"></i> ${item.value}</p>
                                <p class="text-xs text-gray-500">${item.interpretation}</p>
                            </div>`;
                        }).join('')}
                    </div>
                    <h3 class="text-xl font-bold mb-4 mt-8 text-blue-800"><i class="fas fa-exclamation-triangle mr-2 text-red-500"></i>${s04_correlation.anomalySpotlight.title}</h3>
                    <div class="space-y-4 text-sm">
                        ${s04_correlation.anomalySpotlight.items.map(item => `
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-blue-600 mr-3 mt-1"></i>
                                <div><b>${item.title}:</b> ${item.content}</div>
                            </div>`).join('')}
                    </div>
                </div>`;
        }
    }

    // --- S05: Wall Street Intelligence ---
    if (data.s05_wallStreet) {
        const { s05_wallStreet } = data;
        setHtml('s05-title', `<i class="far fa-lightbulb mr-3 text-blue-600"></i>${s05_wallStreet.title}`);
        const s05Container = document.getElementById('s05-content-container');
        if (s05Container) {
            const ibUpdatesHtml = `
                <div>
                    <h3 class="text-xl font-bold mb-6">${s05_wallStreet.ibUpdates.title}</h3>
                    <div class="relative border-l-2 border-gray-200 pl-8 space-y-8">
                        ${s05_wallStreet.ibUpdates.items.map(item => {
                            const actionColor = item.actionType === 'up' ? 'green' : item.actionType === 'down' ? 'red' : 'blue';
                            const actionIcon = item.actionType === 'up' ? 'fa-arrow-up' : item.actionType === 'down' ? 'fa-arrow-down' : 'fa-plus';
                            const upsideColor = item.upside_positive ? 'text-green-600' : 'text-red-600';
                            return `
                            <div class="relative">
                                <div class="absolute -left-11 top-1 flex items-center justify-center w-6 h-6 bg-${actionColor}-200 rounded-full ring-4 ring-white">
                                    <i class="fas ${actionIcon} text-${actionColor}-600"></i>
                                </div>
                                <div class="bg-gray-50 rounded-lg p-4">
                                    <p class="text-sm text-gray-500">${item.bank}</p>
                                    <p class="font-bold text-lg">${item.ticker} <span class="text-${actionColor}-600 font-semibold ml-2">${item.action}</span></p>
                                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                                        <span>목표가: <b class="text-gray-800">${item.newPT}</b></span>
                                        <span>상승여력: <b class="${upsideColor}">${item.upside}</b></span>
                                    </div>
                                    <p class="text-xs text-gray-600 mt-2"><b>코멘트:</b> ${item.impact}</p>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;

            const analystViewsHtml = `
                <div class="mt-10 pt-6 border-t border-gray-200">
                    <h3 class="text-xl font-bold mb-4 text-gray-800">${s05_wallStreet.analystViews.title}</h3>
                    <div class="space-y-3">
                        ${s05_wallStreet.analystViews.items.map(view => `
                            <div class="bg-${view.color}-50 p-4 rounded-lg border-l-4 border-${view.color}-500">
                                <p class="text-sm font-medium text-gray-800"><span class="font-semibold text-${view.color}-700">•</span> ${view.content}</p>
                            </div>`).join('')}
                    </div>
                </div>`;
            
            const mvs = s05_wallStreet.marketVsStreet;
            const mvsHtml = `
                <div class="mt-10 pt-6 border-t border-gray-200">
                    <div class="bg-blue-50 border-l-4 border-blue-500 p-5 rounded-r-lg">
                        <h3 class="font-bold text-blue-800 mb-4 flex items-center text-lg"><i class="fas fa-balance-scale mr-2"></i>${mvs.title}</h3>
                        <div class="space-y-4">
                            <div class="flex items-center justify-between border-b border-blue-200 pb-3">
                                <span class="font-semibold text-blue-700">100x Reality Score:</span>
                                <span class="font-bold text-lg text-blue-800">${mvs.realityScore} <span class="text-sm ${mvs.realityLabelColor}">${mvs.realityLabel}</span></span>
                            </div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">투자 대응 전략:</span> <span class="text-gray-700">${mvs.action}</span></div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">주요 괴리 요인:</span> <span class="text-gray-700">${mvs.biggestDisconnect}</span></div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">시장 시그널:</span> <span class="text-gray-700">${mvs.marketSays}</span></div>
                        </div>
                    </div>
                </div>`;

            s05Container.innerHTML = ibUpdatesHtml + analystViewsHtml + mvsHtml;
        }
    }
    
    // --- S06: Institutional Money Flows ---
    if (data.s06_flows) {
        const { s06_flows } = data;
        setHtml('s06-title', `<i class="fas fa-water mr-3 text-blue-600"></i>${s06_flows.title}`);
        const s06Container = document.getElementById('s06-content-container');
        if (s06Container) {
            s06Container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border border-purple-200">
                    <h3 class="font-bold text-lg mb-4 flex items-center"><i class="fas fa-chart-pie mr-2 text-purple-600"></i>${s06_flows.optionsTrades.title}</h3>
                    <div class="space-y-4 text-sm">
                        ${s06_flows.optionsTrades.items.map(item => `
                            <div class="bg-white rounded-lg p-3 border-l-4 border-purple-500">
                                <p class="font-semibold text-gray-800">${item.ticker}</p>
                                <p class="text-gray-600 mt-1">${item.content}</p>
                            </div>`).join('')}
                    </div>
                </div>
                <div class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
                    <h3 class="font-bold text-lg mb-4 flex items-center"><i class="fas fa-exchange-alt mr-2 text-green-600"></i>${s06_flows.etfFlows.title}</h3>
                    <div class="space-y-4 text-sm">
                        ${s06_flows.etfFlows.items.map(item => `
                            <div class="bg-white rounded-lg p-3 border-l-4 border-green-500">
                                <p class="font-semibold text-gray-800">${item.name}</p>
                                <p class="text-gray-600 mt-1">${item.content}</p>
                            </div>`).join('')}
                    </div>
                </div>
            </div>
            <div class="bg-gray-50 p-6 rounded-lg lg:col-span-2">
                <h3 class="font-bold text-lg mb-6 flex items-center"><i class="fas fa-user-secret mr-2 text-gray-500"></i>${s06_flows.darkPoolPolitical.title}</h3>
                <div class="mb-6">
                    <h4 class="font-semibold text-gray-700 mb-3 border-b border-gray-300 pb-2">${s06_flows.darkPoolPolitical.darkPool.title}</h4>
                    <div class="space-y-3">
                        ${s06_flows.darkPoolPolitical.darkPool.items.map(item => `
                            <div class="bg-white rounded-lg p-4 border-l-4 border-blue-500"><p class="text-sm text-gray-600">${item.content}</p></div>`).join('')}
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold text-gray-700 mb-3 border-b border-gray-300 pb-2">${s06_flows.darkPoolPolitical.politicalDonation.title}</h4>
                    <div class="bg-white rounded-lg p-4 border-l-4 border-amber-500"><p class="text-sm text-gray-600">${s06_flows.darkPoolPolitical.politicalDonation.content}</p></div>
                </div>
            </div>`;
        }
    }

    // --- S07: Sector Pulse ---
    if (data.s07_sectorPulse) {
        setHtml('s07-title', `<i class="fas fa-sync-alt mr-3 text-blue-600"></i>${data.s07_sectorPulse.title}`);
        renderSectorHeatmap(data.s07_sectorPulse.heatmapData);
        
        const s07RotationContainer = document.getElementById('s07-rotation-container');
        if (s07RotationContainer && data.s07_sectorPulse.rotationViews) {
            const rv = data.s07_sectorPulse.rotationViews;
            const ss = data.s07_sectorPulse.sectorSignal;
             s07RotationContainer.innerHTML = `
                <div>
                    <h3 class="text-xl font-bold mb-4 text-gray-800">${rv.title}</h3>
                    <div class="space-y-3">
                        ${rv.items.map(view => `
                            <div class="bg-${view.color}-50 p-4 rounded-lg border-l-4 border-${view.color}-500">
                                <p class="text-sm font-medium text-gray-800"><span class="font-semibold text-${view.color}-700">•</span> ${view.content}</p>
                            </div>`).join('')}
                    </div>
                </div>
                <div class="mt-8 pt-6 border-t border-gray-200">
                    <div class="bg-blue-50 border-l-4 border-blue-500 p-5 rounded-r-lg">
                        <h3 class="font-bold text-blue-800 mb-4 flex items-center text-lg"><i class="fas fa-arrows-spin mr-2"></i>${ss.title}</h3>
                        <div class="space-y-4">
                            <div class="flex items-center justify-between border-b border-blue-200 pb-3">
                                <span class="font-semibold text-blue-700">Rotation Signal:</span>
                                <span class="font-bold text-lg text-blue-800">${ss.rotationScore} <span class="text-sm ${ss.rotationLabelColor}">${ss.rotationLabel}</span></span>
                            </div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">시그널:</span> <span class="text-gray-700">${ss.signal}</span></div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">강한 섹터:</span> <span class="text-gray-700">${ss.strongestMover}</span></div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">순환 패턴:</span> <span class="text-gray-700">${ss.rotationPattern}</span></div>
                            <div class="text-sm"><span class="font-semibold text-blue-700">거래 전략:</span> <span class="text-gray-700">${ss.tradeSignal}</span></div>
                        </div>
                    </div>
                </div>`;
        }
    }

    // --- S08: Tech Radar ---
    if (data.s08_techRadar) {
        setHtml('s08-title', `<i class="fas fa-robot mr-3 text-blue-600"></i>${data.s08_techRadar.title}`);
        const s08TickersContainer = document.getElementById('s08-tickers-container');
        if (s08TickersContainer && data.s08_techRadar.keyTickers) {
            s08TickersContainer.innerHTML = data.s08_techRadar.keyTickers.items.map(item => {
                const dayColor = item.movement === 'up' ? 'text-green-600' : 'text-red-600';
                const ytdColor = item.ytd_movement === 'up' ? 'text-green-600' : 'text-red-600';
                const borderColor = item.movement === 'up' ? 'border-green-600' : 'border-red-500';
                const bgColor = item.movement === 'up' ? 'bg-green-50' : 'bg-red-50';
                return `
                <div x-data="{ flipped: false }" @click="flipped = !flipped" class="cursor-pointer h-48 group">
                    <div class="relative w-full h-full transition-transform duration-500 transform-style-3d" :class="{ 'rotate-y-180': flipped }">
                        <div class="absolute w-full h-full backface-hidden ${bgColor} rounded-lg shadow p-4 flex flex-col justify-between border-l-4 ${borderColor}">
                            <div><p class="font-bold text-lg">${item.ticker}</p><p class="text-xs text-gray-500">${item.companyName}</p></div>
                            <div class="text-right"><p class="text-lg font-bold ${dayColor}">${item.day_change}%</p><p class="text-xs ${ytdColor}">YTD ${item.ytd_change}%</p></div>
                        </div>
                        <div class="absolute w-full h-full backface-hidden bg-gray-800 text-white rounded-lg shadow p-4 text-xs flex items-center justify-center rotate-y-180">
                            <p>${item.comment}</p>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
        
        const s08EcosystemContainer = document.getElementById('s08-ecosystem-container');
        if (s08EcosystemContainer && data.s08_techRadar.aiEcosystem) {
            const { aiEcosystem, aiInvestmentLens, aiEdge } = data.s08_techRadar;
            s08EcosystemContainer.innerHTML = `
                <div>
                    <h3 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><i class="${aiEcosystem.icon} mr-2 text-purple-600"></i>${aiEcosystem.title}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${aiEcosystem.items.map(item => `
                        <div class="bg-gradient-to-br from-${item.color}-50 to-${item.color}-100 p-4 rounded-lg border-l-4 border-${item.color}-500">
                            <h4 class="font-semibold text-${item.color}-700 mb-2 flex items-center"><i class="${item.icon} mr-2"></i>${item.title}</h4>
                            <p class="text-sm text-gray-700">${item.content}</p>
                        </div>`).join('')}
                    </div>
                </div>
                <div class="mt-8 pt-6 border-t border-gray-200">
                    <h3 class="text-xl font-bold mb-4 text-gray-800 flex items-center"><i class="${aiInvestmentLens.icon} mr-2 text-indigo-600"></i>${aiInvestmentLens.title}</h3>
                    <div class="space-y-4">
                        ${aiInvestmentLens.items.map(item => `
                        <div class="bg-${item.color}-50 p-4 rounded-lg border-l-4 border-${item.color}-500">
                            <h4 class="font-semibold text-${item.color}-700 mb-2 flex items-center"><i class="${item.icon} mr-2"></i>${item.title}</h4>
                            <p class="text-sm text-gray-700">${item.content}</p>
                        </div>`).join('')}
                    </div>
                </div>
                <div class="mt-8 pt-6 border-t border-gray-200">
                    <div class="bg-blue-50 border-l-4 border-blue-500 p-5 rounded-r-lg">
                        <h3 class="font-bold text-blue-800 mb-4 flex items-center text-lg"><i class="${aiEdge.icon} mr-2"></i>${aiEdge.title}</h3>
                        <div class="space-y-4">
                            ${aiEdge.items.map(item => `
                            <div>
                                <h4 class="font-semibold text-blue-700 mb-2">${item.title}:</h4>
                                <p class="text-sm text-gray-700">${item.content}</p>
                            </div>`).join('')}
                        </div>
                    </div>
                </div>`;
        }
    }

    // --- S09: Trade Signals ---
    if (data.s09_tradeSignals) {
        const { s09_tradeSignals } = data;
        setHtml('s09-title', `<i class="fas fa-bullseye mr-3 text-blue-600"></i>${s09_tradeSignals.title}`);
        const s09Container = document.getElementById('s09-content-container');
        if (s09Container) {
            const liveSignalsHtml = `
            <div class="mb-10">
                <h3 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><i class="fas fa-satellite-dish mr-2 text-green-600"></i>${s09_tradeSignals.liveSignals.title}</h3>
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    ${s09_tradeSignals.liveSignals.items.map(signal => {
                        const color = signal.type === 'LONG' ? 'green' : 'red';
                        const icon = signal.type === 'LONG' ? 'fa-arrow-up' : 'fa-arrow-down';
                        return `
                        <div class="bg-gradient-to-br from-${color}-50 to-${color}-100 rounded-xl p-6 border-2 border-${color}-300 shadow-lg">
                            <div class="text-center mb-4">
                                <h4 class="font-bold text-${color}-800 text-lg mb-2">${signal.name}</h4>
                                <div class="bg-${color}-600 text-white rounded-full px-4 py-2 inline-block"><i class="fas ${icon} mr-2"></i>${signal.type}</div>
                            </div>
                            <div class="space-y-3 text-sm">
                                <div class="bg-white rounded-lg p-3 border border-${color}-200">
                                    <div class="grid grid-cols-2 gap-3">
                                        <div><span class="font-semibold text-gray-700">진입:</span> <span class="text-${color}-700 font-bold">${signal.entry}</span></div>
                                        <div><span class="font-semibold text-gray-700">목표:</span> <span class="text-${color}-700 font-bold">${signal.target}</span></div>
                                        <div><span class="font-semibold text-gray-700">손절:</span> <span class="text-red-600 font-bold">${signal.stopLoss}</span></div>
                                        <div><span class="font-semibold text-gray-700">포지션:</span> <span class="text-gray-800 font-bold">${signal.positionSize}</span></div>
                                    </div>
                                </div>
                                <div class="flex justify-between items-center bg-white rounded-lg p-3 border border-${color}-200">
                                    <span class="font-semibold text-gray-700">Risk/Reward:</span><span class="text-${color}-700 font-bold">${signal.riskReward}</span>
                                </div>
                                <div class="flex justify-between items-center bg-white rounded-lg p-3 border border-${color}-200">
                                    <span class="font-semibold text-gray-700">승률:</span><span class="text-blue-600 font-bold">${signal.winRate}%</span>
                                </div>
                                <div class="bg-white rounded-lg p-3 border border-${color}-200">
                                    <p class="font-semibold text-gray-700 mb-1">촉매:</p><p class="text-gray-600">${signal.catalyst}</p>
                                </div>
                                <div class="text-xs text-gray-500 text-center pt-2 border-t border-${color}-200">생성시간: ${signal.generatedTime}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;

            const brokerScannerHtml = `
            <div class="mt-10 pt-8 border-t border-gray-200">
                <h3 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><i class="fas fa-radar-dish mr-2 text-purple-600"></i>${s09_tradeSignals.brokerScanner.title}</h3>
                <div class="space-y-4">
                    ${s09_tradeSignals.brokerScanner.items.map(item => `
                        <div class="bg-gradient-to-r from-${item.color}-50 to-${item.color_to}-50 rounded-lg p-6 border-l-4 border-${item.color}-500">
                            <h4 class="font-bold text-${item.color}-700 mb-3 flex items-center"><i class="${item.icon} mr-2"></i>${item.title}</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>${item.details_left.map(d => `<p><span class="font-semibold text-gray-700">${d.label}:</span> <span class="text-gray-800">${d.value}</span></p>`).join('')}</div>
                                <div>${item.details_right.map(d => `<p><span class="font-semibold text-gray-700">${d.label}:</span> <span class="text-gray-800">${d.value}</span></p>`).join('')}</div>
                            </div>
                        </div>`).join('')}
                </div>
            </div>`;

            const rank = s09_tradeSignals.signalRank;
            const signalRankHtml = `
            <div class="mt-10 pt-8 border-t border-gray-200">
                <div class="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-r-lg">
                    <h3 class="font-bold text-blue-800 mb-6 flex items-center text-lg"><i class="fas fa-trophy mr-2"></i>${rank.title}</h3>
                    <div class="bg-white rounded-lg p-6 shadow-sm mb-6">
                        <h4 class="font-bold text-blue-700 mb-4 flex items-center"><i class="fas fa-crown mr-2 text-yellow-500"></i>${rank.highestConviction.title}</h4>
                        <div class="space-y-4">
                            <div class="flex items-center justify-between border-b border-gray-200 pb-3">
                                <span class="font-semibold text-blue-700">100x Conviction:</span>
                                <span class="font-bold text-lg text-blue-800">${rank.highestConviction.convictionScore}</span>
                            </div>
                            ${rank.highestConviction.details.map(d => `
                                <div class="text-sm">
                                    <span class="font-semibold text-blue-700">${d.label}:</span>
                                    <p class="text-gray-700 mt-1">${d.value}</p>
                                </div>`).join('')}
                        </div>
                    </div>
                    <div class="text-center pt-4 border-t border-blue-200">
                        <div class="text-xs text-blue-400 flex items-center justify-center">
                            <div class="w-2 h-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mr-2"></div>
                            Powered by 100x Intelligence Engine
                        </div>
                    </div>
                </div>
            </div>`;
            s09Container.innerHTML = liveSignalsHtml + brokerScannerHtml + signalRankHtml;
        }
    }
    
    // --- S10: Catalysts ---
    if (data.s10_catalysts) {
        const { s10_catalysts } = data;
        setHtml('s10-title', `<i class="fas fa-calendar-check mr-3 text-blue-600"></i>${s10_catalysts.title}`);
        const s10Container = document.getElementById('s10-content-container');
        if (s10Container) {
            const ecoCalHtml = `
            <div class="mb-10">
                <h3 class="text-xl font-bold mb-6 flex items-center"><i class="fas fa-landmark mr-2 text-indigo-500"></i>${s10_catalysts.economicCalendar.title}</h3>
                <div class="space-y-4">
                    ${s10_catalysts.economicCalendar.items.map(item => `
                    <div class="border-l-4 border-${item.color}-500 rounded-lg p-4 transition-all hover:shadow-lg bg-${item.color}-50">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                            <div class="mb-3 sm:mb-0">
                                <p class="font-bold text-gray-900">${item.release}</p>
                                <p class="text-sm text-gray-500">발표: ${item.time}</p>
                            </div>
                            <div class="flex space-x-4 text-right">
                                <div><p class="text-xs text-gray-500">컨센서스</p><p class="font-semibold text-base">${item.consensus}</p></div>
                                <div><p class="text-xs text-gray-500">이전치</p><p class="font-semibold text-base">${item.prior}</p></div>
                            </div>
                        </div>
                        ${item.interpretation ? `<p class="text-xs text-gray-600 mt-3 pt-3 border-t"><b class="text-gray-700">해설:</b> ${item.interpretation}</p>` : ''}
                    </div>`).join('')}
                </div>
            </div>`;
            
            const earnCalHtml = `
            <div class="mb-10">
                <h3 class="text-xl font-bold mb-6 flex items-center"><i class="fas fa-chart-line mr-2 text-teal-500"></i>${s10_catalysts.earningsCalendar.title}</h3>
                <div class="space-y-4">
                    ${s10_catalysts.earningsCalendar.items.map(item => `
                    <div class="border rounded-lg p-4 transition-all hover:shadow-lg hover:border-teal-200">
                        <div class="flex justify-between items-center mb-2">
                            <p class="font-bold text-gray-900">${item.company} <span class="text-sm font-light text-gray-500">(${item.ticker})</span></p>
                            <span class="inline-block bg-${item.time_color}-200 text-${item.time_color}-800 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full">${item.reportingTime}</span>
                        </div>
                        <div class="flex justify-around text-center pt-2 border-t">
                            <div><p class="text-xs text-gray-500">EPS 컨센서스</p><p class="font-semibold text-lg">${item.epsConsensus}</p></div>
                            <div><p class="text-xs text-gray-500">매출 컨센서스</p><p class="font-semibold text-lg">${item.revenueConsensus || '<span class="na-value">-</span>'}</p></div>
                            <div><p class="text-xs text-gray-500">예상 변동률</p><p class="font-semibold text-lg">${item.impliedMove}</p></div>
                        </div>
                    </div>`).join('')}
                </div>
            </div>`;

            const corpEventsHtml = `
            <div>
                <h3 class="text-xl font-bold mb-6 flex items-center"><i class="fas fa-bullhorn mr-2 text-purple-500"></i>${s10_catalysts.corporateEvents.title}</h3>
                <div class="space-y-4">
                    ${s10_catalysts.corporateEvents.items.map(item => `
                    <div class="border-l-4 border-${item.color}-500 rounded-lg p-4 transition-all hover:shadow-lg bg-${item.color}-50">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                            <div class="mb-3 sm:mb-0">
                                <p class="font-bold text-gray-900">${item.event}</p>
                                <p class="text-sm text-gray-500">${item.time} • <span class="font-medium">${item.agency}</span></p>
                            </div>
                            <div class="text-right"><span class="inline-block bg-${item.color}-100 text-${item.color}-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">${item.impact_label}</span></div>
                        </div>
                        <p class="text-xs text-gray-600 mt-3 pt-3 border-t"><b class="text-gray-700">예상 영향:</b> ${item.impact_text}</p>
                    </div>`).join('')}
                </div>
            </div>`;
            s10Container.innerHTML = ecoCalHtml + earnCalHtml + corpEventsHtml;
        }
    }

    // --- S11: Appendix ---
    if (data.s11_appendix) {
        const { s11_appendix } = data;
        setHtml('s11-title', `<i class="fas fa-book-open mr-3 text-blue-600"></i>${s11_appendix.title}`);
        const s11Container = document.getElementById('s11-content-container');
        if (s11Container) {
            const futuresHtml = `
            <div class="mb-10">
                <h3 class="text-xl font-bold mb-6">${s11_appendix.futuresMovements.title}</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    ${s11_appendix.futuresMovements.items.map(item => {
                        const color = item.movement === 'up' ? 'green' : 'red';
                        return `
                        <div class="bg-white rounded-lg shadow p-4 border-l-4 border-${color}-500 flex flex-col" x-data="{ open: false }">
                            <div class="flex-grow">
                                <div class="flex justify-between items-start">
                                    <span class="font-bold text-gray-800">${item.instrument}</span>
                                    <span class="text-lg font-bold text-${color}-600">${item.change}</span>
                                </div>
                                <div class="text-sm text-gray-600 mt-1">최종가: ${item.last}</div>
                            </div>
                            <button @click="open = !open" class="text-sm text-blue-600 mt-3 pt-2 border-t border-gray-200 w-full text-left flex justify-between items-center">
                                <span>코멘트 보기</span><i class="fas" :class="open ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                            </button>
                            <div x-show="open" x-transition style="display: none;" class="text-xs text-gray-500 mt-2">${item.comment}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
            
            const chartsHtml = `
            <div>
                <h3 class="text-xl font-bold mb-6">${s11_appendix.chartSummaries.title}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    ${s11_appendix.chartSummaries.items.map(item => `
                        <div class="bg-white p-6 rounded-xl shadow border-t-4 border-${item.color}-500">
                            <div class="flex items-center mb-3">
                                <i class="${item.icon} text-xl text-${item.color}-500 mr-3"></i>
                                <h4 class="font-bold text-gray-800">${item.title}</h4>
                            </div>
                            <p class="text-sm text-gray-600 leading-relaxed">${item.content}</p>
                        </div>`).join('')}
                </div>
            </div>`;
            s11Container.innerHTML = futuresHtml + chartsHtml;
        }
    }
}

/**
 * 섹터 히트맵을 렌더링하는 함수
 * @param {Array} heatmapData - 섹터 데이터 배열
 */
function renderSectorHeatmap(heatmapData) {
    const heatmapContainer = document.getElementById('sector-heatmap');
    if (!heatmapContainer || !heatmapData) return;

    heatmapContainer.innerHTML = ''; // 기존 내용 초기화
    
    // YTD 기준으로 내림차순 정렬
    heatmapData.sort((a, b) => b.day - a.day);
    
    heatmapData.forEach(sector => {
        let bgColorClass = '';
        if (sector.day > 0.75) bgColorClass = 'bg-green-600';
        else if (sector.day > 0.25) bgColorClass = 'bg-green-500';
        else if (sector.day >= 0) bgColorClass = 'bg-green-400';
        else if (sector.day > -0.5) bgColorClass = 'bg-red-400';
        else bgColorClass = 'bg-red-600';

        const ytdColorClass = sector.ytd >= 0 ? 'text-green-300' : 'text-red-300';
        
        const cell = `
            <div class="p-4 rounded-lg ${bgColorClass} card-shadow text-white transition-shadow hover:shadow-lg">
                <div class="font-bold text-base md:text-lg">${sector.name} (${sector.etf})</div>
                <div class="text-2xl font-black">${sector.day.toFixed(2)}%</div>
                <div class="text-sm ${ytdColorClass}">(YTD ${sector.ytd.toFixed(2)}%)</div>
            </div>
        `;
        heatmapContainer.innerHTML += cell;
    });
}
