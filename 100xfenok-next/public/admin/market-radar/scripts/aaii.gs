/**
 * AAII Sentiment Survey Data Pipeline
 *
 * 📊 데이터 소스: AAII Investor Sentiment Survey
 *    - URL: https://www.aaii.com/sentimentsurvey/sent_results
 *    - 업데이트: 주간 (목요일 발표)
 *
 * 📋 스프레드시트: AAII 시트
 *    - A1: =IMPORTHTML("https://www.aaii.com/sentimentsurvey/sent_results", "table", 1)
 *    - ⚠️ 시간이 오래되면 #N/A 발생 → 수식 갱신으로 해결
 *
 * 🔄 트리거: 금요일 00:00 + 06:00 KST (백업)
 *
 * 📁 GitHub 저장 경로: data/sentiment/aaii.json
 *
 * 🔐 보안: GITHUB_TOKEN은 스크립트 속성에 저장
 *    - 파일 → 프로젝트 설정 → 스크립트 속성 → GITHUB_TOKEN
 *
 * @version 1.1.0
 * @lastUpdated 2026-02-10
 * @changelog Added date normalization for "Mon DD" format → "YYYY-MM-DD"
 */

// ========================================
// MAIN: AAII 데이터 업데이트
// ========================================

function updateAAII() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('AAII');

  // ★ IMPORTHTML 강제 갱신 (스프레드시트 한계 우회)
  const formula = sheet.getRange('A1').getFormula();
  if (formula) {
    sheet.getRange('A1').setValue('');
    SpreadsheetApp.flush();
    Utilities.sleep(2000);
    sheet.getRange('A1').setFormula(formula);
    SpreadsheetApp.flush();
    Utilities.sleep(5000);
  }

  const data = sheet.getDataRange().getValues();

  // 데이터 없으면 스킵
  if (data.length < 2 || !data[1][0]) {
    Logger.log('⚠️ IMPORTHTML 갱신 실패 - 스킵');
    return;
  }

  const latest = data[1]; // 첫 번째 데이터 행 (헤더 제외)

  // 퍼센트 변환 헬퍼
  const toPercent = (v) => {
    const num = parseFloat(String(v).replace('%', ''));
    return num < 1 ? Math.round(num * 1000) / 10 : num;
  };

  // ========================================
  // 🔧 날짜 정규화 함수 (2026-02-10 추가)
  // "Feb 4" → "2026-02-04", "Jan 28" → "2025-01-28"
  // ========================================
  const normalizeDate = (dateStr) => {
    const currentYear = new Date().getFullYear();
    const parsed = new Date(dateStr + ' ' + currentYear);

    // 1월 데이터인데 현재가 2월 이상이면 작년으로 처리
    const currentMonth = new Date().getMonth() + 1;
    const dataMonth = parsed.getMonth() + 1;

    const year = (dataMonth === 1 && currentMonth >= 2) ? currentYear - 1 : currentYear;

    return year + '-' +
           String(dataMonth).padStart(2, '0') + '-' +
           String(parsed.getDate()).padStart(2, '0');
  };

  const newRecord = {
    date: normalizeDate(latest[0]), // 🔧 Modified: adds year prefix
    bullish: toPercent(latest[1]),
    neutral: toPercent(latest[2]),
    bearish: toPercent(latest[3])
  };

  // ========================================
  // GitHub API: Merge 방식 (기존 데이터 보존)
  // ========================================

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const owner = 'etloveaui';
  const repo = '100xFenok';
  const path = 'data/sentiment/aaii.json';

  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  // 기존 파일 가져오기
  const getRes = UrlFetchApp.fetch(getUrl, {
    headers: { 'Authorization': `token ${token}` }
  });
  const fileInfo = JSON.parse(getRes.getContentText());
  const existingData = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(fileInfo.content)).getDataAsString()
  );

  // 중복 체크 후 추가
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
        message: `chore: update AAII sentiment (${newRecord.date})`,
        content: content,
        sha: fileInfo.sha
      })
    });
    Logger.log('✅ GitHub 업데이트 완료: ' + JSON.stringify(newRecord));
  } else {
    Logger.log('⏭️ 이미 존재하는 데이터: ' + newRecord.date);
  }
}

// ========================================
// TRIGGER: AAII 트리거 설정
// ========================================

function createAAIITriggers() {
  // AAII 트리거만 삭제 (다른 트리거 보존)
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateAAII')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 금요일 00:00 KST (AAII는 목요일 미국시간에 발표)
  ScriptApp.newTrigger('updateAAII')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(0)
    .create();

  // 금요일 06:00 KST (백업 - IMPORTHTML 실패 대비)
  ScriptApp.newTrigger('updateAAII')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(6)
    .create();

  Logger.log('✅ AAII 트리거 2개 생성: 금요일 00:00 + 06:00 KST');
}

// ========================================
// MANUAL: 수동 테스트
// ========================================

function testAAII() {
  Logger.log('🧪 AAII 수동 테스트 시작...');
  updateAAII();
  Logger.log('🧪 테스트 완료');
}
