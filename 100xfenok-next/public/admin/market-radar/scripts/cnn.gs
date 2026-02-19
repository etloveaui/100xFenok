/**
 * CNN Fear & Greed Index 수집기
 *
 * 데이터 소스: Cloudflare Proxy → CNN API
 * 대상:
 *   - data/sentiment/cnn-fear-greed.json (종합 점수)
 *   - data/sentiment/cnn-components.json (7개 구성요소)
 * 트리거: 매일 07:20 KST
 *
 * 패턴: merge (기존 데이터 보호 + 신규 추가/업데이트)
 *
 * 구성요소 (7개):
 *   - market_momentum: S&P 500 모멘텀
 *   - stock_strength: 주가 강도
 *   - stock_breadth: 주가 폭
 *   - put_call: 풋/콜 비율
 *   - volatility: VIX 변동성
 *   - safe_haven: 안전자산 수요
 *   - junk_bond: 정크본드 수요
 */

/**
 * 메인 업데이트 함수
 * - Cloudflare Proxy에서 CNN 데이터 가져오기
 * - 종합 점수 + 7개 구성요소 분리 저장
 */
function updateCNN() {
  const proxyUrl = 'https://fed-proxy.etloveaui.workers.dev/cnn';

  try {
    const response = UrlFetchApp.fetch(proxyUrl, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('❌ CNN 프록시 실패: ' + response.getResponseCode());
      return;
    }

    const data = JSON.parse(response.getContentText());
    const fg = data.fear_and_greed;
    const components = {
      market_momentum: data.market_momentum_sp500,
      stock_strength: data.stock_price_strength,
      stock_breadth: data.stock_price_breadth,
      put_call: data.put_call_options,
      volatility: data.market_volatility_vix,
      safe_haven: data.safe_haven_demand,
      junk_bond: data.junk_bond_demand
    };

    const today = new Date().toISOString().split('T')[0];

    // 1. cnn-fear-greed.json 업데이트 (종합 점수)
    updateFearGreedScore(today, fg.score);

    // 2. cnn-components.json 업데이트 (7개 구성요소)
    updateComponents(today, components);

    Logger.log('✅ CNN 업데이트: ' + today + ', score=' + fg.score);

  } catch (e) {
    Logger.log('❌ CNN 오류: ' + e.message);
  }
}

/**
 * 종합 점수 업데이트
 * 패턴: merge (오늘 날짜 있으면 업데이트, 없으면 추가)
 */
function updateFearGreedScore(date, score) {
  const owner = 'etloveaui';
  const repo = '100xFenok';
  const path = 'data/sentiment/cnn-fear-greed.json';
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');

  const url = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;

  // 기존 파일 가져오기
  const getRes = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'token ' + token },
    muteHttpExceptions: true
  });

  const fileData = JSON.parse(getRes.getContentText());
  const existing = JSON.parse(Utilities.newBlob(Utilities.base64Decode(fileData.content)).getDataAsString());

  // 오늘 날짜 있으면 업데이트, 없으면 추가 (누적식)
  const idx = existing.findIndex(d => d.date === date);
  if (idx >= 0) {
    existing[idx].score = Math.round(score * 10) / 10;
  } else {
    existing.push({ date: date, score: Math.round(score * 10) / 10 });
    existing.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Push
  const content = Utilities.base64Encode(JSON.stringify(existing, null, 2));
  UrlFetchApp.fetch(url, {
    method: 'put',
    headers: {
      'Authorization': 'token ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      message: '📊 CNN F&G: ' + date + ' = ' + Math.round(score),
      content: content,
      sha: fileData.sha
    })
  });
}

/**
 * 7개 구성요소 업데이트
 * 패턴: merge (오늘 날짜 있으면 업데이트, 없으면 추가)
 */
function updateComponents(date, components) {
  const owner = 'etloveaui';
  const repo = '100xFenok';
  const path = 'data/sentiment/cnn-components.json';
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');

  const url = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;

  const getRes = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'token ' + token },
    muteHttpExceptions: true
  });

  const fileData = JSON.parse(getRes.getContentText());
  const existing = JSON.parse(Utilities.newBlob(Utilities.base64Decode(fileData.content)).getDataAsString());

  const newEntry = {
    date: date,
    market_momentum: Math.round(components.market_momentum.score * 10) / 10,
    stock_strength: Math.round(components.stock_strength.score * 10) / 10,
    stock_breadth: Math.round(components.stock_breadth.score * 10) / 10,
    put_call: Math.round(components.put_call.score * 10) / 10,
    volatility: Math.round(components.volatility.score * 10) / 10,
    safe_haven: Math.round(components.safe_haven.score * 10) / 10,
    junk_bond: Math.round(components.junk_bond.score * 10) / 10
  };

  // 오늘 날짜 있으면 업데이트, 없으면 추가 (누적식)
  const idx = existing.findIndex(d => d.date === date);
  if (idx >= 0) {
    existing[idx] = newEntry;
  } else {
    existing.push(newEntry);
    existing.sort((a, b) => a.date.localeCompare(b.date));
  }

  const content = Utilities.base64Encode(JSON.stringify(existing, null, 2));
  UrlFetchApp.fetch(url, {
    method: 'put',
    headers: {
      'Authorization': 'token ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      message: '📊 CNN Components: ' + date,
      content: content,
      sha: fileData.sha
    })
  });
}

/**
 * 트리거 생성 (최초 1회)
 * 매일 07:20 KST (미국장 마감 후)
 */
function createCNNTrigger() {
  ScriptApp.newTrigger('updateCNN')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
}
