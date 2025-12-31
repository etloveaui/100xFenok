/**
 * Crypto Fear & Greed Index 수집기
 *
 * 데이터 소스: Alternative.me API
 * 대상: data/sentiment/crypto-fear-greed.json
 * 트리거: 매일 07:52 KST
 *
 * 패턴: merge (기존 데이터 보호 + 신규 추가/업데이트)
 */

/**
 * 메인 업데이트 함수
 * - Alternative.me API에서 최신 데이터 가져오기
 * - GitHub JSON 파일에 병합
 */
function updateCryptoFG() {
  const apiUrl = 'https://api.alternative.me/fng/?limit=1';

  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('❌ Crypto F&G API 실패: ' + response.getResponseCode());
      return;
    }

    const data = JSON.parse(response.getContentText());
    const latest = data.data[0];

    // timestamp → date 변환
    const date = new Date(parseInt(latest.timestamp) * 1000);
    const dateStr = date.toISOString().split('T')[0];

    const newEntry = {
      date: dateStr,
      value: parseInt(latest.value),
      classification: latest.value_classification
    };

    // GitHub에 업데이트
    updateCryptoJSON(newEntry);

    Logger.log('✅ Crypto F&G 업데이트: ' + JSON.stringify(newEntry));

  } catch (e) {
    Logger.log('❌ Crypto F&G 오류: ' + e.message);
  }
}

/**
 * GitHub JSON 파일 업데이트
 * 패턴: merge (기존 날짜 → 업데이트, 신규 날짜 → 추가)
 */
function updateCryptoJSON(newEntry) {
  const owner = 'etloveaui';
  const repo = '100xFenok';
  const path = 'data/sentiment/crypto-fear-greed.json';
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
  const idx = existing.findIndex(d => d.date === newEntry.date);
  if (idx >= 0) {
    existing[idx] = newEntry;
  } else {
    existing.push(newEntry);
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
      message: '🪙 Crypto F&G: ' + newEntry.date + ' = ' + newEntry.value + ' (' + newEntry.classification + ')',
      content: content,
      sha: fileData.sha
    })
  });
}

/**
 * 트리거 생성 (최초 1회)
 * 매일 07:00 KST
 */
function createCryptoTrigger() {
  ScriptApp.newTrigger('updateCryptoFG')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
}
