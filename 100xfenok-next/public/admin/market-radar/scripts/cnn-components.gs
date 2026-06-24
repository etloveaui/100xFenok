/**
 * CNN Fear & Greed 개별 구성요소 수집기
 *
 * 데이터 소스: Cloudflare Proxy → CNN API
 * 대상 (6개):
 *   - cnn-momentum.json (S&P 500 모멘텀)
 *   - cnn-strength.json (주가 강도)
 *   - cnn-breadth.json (주가 폭)
 *   - cnn-put-call.json (풋/콜 비율)
 *   - cnn-junk-bond.json (정크본드 수요)
 *   - cnn-safe-haven.json (안전자산 수요)
 *
 * 트리거: 매일 07:25 KST (cnn.gs 이후)
 * 패턴: merge (누적식)
 *
 * 참고: DEC-077, DEC-078
 *
 * Deprecated backup: 2026-06-24부터 운영 갱신은
 * scripts/fetch-sentiment.mjs + .github/workflows/fetch-sentiment.yml이 담당.
 * 이 GAS 백업은 명시 opt-in 없이는 GitHub에 쓰지 않는다.
 */

const GITHUB_OWNER = 'etloveaui';
const GITHUB_REPO = '100xFenok';
const DATA_PATH = 'data/sentiment';

function assertDeprecatedSentimentOptIn_(name) {
  const allow = PropertiesService.getScriptProperties().getProperty('ALLOW_DEPRECATED_GAS_SENTIMENT');
  if (allow !== 'true') {
    throw new Error(name + ' is deprecated. Use scripts/fetch-sentiment.mjs; set ALLOW_DEPRECATED_GAS_SENTIMENT=true only for manual historical recovery.');
  }
}

// 구성요소 매핑 (API key → 파일명)
const COMPONENTS = {
  'market_momentum_sp500': 'cnn-momentum',
  'stock_price_strength': 'cnn-strength',
  'stock_price_breadth': 'cnn-breadth',
  'put_call_options': 'cnn-put-call',
  'junk_bond_demand': 'cnn-junk-bond',
  'safe_haven_demand': 'cnn-safe-haven'
};

/**
 * 메인 업데이트 함수
 */
function updateCNNComponents() {
  assertDeprecatedSentimentOptIn_('updateCNNComponents');
  const proxyUrl = 'https://fed-proxy.etloveaui.workers.dev/cnn';

  try {
    const response = UrlFetchApp.fetch(proxyUrl, { muteHttpExceptions: true });

    if (response.getResponseCode() !== 200) {
      Logger.log('❌ CNN 프록시 실패: ' + response.getResponseCode());
      return;
    }

    const data = JSON.parse(response.getContentText());
    const today = new Date().toISOString().split('T')[0];

    // 6개 구성요소 각각 업데이트
    for (const [apiKey, fileName] of Object.entries(COMPONENTS)) {
      const component = data[apiKey];
      if (!component || !component.data || component.data.length === 0) {
        Logger.log('⚠️ ' + fileName + ' 데이터 없음');
        continue;
      }

      // 최신 데이터 (마지막 항목)
      const latest = component.data[component.data.length - 1];
      const entry = {
        date: today,
        value: Math.round(latest.y * 100) / 100,
        rating: latest.rating
      };

      updateJsonFile(fileName + '.json', entry);
      Logger.log('✅ ' + fileName + ': ' + entry.value + ' (' + entry.rating + ')');
    }

    Logger.log('✅ CNN Components 업데이트 완료: ' + today);

  } catch (e) {
    Logger.log('❌ CNN Components 오류: ' + e.message);
  }
}

/**
 * JSON 파일 업데이트 (누적식)
 */
function updateJsonFile(fileName, newEntry) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + DATA_PATH + '/' + fileName;

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
      message: '📊 CNN ' + fileName.replace('.json', '') + ': ' + newEntry.date,
      content: content,
      sha: fileData.sha
    })
  });
}

/**
 * 트리거 생성 (최초 1회)
 * 매일 07:25 KST (cnn.gs 07:20 이후)
 */
function createCNNComponentsTrigger() {
  assertDeprecatedSentimentOptIn_('createCNNComponentsTrigger');
  ScriptApp.newTrigger('updateCNNComponents')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(25)
    .create();
}
