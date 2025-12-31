/**
 * VIX Data Collector
 * Source: FRED API (VIXCLS)
 * Schedule: Daily 07:48
 * Field: value (not close!)
 * Last Updated: 2025-01-01
 */

const VIX_CONFIG = {
  REPO_OWNER: 'etloveaui',
  REPO_NAME: '100xFenok',
  BRANCH: 'main',
  FILE_PATH: 'data/sentiment/vix.json',
  FRED_API_KEY: '6dda7dc3956a2c1d6ac939133de115f1',
  FRED_SERIES: 'VIXCLS'
};

function getGitHubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function updateVIX() {
  // 1. FRED에서 최근 데이터 가져오기
  const apiUrl = 'https://api.stlouisfed.org/fred/series/observations?' +
    'series_id=' + VIX_CONFIG.FRED_SERIES +
    '&api_key=' + VIX_CONFIG.FRED_API_KEY +
    '&file_type=json&limit=10&sort_order=desc';

  const response = UrlFetchApp.fetch(apiUrl);
  const json = JSON.parse(response.getContentText());

  const newData = json.observations
    .filter(function(obs) { return obs.value !== '.'; })
    .map(function(obs) {
      return {
        date: obs.date,
        value: parseFloat(obs.value)
      };
    });

  if (newData.length === 0) {
    Logger.log('VIX: 새 데이터 없음');
    return;
  }

  // 2. 기존 데이터 가져오기 (GitHub)
  const existingData = getExistingData(VIX_CONFIG.FILE_PATH);

  // 3. 병합 (기존 + 신규, 중복 제거)
  const mergedData = mergeData(existingData, newData);

  // 4. GitHub에 푸시
  pushToGitHub(VIX_CONFIG.FILE_PATH, mergedData, 'Update VIX data');

  Logger.log('VIX: 기존 ' + existingData.length + '개 + 신규 ' + newData.length + '개 → 총 ' + mergedData.length + '개');
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
  const url = 'https://api.github.com/repos/' + VIX_CONFIG.REPO_OWNER + '/' + VIX_CONFIG.REPO_NAME + '/contents/' + filePath;

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
    Logger.log('GitHub 푸시 성공: ' + filePath);
  } else {
    Logger.log('GitHub 푸시 실패: ' + putResponse.getContentText());
  }
}
