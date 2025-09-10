# [Jules] Google Sheets와 연동하는 무료 실시간 백엔드 구축 가이드

안녕하세요, 사용자님.

이전 브리핑에서 제안드렸던 '무료 실시간 백엔드'를 실제로 구축하는 방법을 A부터 Z까지 상세하게 안내해 드리겠습니다. 이 가이드를 따라 하시면, 현재의 웹앱을 두 분이 함께 사용하는 강력한 실시간 협업 도구로 업그레이드할 수 있습니다.

---

## Part 1: Google Sheet 데이터베이스 설정하기

가장 먼저, 우리의 데이터를 저장할 스프레드시트를 생성하고 준비해야 합니다.

1.  **새 Google Sheet 생성**
    *   브라우저에서 `sheet.new`를 입력하여 새로운 Google Sheet를 엽니다.
    *   좌측 상단의 파일 이름을 `Miyakojima_DB` 와 같이 식별하기 쉬운 이름으로 변경합니다.

2.  **'Budget' 시트 만들기**
    *   기본으로 생성된 `Sheet1`의 이름을 더블클릭하여 `Budget`으로 변경합니다.
    *   첫 번째 행(헤더)에 다음 4개의 값을 순서대로 입력합니다.
        *   `A1` 셀: `Timestamp`
        *   `B1` 셀: `Amount`
        *   `C1` 셀: `Category`
        *   `D1` 셀: `Notes`

3.  **'Itinerary' 시트 만들기 (선택 사항)**
    *   좌측 하단의 `+` 버튼을 눌러 새 시트를 추가합니다.
    *   새 시트의 이름을 `Itinerary`로 변경합니다.
    *   첫 번째 행에 `Timestamp`, `Time`, `Place`, `Status`, `Notes` 등을 필요에 맞게 설정할 수 있습니다. 이 가이드에서는 `Budget`을 중심으로 설명합니다.

4.  **(중요) 스프레드시트 ID 복사하기**
    *   브라우저의 주소창을 확인합니다. 주소는 아래와 같은 형식입니다.
        `https://docs.google.com/spreadsheets/d/`**`[여기에_긴_문자열이_있습니다]`**`/edit`
    *   중간에 있는 이 긴 문자열이 **스프레드시트 ID**입니다. 이 값을 복사하여 메모장 같은 곳에 잠시 보관해두세요. 다음 단계에서 필요합니다.

---

## Part 2: Google Apps Script 백엔드(API) 작성하기

이제 방금 만든 Google Sheet를 제어할 수 있는 '무료 서버'인 Google Apps Script를 작성할 차례입니다.

1.  **Apps Script 편집기 열기**
    *   방금 만든 `Miyakojima_DB` 스프레드시트에서, 상단 메뉴의 **`Extensions` > `Apps Script`**를 클릭합니다.
    *   새로운 탭이나 창에서 Apps Script 편집기가 열립니다.

2.  **스크립트 코드 작성하기**
    *   기존에 있던 코드를 모두 지우고, 아래의 코드를 그대로 복사하여 붙여넣습니다.
    *   코드 상단의 `YOUR_SPREADSHEET_ID_HERE` 부분을, Part 1에서 복사해 둔 **실제 스프레드시트 ID로 교체**하는 것을 잊지 마세요.

