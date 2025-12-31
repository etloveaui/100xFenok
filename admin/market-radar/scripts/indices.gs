/**
 * 100xFenok Market Indices - S&P 500 & NASDAQ 수집
 * 프로젝트: 100xFenok-Indices
 * 스프레드시트: 100xFenok_Market_Indices
 * 방식: 기존 데이터 유지 + 신규 날짜만 병합
 * Last Updated: 2025-01-01
 */

const CONFIG = {
  REPO_OWNER: 'etloveaui',
  REPO_NAME: '100xFenok',
  BRANCH: 'main',
  SP500_PATH: 'data/indices/sp500.json',
  NASDAQ_PATH: 'data/indices/nasdaq.json'
};

function getGitHubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

/**
 * 메인: S&P 500 + NASDAQ 둘 다 업데이트
 */
function updateAllIndices() {
  updateSP500();
  updateNASDAQ();
  Logger.log('모든 인덱스 업데이트 완료');
}

/**
 * GitHub에서 기존 데이터 가져오기
 */
function getExistingData(filePath) {
  const token = getGitHubToken();
  const url = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/contents/' + filePath;

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
    Logger.log('기존 데이터 없음: ' + e);
  }
  return [];
}

/**
 * 데이터 병합 (기존 + 신규, 날짜 기준 중복 제거)
 */
function mergeData(existingData, newData) {
  const dataMap = new Map();

  // 기존 데이터 먼저 추가
  existingData.forEach(function (item) {
    dataMap.set(item.date, item.value);
  });

  // 새 데이터로 덮어쓰기 (최신값 우선)
  newData.forEach(function (item) {
    dataMap.set(item.date, item.value);
  });

  // Map -> Array, 날짜순 정렬
  var result = [];
  dataMap.forEach(function (value, date) {
    result.push({ date: date, value: value });
  });
  result.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });

  return result;
}

/**
 * S&P 500 업데이트 (병합 방식)
 */
function updateSP500() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SP500');
  const newData = sheetToJson(sheet);
  const existingData = getExistingData(CONFIG.SP500_PATH);
  const mergedData = mergeData(existingData, newData);

  pushToGitHub(CONFIG.SP500_PATH, mergedData, 'Update S&P 500 data');
  Logger.log('S&P 500: 기존 ' + existingData.length + '개 + 신규 -> 총 ' + mergedData.length + '개');
}

/**
 * NASDAQ 업데이트 (병합 방식)
 */
function updateNASDAQ() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NASDAQ');
  const newData = sheetToJson(sheet);
  const existingData = getExistingData(CONFIG.NASDAQ_PATH);
  const mergedData = mergeData(existingData, newData);

  pushToGitHub(CONFIG.NASDAQ_PATH, mergedData, 'Update NASDAQ data');
  Logger.log('NASDAQ: 기존 ' + existingData.length + '개 + 신규 -> 총 ' + mergedData.length + '개');
}

/**
 * 시트 데이터를 JSON 배열로 변환
 */
function sheetToJson(sheet) {
  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const date = formatDate(row[0]);
    const value = parseFloat(row[1]);

    if (date && !isNaN(value)) {
      result.push({ date: date, value: value });
    }
  }

  result.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });

  return result;
}

/**
 * 날짜 포맷팅 (Date 객체 -> YYYY-MM-DD)
 */
function formatDate(dateValue) {
  if (!dateValue) return null;

  if (typeof dateValue === 'object' && typeof dateValue.getFullYear === 'function') {
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  const str = String(dateValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  return null;
}

/**
 * GitHub API로 파일 업데이트
 */
function pushToGitHub(filePath, data, commitMessage) {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('GitHub Token이 설정되지 않았습니다.');
  }

  const url = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/contents/' + filePath;

  let sha = null;
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
  } catch (e) { }

  const content = JSON.stringify(data);
  const encodedContent = Utilities.base64Encode(content, Utilities.Charset.UTF_8);

  const payload = {
    message: commitMessage,
    content: encodedContent,
    branch: CONFIG.BRANCH
  };

  if (sha) {
    payload.sha = sha;
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload)
  });

  if (response.getResponseCode() !== 200 && response.getResponseCode() !== 201) {
    throw new Error('GitHub API 오류: ' + response.getContentText());
  }

  Logger.log(filePath + ' 커밋 완료');
}

/**
 * 테스트: S&P 500 데이터 미리보기
 */
function testSP500Data() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SP500');
  const data = sheetToJson(sheet);
  Logger.log('총 ' + data.length + '개 레코드');
  Logger.log('첫 3개: ' + JSON.stringify(data.slice(0, 3)));
  Logger.log('마지막 3개: ' + JSON.stringify(data.slice(-3)));
}

/**
 * 테스트: NASDAQ 데이터 미리보기
 */
function testNASDAQData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NASDAQ');
  const data = sheetToJson(sheet);
  Logger.log('총 ' + data.length + '개 레코드');
  Logger.log('첫 3개: ' + JSON.stringify(data.slice(0, 3)));
  Logger.log('마지막 3개: ' + JSON.stringify(data.slice(-3)));
}

/**
 * 트리거 설정 (1회만 실행)
 * - 메인: 매일 오전 6시 (장마감 후)
 * - 백업: 매일 오전 9시 (안전장치)
 */
function setupTriggers() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'updateAllIndices') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 메인 트리거: 매일 오전 6시
  ScriptApp.newTrigger('updateAllIndices')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // 백업 트리거: 매일 오전 9시
  ScriptApp.newTrigger('updateAllIndices')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('트리거 설정 완료');
  Logger.log('  - 메인: 매일 오전 6시');
  Logger.log('  - 백업: 매일 오전 9시');
}

/**
 * 트리거 확인
 */
function checkTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('=== 현재 트리거 목록 ===');
  triggers.forEach(function (trigger, i) {
    Logger.log((i + 1) + '. ' + trigger.getHandlerFunction() + ' - ' + trigger.getTriggerSource());
  });
  Logger.log('총 ' + triggers.length + '개 트리거');
}
