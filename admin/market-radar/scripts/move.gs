/**
 * MOVE Index Data Collector
 * Source: Yahoo Finance via Cloudflare Proxy
 * Schedule: Daily 07:29
 * Field: value (NOT close!)
 * Last Updated: 2025-01-01
 */

const MOVE_CONFIG = {
  REPO_OWNER: 'etloveaui',
  REPO_NAME: '100xFenok',
  BRANCH: 'main',
  FILE_PATH: 'data/sentiment/move.json',
  YAHOO_PROXY: 'https://fed-proxy.etloveaui.workers.dev/yahoo/%5EMOVE?range=5d&interval=1d'
};

function getGitHubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function updateMOVE() {
  // 1. Yahoo에서 최근 데이터 가져오기
  try {
    const response = UrlFetchApp.fetch(MOVE_CONFIG.YAHOO_PROXY, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('MOVE: Yahoo API 실패 - ' + response.getResponseCode());
      return;
    }

    const json = JSON.parse(response.getContentText());
    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const newData = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (closes[i] !== null) {
        const date = new Date(timestamps[i] * 1000);
        const dateStr = Utilities.formatDate(date, 'GMT', 'yyyy-MM-dd');
        newData.push({
          date: dateStr,
          value: Math.round(closes[i] * 100) / 100  // value 사용!
        });
      }
    }

    if (newData.length === 0) {
      Logger.log('MOVE: 새 데이터 없음');
      return;
    }

    // 2. 기존 데이터 가져오기 (GitHub)
    const existingData = getExistingData(MOVE_CONFIG.FILE_PATH);

    // 3. 병합 (기존 + 신규, 중복 제거)
    const mergedData = mergeData(existingData, newData);

    // 4. GitHub에 푸시
    pushToGitHub(MOVE_CONFIG.FILE_PATH, mergedData, 'Update MOVE data');

    Logger.log('MOVE: 기존 ' + existingData.length + '개 + 신규 ' + newData.length + '개 → 총 ' + mergedData.length + '개');

  } catch (e) {
    Logger.log('MOVE 업데이트 실패: ' + e);
  }
}

function getExistingData(filePath) {
  const token = getGitHubToken();
  const url = 'https://api.github.com/repos/' + MOVE_CONFIG.REPO_OWNER + '/' + MOVE_CONFIG.REPO_NAME + '/contents/' + filePath;

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

  // 기존 데이터 먼저
  existingData.forEach(function(item) {
    dataMap.set(item.date, item.value);
  });

  // 신규 데이터 (덮어쓰기)
  newData.forEach(function(item) {
    dataMap.set(item.date, item.value);
  });

  // Map → Array, 날짜순 정렬
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
  const url = 'https://api.github.com/repos/' + MOVE_CONFIG.REPO_OWNER + '/' + MOVE_CONFIG.REPO_NAME + '/contents/' + filePath;

  // 기존 파일 SHA 가져오기
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
    Logger.log('SHA 가져오기 실패 (새 파일일 수 있음)');
  }

  // 파일 업데이트
  const content = Utilities.base64Encode(JSON.stringify(data, null, 2));
  const payload = {
    message: message,
    content: content,
    branch: MOVE_CONFIG.BRANCH
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
    Logger.log('GitHub 푸시 성공: ' + filePath);
  } else {
    Logger.log('GitHub 푸시 실패: ' + putResponse.getContentText());
  }
}