```javascript
// 1. 설정: 이 부분에 당신의 스프레드시트 ID를 입력하세요.
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE";

// 2. POST 요청 처리 (데이터 추가)
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (!action) {
      throw new Error("Action not specified");
    }

    let result;
    switch (action) {
      case 'addExpense':
        result = addExpense(data);
        break;
      // 여기에 다른 action (예: addItinerary)을 추가할 수 있습니다.
      default:
        throw new Error("Invalid action specified");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 3. GET 요청 처리 (데이터 조회)
function doGet(e) {
  try {
    const action = e.parameter.action;

    if (!action) {
      throw new Error("Action not specified");
    }

    let result;
    switch (action) {
      case 'getExpenses':
        result = getExpenses();
        break;
      // 여기에 다른 action (예: getItinerary)을 추가할 수 있습니다.
      default:
        throw new Error("Invalid action specified");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --- 실제 작업 함수들 ---

/**
 * 'Budget' 시트에 새로운 지출 내역을 추가합니다.
 * @param {object} data - { amount, category, notes }
 */
function addExpense(data) {
  if (!data.amount || !data.category) {
    throw new Error("Amount and Category are required for adding an expense.");
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Budget');
  const newRow = [
    new Date(),       // Timestamp
    data.amount,      // Amount
    data.category,    // Category
    data.notes || ''  // Notes (optional)
  ];
  sheet.appendRow(newRow);
  return { row: newRow };
}

/**
 * 'Budget' 시트의 모든 지출 내역을 조회합니다.
 */
function getExpenses() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Budget');
  // getDataRange().getValues()는 2차원 배열을 반환합니다.
  // shift()를 사용해 헤더 행을 제거합니다.
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  // 각 행을 객체로 변환합니다.
  const expenses = values.map(row => {
    let expense = {};
    headers.forEach((header, index) => {
      expense[header.toLowerCase()] = row[index];
    });
    return expense;
  });

  return expenses;
}
```

3.  **프로젝트 저장**
    *   상단의 디스크 모양(💾) 아이콘을 눌러 프로젝트를 저장합니다.
    *   프로젝트 이름을 `Miyakojima_Backend` 와 같이 정해줍니다.

---

## Part 3: Apps Script 배포 및 권한 설정하기

코드를 작성했으니, 이제 이 스크립트를 외부(웹앱)에서 호출할 수 있는 인터넷 주소(URL)를 가진 '웹 앱'으로 만들어야 합니다.

1.  **새 배포 만들기**
    *   Apps Script 편집기 우측 상단의 파란색 **`Deploy`** 버튼을 클릭합니다.
    *   드롭다운 메뉴에서 **`New deployment`**를 선택합니다.

2.  **배포 유형 선택**
    *   'Select type' 옆의 톱니바퀴 아이콘(⚙️)을 클릭하고, **`Web app`**을 선택합니다.

3.  **웹 앱 설정**
    *   **`Description`**: "미야코지마 웹앱 백엔드 v1" 과 같이 설명을 입력합니다.
    *   **`Execute as`**: **`Me (your-email@gmail.com)`** 로 그대로 둡니다.
    *   **(매우 중요) `Who has access`**: **`Anyone`** 으로 변경합니다. 이렇게 해야 웹앱에서 권한 문제없이 호출할 수 있습니다.

4.  **배포 및 권한 승인**
    *   **`Deploy`** 버튼을 클릭합니다.
    *   Google이 이 스크립트가 당신의 스프레드시트에 접근하는 것을 허용할지 묻는 **`Authorize access`** 창이 뜹니다.
    *   당신의 Google 계정을 선택하고, "Advanced" 또는 "고급" 링크를 클릭한 후, "Go to (unsafe)" 또는 "Miyakojima_Backend(으)로 이동" 링크를 클릭하여 권한을 **허용(Allow)**합니다.

5.  **(중요) 웹 앱 URL 복사하기**
    *   배포가 완료되면 `Deployment successful` 창에 **`Web app URL`**이 표시됩니다.
    *   이 URL을 복사하여 메모장에 다시 보관해두세요. 이것이 우리 백엔드 API의 최종 주소입니다.

---

## Part 4: 웹앱 프론트엔드 연동하기

이제 마지막 단계입니다. 기존 `miyakojima-web`의 JavaScript 코드를 수정하여, 로컬 스토리지 대신 우리가 만든 새로운 백엔드 API와 통신하도록 만듭니다.

