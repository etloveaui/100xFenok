// Google Apps Script 백엔드 코드
// 이 파일을 Google Apps Script 프로젝트에 복사하여 사용

// 스프레드시트 ID들 - 실제 배포시 설정 필요
const SPREADSHEET_CONFIG = {
  MASTER_SHEET_ID: 'YOUR_MASTER_SPREADSHEET_ID', // 메인 데이터 시트
  BUDGET_SHEET_NAME: 'Budget',
  ITINERARY_SHEET_NAME: 'Itinerary', 
  POI_SHEET_NAME: 'POI_UserData',
  USER_PROFILES_SHEET_NAME: 'UserProfiles'
};

// API 키들 - PropertiesService로 관리
const API_KEYS = {
  WEATHER_API: PropertiesService.getScriptProperties().getProperty('WEATHER_API_KEY'),
  GEOCODING_API: PropertiesService.getScriptProperties().getProperty('GEOCODING_API_KEY'),
  EXCHANGE_RATE_API: PropertiesService.getScriptProperties().getProperty('EXCHANGE_RATE_API_KEY')
};

/**
 * 메인 웹앱 엔트리포인트
 */
function doGet(e) {
  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>미야코지마 여행 가이드 API</title>
        <meta charset="UTF-8">
      </head>
      <body>
        <h1>미야코지마 여행 가이드 백엔드</h1>
        <p>API가 정상적으로 실행되고 있습니다.</p>
        <p>버전: v1.0.0</p>
        <p>마지막 업데이트: ${new Date().toLocaleString('ko-KR')}</p>
      </body>
    </html>
  `).setTitle('미야코지마 API');
}

/**
 * POST 요청 처리
 */
function doPost(e) {
  try {
    // CORS 헤더 설정
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    
    // 요청 파라미터 파싱
    let requestData = {};
    if (e.postData && e.postData.contents) {
      requestData = JSON.parse(e.postData.contents);
    }
    
    const action = requestData.action || e.parameter.action;
    const data = requestData.data || {};
    
    let response = {};
    
    switch (action) {
      case 'save_budget':
        response = saveBudgetData(data);
        break;
        
      case 'get_budget':
        response = getBudgetData(data);
        break;
        
      case 'sync_budget':
        response = syncBudgetData(data);
        break;
        
      case 'save_itinerary':
        response = saveItineraryData(data);
        break;
        
      case 'get_itinerary':
        response = getItineraryData(data);
        break;
        
      case 'sync_itinerary':
        response = syncItineraryData(data);
        break;
        
      case 'save_poi_data':
        response = savePOIUserData(data);
        break;
        
      case 'get_poi_data':
        response = getPOIUserData(data);
        break;
        
      case 'sync_poi':
        response = syncPOIData(data);
        break;
        
      case 'get_weather':
        response = getWeatherData(data);
        break;
        
      case 'get_exchange_rate':
        response = getExchangeRate(data);
        break;
        
      case 'geocode':
        response = geocodeAddress(data);
        break;
        
      case 'save_user_profile':
        response = saveUserProfile(data);
        break;
        
      case 'get_user_profile':
        response = getUserProfile(data);
        break;
        
      default:
        response = {
          success: false,
          error: 'Invalid action: ' + action,
          availableActions: [
            'save_budget', 'get_budget', 'sync_budget',
            'save_itinerary', 'get_itinerary', 'sync_itinerary', 
            'save_poi_data', 'get_poi_data', 'sync_poi',
            'get_weather', 'get_exchange_rate', 'geocode',
            'save_user_profile', 'get_user_profile'
          ]
        };
    }
    
    return output.setContent(JSON.stringify(response));
    
  } catch (error) {
    console.error('API Error:', error);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 예산 데이터 저장
 */
function saveBudgetData(data) {
  try {
    const sheet = getOrCreateSheet(SPREADSHEET_CONFIG.BUDGET_SHEET_NAME);
    
    // 헤더가 없으면 생성
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 8).setValues([[
        'Timestamp', 'Date', 'Amount', 'Category', 'Description', 'Location', 'UserId', 'SyncId'
      ]]);
    }
    
    // 데이터 추가
    const expenses = data.expenses || [];
    expenses.forEach(expense => {
      sheet.appendRow([
        new Date(expense.timestamp || Date.now()),
        expense.date || new Date().toISOString().split('T')[0],
        expense.amount || 0,
        expense.category || '',
        expense.description || '',
        expense.location || '',
        data.userId || 'anonymous',
        expense.id || generateUniqueId()
      ]);
    });
    
    return {
      success: true,
      message: `${expenses.length}개의 지출 내역이 저장되었습니다`,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Budget save error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 예산 데이터 조회
 */
function getBudgetData(data) {
  try {
    const sheet = getSheet(SPREADSHEET_CONFIG.BUDGET_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        success: true,
        data: { expenses: [], summary: { total: 0, today: 0, categories: {} } }
      };
    }
    
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const rows = values.slice(1);
    
    const userId = data.userId || 'anonymous';
    const dateFilter = data.dateFilter || null;
    
    const expenses = rows
      .filter(row => !userId || row[6] === userId)
      .filter(row => !dateFilter || row[1] === dateFilter)
      .map(row => ({
        timestamp: row[0].getTime ? row[0].getTime() : row[0],
        date: row[1],
        amount: row[2],
        category: row[3],
        description: row[4],
        location: row[5],
        id: row[7]
      }));
    
    // 요약 통계 계산
    const summary = calculateBudgetSummary(expenses);
    
    return {
      success: true,
      data: { expenses, summary },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Budget get error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 예산 데이터 동기화
 */
function syncBudgetData(data) {
  try {
    const localData = data.localData || {};
    const serverData = getBudgetData({ userId: data.userId });
    
    if (!serverData.success) {
      throw new Error('Failed to get server data');
    }
    
    // 로컬 데이터 중 서버에 없는 것들만 저장
    const localExpenses = localData.expenses || [];
    const serverExpenses = serverData.data.expenses || [];
    const serverIds = new Set(serverExpenses.map(e => e.id));
    
    const newExpenses = localExpenses.filter(expense => !serverIds.has(expense.id));
    
    if (newExpenses.length > 0) {
      const saveResult = saveBudgetData({ 
        expenses: newExpenses, 
        userId: data.userId 
      });
      
      if (!saveResult.success) {
        throw new Error(saveResult.error);
      }
    }
    
    // 최신 데이터 반환
    return getBudgetData({ userId: data.userId });
    
  } catch (error) {
    console.error('Budget sync error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 일정 데이터 저장
 */
function saveItineraryData(data) {
  try {
    const sheet = getOrCreateSheet(SPREADSHEET_CONFIG.ITINERARY_SHEET_NAME);
    
    // 헤더 생성
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 12).setValues([[
        'Timestamp', 'Date', 'Time', 'Title', 'Location', 'Category', 
        'Duration', 'EstimatedCost', 'Description', 'Completed', 'UserId', 'SyncId'
      ]]);
    }
    
    // 일정 항목 저장
    const scheduleItems = data.scheduleItems || [];
    scheduleItems.forEach(item => {
      sheet.appendRow([
        new Date(item.createdAt || Date.now()),
        item.date,
        item.time,
        item.title,
        item.location || '',
        item.category || '',
        item.duration || 60,
        item.estimatedCost || 0,
        item.description || '',
        item.completed || false,
        data.userId || 'anonymous',
        item.id || generateUniqueId()
      ]);
    });
    
    return {
      success: true,
      message: `${scheduleItems.length}개의 일정이 저장되었습니다`,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Itinerary save error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 일정 데이터 조회
 */
function getItineraryData(data) {
  try {
    const sheet = getSheet(SPREADSHEET_CONFIG.ITINERARY_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        success: true,
        data: { itinerary: {}, scheduleItems: [] }
      };
    }
    
    const values = sheet.getDataRange().getValues();
    const rows = values.slice(1);
    const userId = data.userId || 'anonymous';
    
    const scheduleItems = rows
      .filter(row => row[10] === userId)
      .map(row => ({
        id: row[11],
        date: row[1],
        time: row[2],
        title: row[3],
        location: row[4],
        category: row[5],
        duration: row[6],
        estimatedCost: row[7],
        description: row[8],
        completed: row[9],
        createdAt: row[0].getTime ? row[0].getTime() : row[0]
      }));
    
    return {
      success: true,
      data: { 
        itinerary: {},
        scheduleItems 
      },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Itinerary get error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 일정 데이터 동기화
 */
function syncItineraryData(data) {
  try {
    const localData = data.localData || {};
    const serverData = getItineraryData({ userId: data.userId });
    
    if (!serverData.success) {
      throw new Error('Failed to get server data');
    }
    
    const localItems = localData.scheduleItems || [];
    const serverItems = serverData.data.scheduleItems || [];
    const serverIds = new Set(serverItems.map(item => item.id));
    
    const newItems = localItems.filter(item => !serverIds.has(item.id));
    
    if (newItems.length > 0) {
      const saveResult = saveItineraryData({ 
        scheduleItems: newItems, 
        userId: data.userId 
      });
      
      if (!saveResult.success) {
        throw new Error(saveResult.error);
      }
    }
    
    return getItineraryData({ userId: data.userId });
    
  } catch (error) {
    console.error('Itinerary sync error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * POI 사용자 데이터 저장
 */
function savePOIUserData(data) {
  try {
    const sheet = getOrCreateSheet(SPREADSHEET_CONFIG.POI_SHEET_NAME);
    
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 8).setValues([[
        'Timestamp', 'POI_ID', 'Action', 'Rating', 'Notes', 'Visited', 'UserId', 'SyncId'
      ]]);
    }
    
    const userActions = data.userActions || [];
    userActions.forEach(action => {
      sheet.appendRow([
        new Date(action.timestamp || Date.now()),
        action.poiId,
        action.action, // 'favorite', 'visited', 'rated', 'note'
        action.rating || null,
        action.notes || '',
        action.visited || false,
        data.userId || 'anonymous',
        action.id || generateUniqueId()
      ]);
    });
    
    return {
      success: true,
      message: `${userActions.length}개의 POI 데이터가 저장되었습니다`,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('POI save error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * POI 사용자 데이터 조회
 */
function getPOIUserData(data) {
  try {
    const sheet = getSheet(SPREADSHEET_CONFIG.POI_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        success: true,
        data: { userActions: [], favorites: [], visited: [] }
      };
    }
    
    const values = sheet.getDataRange().getValues();
    const rows = values.slice(1);
    const userId = data.userId || 'anonymous';
    
    const userActions = rows
      .filter(row => row[6] === userId)
      .map(row => ({
        id: row[7],
        timestamp: row[0].getTime ? row[0].getTime() : row[0],
        poiId: row[1],
        action: row[2],
        rating: row[3],
        notes: row[4],
        visited: row[5]
      }));
    
    // 즐겨찾기와 방문한 장소 목록 생성
    const favorites = userActions
      .filter(action => action.action === 'favorite')
      .map(action => action.poiId);
      
    const visited = userActions
      .filter(action => action.visited === true)
      .map(action => action.poiId);
    
    return {
      success: true,
      data: { userActions, favorites, visited },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('POI get error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 날씨 데이터 조회
 */
function getWeatherData(data) {
  try {
    if (!API_KEYS.WEATHER_API) {
      throw new Error('Weather API key not configured');
    }
    
    const lat = data.lat || 24.7449;
    const lng = data.lng || 125.2813;
    const apiKey = API_KEYS.WEATHER_API;
    
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=kr`;
    const response = UrlFetchApp.fetch(url);
    const weatherData = JSON.parse(response.getContentText());
    
    if (weatherData.cod !== 200) {
      throw new Error(weatherData.message);
    }
    
    return {
      success: true,
      data: {
        temp: Math.round(weatherData.main.temp),
        description: weatherData.weather[0].description,
        icon: weatherData.weather[0].icon,
        humidity: weatherData.main.humidity,
        windSpeed: weatherData.wind.speed,
        pressure: weatherData.main.pressure,
        feelsLike: Math.round(weatherData.main.feels_like),
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('Weather API error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 환율 데이터 조회
 */
function getExchangeRate(data) {
  try {
    const fromCurrency = data.from || 'KRW';
    const toCurrency = data.to || 'JPY';
    
    const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
    const response = UrlFetchApp.fetch(url);
    const exchangeData = JSON.parse(response.getContentText());
    
    const rate = exchangeData.rates[toCurrency];
    if (!rate) {
      throw new Error(`Exchange rate not found for ${fromCurrency} to ${toCurrency}`);
    }
    
    return {
      success: true,
      data: {
        from: fromCurrency,
        to: toCurrency,
        rate: rate,
        timestamp: exchangeData.date,
        lastUpdated: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('Exchange rate API error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 주소 좌표 변환
 */
function geocodeAddress(data) {
  try {
    if (!API_KEYS.GEOCODING_API) {
      throw new Error('Geocoding API key not configured');
    }
    
    const address = data.address;
    const apiKey = API_KEYS.GEOCODING_API;
    
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(address)}&key=${apiKey}&language=ko&countrycode=jp`;
    const response = UrlFetchApp.fetch(url);
    const geocodeData = JSON.parse(response.getContentText());
    
    if (geocodeData.results.length === 0) {
      throw new Error('No results found for address: ' + address);
    }
    
    const result = geocodeData.results[0];
    
    return {
      success: true,
      data: {
        lat: result.geometry.lat,
        lng: result.geometry.lng,
        formattedAddress: result.formatted,
        components: result.components
      }
    };
    
  } catch (error) {
    console.error('Geocoding API error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 사용자 프로필 저장
 */
function saveUserProfile(data) {
  try {
    const sheet = getOrCreateSheet(SPREADSHEET_CONFIG.USER_PROFILES_SHEET_NAME);
    
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 6).setValues([[
        'Timestamp', 'UserId', 'Name', 'Preferences', 'Settings', 'LastLogin'
      ]]);
    }
    
    const profile = data.profile || {};
    const userId = data.userId || 'anonymous';
    
    // 기존 프로필 찾기
    const values = sheet.getDataRange().getValues();
    const existingRowIndex = values.findIndex(row => row[1] === userId);
    
    const profileData = [
      new Date().toISOString(),
      userId,
      profile.name || '',
      JSON.stringify(profile.preferences || {}),
      JSON.stringify(profile.settings || {}),
      new Date().toISOString()
    ];
    
    if (existingRowIndex > 0) {
      // 기존 프로필 업데이트
      sheet.getRange(existingRowIndex + 1, 1, 1, 6).setValues([profileData]);
    } else {
      // 새 프로필 추가
      sheet.appendRow(profileData);
    }
    
    return {
      success: true,
      message: '사용자 프로필이 저장되었습니다',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('User profile save error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 사용자 프로필 조회
 */
function getUserProfile(data) {
  try {
    const sheet = getSheet(SPREADSHEET_CONFIG.USER_PROFILES_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        success: true,
        data: { profile: null }
      };
    }
    
    const values = sheet.getDataRange().getValues();
    const userId = data.userId || 'anonymous';
    
    const userRow = values.find(row => row[1] === userId);
    if (!userRow) {
      return {
        success: true,
        data: { profile: null }
      };
    }
    
    const profile = {
      userId: userRow[1],
      name: userRow[2],
      preferences: JSON.parse(userRow[3] || '{}'),
      settings: JSON.parse(userRow[4] || '{}'),
      lastLogin: userRow[5],
      createdAt: userRow[0]
    };
    
    return {
      success: true,
      data: { profile },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('User profile get error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 유틸리티 함수들
 */

function getSheet(sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_CONFIG.MASTER_SHEET_ID);
    return spreadsheet.getSheetByName(sheetName);
  } catch (error) {
    console.error('Error getting sheet:', error);
    return null;
  }
}

function getOrCreateSheet(sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_CONFIG.MASTER_SHEET_ID);
    let sheet = spreadsheet.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }
    
    return sheet;
  } catch (error) {
    console.error('Error creating sheet:', error);
    throw error;
  }
}

function generateUniqueId() {
  return 'id_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9);
}

function calculateBudgetSummary(expenses) {
  const today = new Date().toISOString().split('T')[0];
  const todayExpenses = expenses.filter(e => e.date === today);
  
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
  
  const categories = {};
  expenses.forEach(e => {
    if (!categories[e.category]) {
      categories[e.category] = 0;
    }
    categories[e.category] += e.amount;
  });
  
  return {
    total,
    today: todayTotal,
    categories,
    count: expenses.length,
    todayCount: todayExpenses.length
  };
}

/**
 * 시간 기반 캐시 관리
 */
function cleanupOldData() {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30); // 30일 이전 데이터 정리
    
    const sheets = [
      SPREADSHEET_CONFIG.BUDGET_SHEET_NAME,
      SPREADSHEET_CONFIG.ITINERARY_SHEET_NAME,
      SPREADSHEET_CONFIG.POI_SHEET_NAME
    ];
    
    sheets.forEach(sheetName => {
      const sheet = getSheet(sheetName);
      if (!sheet) return;
      
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const rows = values.slice(1);
      
      const filteredRows = rows.filter(row => {
        const timestamp = new Date(row[0]);
        return timestamp > cutoffDate;
      });
      
      if (filteredRows.length !== rows.length) {
        sheet.clear();
        if (filteredRows.length > 0) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.getRange(2, 1, filteredRows.length, headers.length).setValues(filteredRows);
        } else {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
        console.log(`Cleaned up ${rows.length - filteredRows.length} old records from ${sheetName}`);
      }
    });
    
  } catch (error) {
    console.error('Data cleanup error:', error);
  }
}

/**
 * 트리거 설정용 함수들
 */
function createTriggers() {
  // 매일 자정에 데이터 정리
  ScriptApp.newTrigger('cleanupOldData')
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .create();
    
  console.log('Triggers created successfully');
}

function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('All triggers deleted');
}