/**
 * VIX Data Collector — DEPRECATED LOCAL BACKUP
 *
 * Runtime replacement:
 *   - scripts/fetch-sentiment.mjs
 *   - .github/workflows/fetch-sentiment.yml
 *
 * This file is kept only as the historical Apps Script backup for the old
 * Market Radar project. Do not create a new trigger from this file. The
 * scheduled Data Spine sentiment collector now owns data/sentiment/vix.json and
 * its Next.js public mirror.
 *
 * Old source: Yahoo Finance (^VIX)
 * Old schedule: Daily 07:00~08:00 KST
 * Field: value (Close price)
 * Sunset documented: 2026-06-22 (DS-P1-005)
 */

const VIX_LEGACY_BACKUP_ONLY = true;

const VIX_CONFIG = {
  REPO_OWNER: 'etloveaui',
  REPO_NAME: '100xFenok',
  BRANCH: 'main',
  FILE_PATH: 'data/sentiment/vix.json',
  YAHOO_SYMBOL: '^VIX'
};

function getGitHubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function updateVIX() {
  if (VIX_LEGACY_BACKUP_ONLY) {
    Logger.log('⚠️ VIX legacy GAS backup only. Use scripts/fetch-sentiment.mjs / fetch-sentiment.yml.');
    return;
  }

  // 1. Yahoo Finance에서 최근 데이터 가져오기 (15일)
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (15 * 24 * 60 * 60);

  const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(VIX_CONFIG.YAHOO_SYMBOL) +
    '?period1=' + startDate +
    '&period2=' + endDate +
    '&interval=1d';

  const response = UrlFetchApp.fetch(yahooUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('❌ VIX: Yahoo API 오류 - ' + response.getResponseCode());
    return;
  }

  const json = JSON.parse(response.getContentText());
  const result = json.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  if (!timestamps || timestamps.length === 0) {
    Logger.log('❌ VIX: 새 데이터 없음');
    return;
  }

  // timestamp → YYYY-MM-DD 변환 + Close 값 매핑
  const newData = [];
  for (var i = 0; i < timestamps.length; i++) {
    if (closes[i] !== null) {
      var d = new Date(timestamps[i] * 1000);
      var dateStr = Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
      newData.push({
        date: dateStr,
        value: Math.round(closes[i] * 100) / 100
      });
    }
  }

  Logger.log('📊 Yahoo에서 가져온 데이터: ' + newData.length + '개');

  // 2. 기존 데이터 가져오기 (GitHub)
  const existingData = getExistingData(VIX_CONFIG.FILE_PATH);

  // 3. 병합 (기존 + 신규, 중복 제거)
  const mergedData = mergeData(existingData, newData);

  // 4. GitHub에 푸시
  pushToGitHub(VIX_CONFIG.FILE_PATH, mergedData, 'Update VIX data (Yahoo)');

  Logger.log('✅ VIX: 기존 ' + existingData.length + '개 → 총 ' + mergedData.length + '개');
}

function getExistingData(filePath) {
  const token = getGitHubToken();
  const url = 'https://api.github.com/repos/' + VIX_CONFIG.REPO_OWNER + '/' + VIX_CONFIG.REPO_NAME + '/contents/' + filePath;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json'
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const content = JSON.parse(response.getContentText()).content;
      const decoded = Utilities.newBlob(Utilities.base64Decode(content)).getDataAsString();
      return JSON.parse(decoded);
    }
  } catch (e) {
    Logger.log('기존 데이터 fetch 실패: ' + e);
  }
  return [];
}

function mergeData(existingData, newData) {
  const dataMap = new Map();

  existingData.forEach(function(item) {
    dataMap.set(item.date, item.value);
  });

  newData.forEach(function(item) {
    dataMap.set(item.date, item.value);
  });

  var result = [];
  dataMap.forEach(function(value, date) {
    result.push({ date: date, value: value });
  });
  result.sort(function(a, b) {
    return a.date.localeCompare(b.date);
  });

  return result;
}

function pushToGitHub(filePath, data, message) {
  const token = getGitHubToken();
  const url = 'https://api.github.com/repos/' + VIX_CONFIG.REPO_OWNER + '/' + VIX_CONFIG.REPO_NAME + '/contents/' + filePath;

  var sha = '';
  try {
    const getResponse = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json'
      },
      muteHttpExceptions: true
    });
    if (getResponse.getResponseCode() === 200) {
      sha = JSON.parse(getResponse.getContentText()).sha;
    }
  } catch (e) {
    Logger.log('SHA 가져오기 실패');
  }

  const content = Utilities.base64Encode(JSON.stringify(data, null, 2));
  const payload = {
    message: message,
    content: content,
    branch: VIX_CONFIG.BRANCH
  };
  if (sha) payload.sha = sha;

  const putResponse = UrlFetchApp.fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload)
  });

  if (putResponse.getResponseCode() === 200 || putResponse.getResponseCode() === 201) {
    Logger.log('✅ GitHub 푸시 성공: ' + filePath);
  } else {
    Logger.log('❌ GitHub 푸시 실패: ' + putResponse.getContentText());
  }
}

// ============================================================
// 트리거 관리
// ============================================================

/**
 * VIX 트리거 생성
 * - 매일 07:00~08:00 KST (미국 장 마감 후)
 */
function createVIXTrigger() {
  if (VIX_LEGACY_BACKUP_ONLY) {
    Logger.log('⚠️ VIX trigger not created. This GAS backup is deprecated; use fetch-sentiment.yml.');
    return;
  }

  // 기존 VIX 트리거 삭제
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateVIX')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 매일 07:00~08:00 사이 실행
  ScriptApp.newTrigger('updateVIX')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log('✅ VIX 트리거 생성: 매일 07:00~08:00 KST');
}
