/**
 * 100xFenok 텔레그램 알림 프록시 (Google Apps Script)
 * 
 * 이 스크립트를 Google Apps Script에 배포하여 웹앱으로 사용하면
 * 토큰을 안전하게 서버 측에서 관리할 수 있습니다.
 * 
 * 사용법:
 * 1. script.google.com에서 새 프로젝트 생성
 * 2. 이 코드를 붙여넣기
 * 3. TELEGRAM_BOT_TOKEN과 CHAT_IDS 설정
 * 4. 웹앱으로 배포 (액세스: 모든 사용자)
 * 5. 배포 URL을 웹 패널에서 사용
 */

// 설정 - PropertiesService 사용 권장
const TELEGRAM_BOT_TOKEN = '7524488237:AAHqO35TON-hdu9HjstMfkZLHSa5NhaKww4';
const CHAT_IDS = [
  '-1001513671466',  // 그룹 Chat ID
  '6443399098',      // 개인 Chat ID 1  
  '1697642019'       // 개인 Chat ID 2
];

/**
 * 웹앱 POST 요청 처리
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { title, message, type } = data;
    
    if (!title || !message) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Title and message are required' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 텔레그램 메시지 발송
    const results = sendTelegramMessages(title, message);
    
    const successCount = results.filter(r => r.success).length;
    const response = {
      success: successCount > 0,
      successCount: successCount,
      totalCount: results.length,
      results: results
    };
    
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 웹앱 GET 요청 처리 (테스트용)
 */
function doGet(e) {
  const testResponse = {
    status: 'OK',
    service: '100xFenok Telegram Notification Proxy',
    version: '1.0',
    timestamp: new Date().toISOString()
  };
  
  return ContentService
    .createTextOutput(JSON.stringify(testResponse))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 모든 채널에 텔레그램 메시지 발송
 */
function sendTelegramMessages(title, message) {
  const results = [];
  
  for (const chatId of CHAT_IDS) {
    try {
      const result = sendTelegramMessage(chatId, title, message);
      results.push({
        chatId: chatId,
        success: result.success,
        messageId: result.messageId,
        error: result.error
      });
    } catch (error) {
      results.push({
        chatId: chatId,
        success: false,
        error: error.toString()
      });
    }
  }
  
  return results;
}

/**
 * 단일 채널에 텔레그램 메시지 발송
 */
function sendTelegramMessage(chatId, title, message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: `${title}\n\n${message}`,
      parse_mode: 'HTML'
    };
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.ok) {
      return {
        success: true,
        messageId: responseData.result.message_id
      };
    } else {
      return {
        success: false,
        error: responseData.description || 'Unknown error'
      };
    }
    
  } catch (error) {
    Logger.log(`Error sending message to ${chatId}: ${error.toString()}`);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 테스트 함수 (Apps Script 에디터에서 실행)
 */
function testNotification() {
  const results = sendTelegramMessages(
    '🧪 테스트 알림',
    'Google Apps Script 프록시 테스트입니다.\n\n시간: ' + new Date().toLocaleString('ko-KR')
  );
  
  Logger.log('Test results: ' + JSON.stringify(results, null, 2));
  return results;
}

/**
 * 설정 확인 함수
 */
function checkConfiguration() {
  const config = {
    hasToken: !!TELEGRAM_BOT_TOKEN,
    tokenLength: TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.length : 0,
    chatIdsCount: CHAT_IDS.length,
    chatIds: CHAT_IDS
  };
  
  Logger.log('Configuration: ' + JSON.stringify(config, null, 2));
  return config;
}