1.  **`api.js` 파일 수정 (또는 생성)**
    *   `js/api.js` 파일에 아래와 같은 범용 API 통신 함수를 추가합니다. 이 함수는 백엔드와 통신하는 역할을 전담합니다.

```javascript
// js/api.js

// Part 3에서 복사한 당신의 웹 앱 URL을 여기에 붙여넣으세요.
const WEB_APP_URL = 'YOUR_WEB_APP_URL_HERE';

async function sendToBackend(method, params = {}) {
    let url = WEB_APP_URL;
    const options = {
        method: method,
        redirect: 'follow',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8', // Apps Script 웹 앱은 이 헤더를 사용해야 할 수 있습니다.
        },
    };

    if (method === 'GET') {
        // GET 요청의 경우 파라미터를 URL에 추가합니다.
        url += '?' + new URLSearchParams(params).toString();
    } else if (method === 'POST') {
        // POST 요청의 경우 파라미터를 body에 추가합니다.
        options.body = JSON.stringify(params);
    }

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        if (result.status === 'error') {
            throw new Error(`Backend error: ${result.message}`);
        }
        return result.data;
    } catch (error) {
        console.error('Error communicating with backend:', error);
        // 여기에 사용자에게 에러를 표시하는 UI 로직을 추가할 수 있습니다.
        throw error;
    }
}
```

2.  **`budget.js` 파일 수정**
    *   `js/budget.js` 파일에서 지출을 추가하고 조회하는 부분을 수정합니다. `Storage`를 사용하던 부분을 `sendToBackend` 함수를 호출하도록 변경합니다.

```javascript
// js/budget.js (예시 수정안)

class BudgetTracker {
    constructor() {
        this.expenses = [];
        // ... 기존 코드
    }

    // [수정] 지출 내역 추가 함수
    async addExpense(amount, category, notes) {
        try {
            const newExpenseData = {
                action: 'addExpense',
                amount: amount,
                category: category,
                notes: notes,
            };
            // 로컬 스토리지 대신 백엔드로 전송
            const result = await sendToBackend('POST', newExpenseData);
            console.log('Expense added via backend:', result);

            // UI 즉시 업데이트를 위해 로컬 데이터에도 추가
            this.expenses.push({
                timestamp: new Date().toISOString(), // 백엔드에서 받은 타임스탬프를 사용하는 것이 더 정확합니다.
                amount,
                category,
                notes
            });
            this.render(); // UI 다시 그리기

        } catch (error) {
            console.error('Failed to add expense:', error);
            alert('지출 내역 추가에 실패했습니다. 인터넷 연결을 확인해주세요.');
        }
    }

    // [수정] 모든 지출 내역 불러오기 함수
    async loadExpenses() {
        try {
            const params = { action: 'getExpenses' };
            // 로컬 스토리지 대신 백엔드에서 조회
            const expensesFromSheet = await sendToBackend('GET', params);
            this.expenses = expensesFromSheet;
            console.log('Expenses loaded from backend:', this.expenses);

            this.render(); // UI 다시 그리기

        } catch (error) {
            console.error('Failed to load expenses:', error);
            alert('지출 내역을 불러오는 데 실패했습니다.');
        }
    }

    // ... 나머지 기존 코드 (render, calculateTotal 등)
}

// 앱 초기화 시 loadExpenses()를 호출하도록 설정해야 합니다.
// app.js 또는 관련 초기화 파일에서
// const budgetTracker = new BudgetTracker();
// budgetTracker.loadExpenses();
```

### **축하합니다!**

이제 당신의 웹앱은 Google Sheets를 실시간 데이터베이스로 사용하는 백엔드와 연동되었습니다. 지출 내역을 추가하면 공유된 Google Sheet에 즉시 기록되고, 앱을 새로고침하면 모든 기록이 동기화될 것입니다. 두 분이 각자의 기기에서 앱을 사용하더라도 항상 같은 데이터를 보게 됩니다.

이 가이드가 도움이 되었기를 바랍니다.

**Jules 드림.**
