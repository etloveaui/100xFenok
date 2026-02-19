/**
 * CFTC COT (Commitments of Traders) 데이터 수집기
 *
 * 데이터 소스: CFTC Public Reporting API
 * 대상: S&P 500 Consolidated - CME
 * 출력: data/sentiment/cftc-sp500.json
 *
 * 트리거: 토요일 06:00, 12:00 KST (CFTC 금요일 발표 후)
 * 방식: 누적식 (기존 데이터 보존 + 신규 추가)
 */

// ============================================================
// 메인 함수
// ============================================================

/**
 * CFTC COT 데이터 업데이트
 * - CFTC API에서 최신 데이터 조회
 * - 중복 체크 후 GitHub에 추가 (누적식)
 */
function updateCFTC() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const owner = 'etloveaui';
  const repo = '100xFenok';
  const path = 'data/sentiment/cftc-sp500.json';

  // 1. CFTC API에서 최신 데이터 가져오기
  const cftcUrl = 'https://publicreporting.cftc.gov/resource/jun7-fc8e.json?' +
    'market_and_exchange_names=S%26P%20500%20Consolidated%20-%20CHICAGO%20MERCANTILE%20EXCHANGE' +
    '&$limit=1&$order=report_date_as_yyyy_mm_dd%20DESC';

  const cftcRes = UrlFetchApp.fetch(cftcUrl);
  const cftcData = JSON.parse(cftcRes.getContentText());

  if (!cftcData || cftcData.length === 0) {
    Logger.log('CFTC 데이터 없음 - 스킵');
    return;
  }

  // 2. 데이터 파싱
  const latest = cftcData[0];
  const dateStr = latest.report_date_as_yyyy_mm_dd.substring(0, 10);
  const longPos = parseInt(latest.noncomm_positions_long_all || 0);
  const shortPos = parseInt(latest.noncomm_positions_short_all || 0);
  const openInt = parseInt(latest.open_interest_all || 0);

  const newRecord = {
    date: dateStr,
    long: longPos,
    short: shortPos,
    net: longPos - shortPos,
    openInterest: openInt
  };

  // 3. GitHub에서 기존 데이터 가져오기
  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const getRes = UrlFetchApp.fetch(getUrl, {
    headers: { 'Authorization': `token ${token}` }
  });
  const fileInfo = JSON.parse(getRes.getContentText());
  const existingData = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(fileInfo.content)).getDataAsString()
  );

  // 4. 중복 체크 및 추가 (누적식)
  const exists = existingData.some(r => r.date === newRecord.date);
  if (!exists) {
    existingData.push(newRecord);

    const content = Utilities.base64Encode(JSON.stringify(existingData, null, 2));
    UrlFetchApp.fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        message: `chore: update CFTC COT (${newRecord.date}) net=${newRecord.net}`,
        content: content,
        sha: fileInfo.sha
      })
    });
    Logger.log('CFTC 업데이트: ' + JSON.stringify(newRecord));
  } else {
    Logger.log('이미 존재: ' + newRecord.date);
  }
}

// ============================================================
// 트리거 관리
// ============================================================

/**
 * CFTC 트리거 생성
 * - 토요일 06:00 KST (CFTC 금요일 발표 직후)
 * - 토요일 12:00 KST (백업)
 */
function createCFTCTrigger() {
  // 기존 CFTC 트리거 삭제
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateCFTC')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 토요일 06:00 KST (발표 직후)
  ScriptApp.newTrigger('updateCFTC')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(6)
    .create();

  // 토요일 12:00 KST (백업)
  ScriptApp.newTrigger('updateCFTC')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(12)
    .create();

  Logger.log('CFTC 트리거 2개 생성: 토요일 06:00 + 12:00 KST');
}
