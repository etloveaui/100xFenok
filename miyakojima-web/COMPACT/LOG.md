ℹ️ API 연동 모듈 로드 완료 
utils.js:16 ℹ️ 예산 추적 모듈 로드 완료 
utils.js:16 ℹ️ GPS 위치 추적 모듈 로드 완료 
utils.js:16 ℹ️ POI 관리 및 추천 모듈 로드 완료 
utils.js:16 ℹ️ DOM 로드 완료, 모듈 초기화 시작 
utils.js:16 ℹ️ 모듈 초기화 순서 계산 완료: Array(11)
utils.js:16 ℹ️ === 미야코지마 앱 모듈 초기화 시작 === 
utils.js:16 ℹ️ [config] 초기화 시작... 
app.js:29 🔍 CONFIG 초기화 시도. ConfigStatus 존재: true
config.js:293 🔧 CONFIG 초기화 시작!
config.js:277 🏝️ 미야코지마 웹 플랫폼 설정 로드됨
config.js:278 📅 여행 기간: 2025-09-27 ~ 2025-10-01
config.js:279 💰 일일 예산: 20000 JPY
config.js:280 🗺️ POI 카테고리: 9 개
config.js:281 ⚡ 디버그 모드: 활성
config.js:300 ✅ CONFIG 초기화 성공!
utils.js:16 ℹ️ [config] 초기화 완료 ✓ 
utils.js:16 ℹ️ [utils] 초기화 시작... 
utils.js:16 ℹ️ 유틸리티 모듈 초기화 완료 
utils.js:16 ℹ️ [utils] 초기화 완료 ✓ 
utils.js:16 ℹ️ [storage] 초기화 시작... 
storage.js:253 Storage Manager 초기화 완료
utils.js:16 ℹ️ [storage] 초기화 완료 ✓ 
utils.js:16 ℹ️ [api] 초기화 시작... 
utils.js:16 ℹ️ API 모듈 초기화 완룄 
utils.js:16 ℹ️ [api] 초기화 완료 ✓ 
utils.js:16 ℹ️ [budget] 초기화 시작... 
utils.js:16 ℹ️ [budget] 이미 초기화됨 
utils.js:16 ℹ️ [location] 초기화 시작... 
utils.js:16 ℹ️ [location] 이미 초기화됨 
utils.js:16 ℹ️ [poi] 초기화 시작... 
utils.js:16 ℹ️ POI 관리자 초기화 중... 
utils.js:16 ℹ️ POI 관리자 초기화 완료 
utils.js:16 ℹ️ [poi] 초기화 완료 ✓ 
utils.js:16 ℹ️ [itinerary] 초기화 시작... 
utils.js:16 ℹ️ Itinerary Manager 초기화 완료 
utils.js:22 ⚠️ Failed to load itinerary from backend: Error: 백엔드가 구성되지 않았습니다. 오프라인 모드로 실행됩니다.
    at BackendAPI.request (api.js:18:19)
    at ItineraryManager.loadItineraryData (itinerary.js:86:61)
    at ItineraryManager.init (itinerary.js:13:24)
    at new ItineraryManager (itinerary.js:8:14)
    at Object.init (itinerary.js:593:21)
    at Object.initialize (app.js:99:55)
    at ModuleInitializer.executeModuleInitialization (app.js:356:26)
    at ModuleInitializer.initializeModule (app.js:288:22)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ Itinerary Manager initialized 
utils.js:16 ℹ️ [itinerary] 초기화 완료 ✓ 
utils.js:16 ℹ️ [dashboard] 초기화 시작... 
utils.js:16 ℹ️ Service Worker 등록 성공: ServiceWorkerRegistration
miyakojima-web/:340 SW registered:  ServiceWorkerRegistration
miyakojima-web/manifest.json:1 Manifest: Enctype should be set to either application/x-www-form-urlencoded or multipart/form-data. It currently defaults to application/x-www-form-urlencodedUnderstand this warning
miyakojima-web/:1 <meta name="apple-mobile-web-app-capable" content="yes"> is deprecated. Please include <meta name="mobile-web-app-capable" content="yes">Understand this warning
utils.js:16 ℹ️ POI 데이터 파일에서 로드됨: undefined개
utils.js:27 ❌ POI 데이터 로드 실패: TypeError: this.pois.forEach is not a function
    at POIManager.preprocessPOIData (poi.js:88:19)
    at POIManager.loadPOIData (poi.js:76:18)
    at async POIManager.init (poi.js:30:9)
error @ utils.js:27Understand this error
utils.js:16 ℹ️ POI 관리자 초기화 완료: 0개 POI 로드됨
/favicon.ico:1  Failed to load resource: the server responded with a status of 404 ()Understand this error
utils.js:27 ❌ [dashboard] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27
initializeModule @ app.js:305Understand this error
utils.js:22 ⚠️ [dashboard] 재시도 1/3... 
warn @ utils.js:22
initializeModule @ app.js:310Understand this warning
utils.js:16 ℹ️ [dashboard] 초기화 시작... 
utils.js:27 ❌ [dashboard] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [dashboard] 재시도 2/3... 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [dashboard] 초기화 시작... 
utils.js:27 ❌ [dashboard] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [dashboard] 재시도 3/3... 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [dashboard] 초기화 시작... 
utils.js:27 ❌ [dashboard] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [dashboard] 선택적 모듈 초기화 실패 (스킵) 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [chart] 초기화 시작... 
utils.js:27 ❌ [chart] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [chart] 재시도 1/3... 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [chart] 초기화 시작... 
utils.js:27 ❌ [chart] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [chart] 재시도 2/3... 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [chart] 초기화 시작... 
utils.js:27 ❌ [chart] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [chart] 재시도 3/3... 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [chart] 초기화 시작... 
utils.js:27 ❌ [chart] 초기화 실패: Error: Module failed to become ready after initialization
    at ModuleInitializer.initializeModule (app.js:301:23)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.initializeModule (app.js:313:24)
    at async ModuleInitializer.performInitialization (app.js:218:32)
    at async HTMLDocument.<anonymous> (app.js:955:25)
error @ utils.js:27Understand this error
utils.js:22 ⚠️ [chart] 선택적 모듈 초기화 실패 (스킵) 
warn @ utils.js:22Understand this warning
utils.js:16 ℹ️ [app] 초기화 시작... 
utils.js:16 ℹ️ 메인 애플리케이션 초기화 시작... 
utils.js:16 ℹ️ MiyakojimaApp 초기화 시작... 
utils.js:16 ℹ️ MiyakojimaApp 초기화 완료 
utils.js:16 ℹ️ [app] 초기화 완료 ✓ 
utils.js:16 ℹ️ === 모듈 초기화 완료 (53640ms) === Object
utils.js:16 ℹ️ 모든 모듈 초기화 성공! 
utils.js:16 ℹ️ 로딩 화면 숨기기 및 메인 콘텐츠 표시 완료 
utils.js:16 ℹ️ 모듈 초기화 완료! Object
utils.js:16 ℹ️ MiyakojimaApp 시작... 
utils.js:16 ℹ️ MiyakojimaApp 초기화 시작... 
utils.js:16 ℹ️ MiyakojimaApp 초기화 완료 
utils.js:16 ℹ️ 로딩 화면 숨기기 및 메인 콘텐츠 표시 완료 
utils.js:16 ℹ️ ✅ 미야코지마 앱 완전 초기화 완료! 
utils.js:16 ℹ️ 빠른 액션 실행: scan-receipt 
utils.js:16 ℹ️ 영수증 스캔 시작 
utils.js:16 ℹ️ 토스트 표시: 📸 영수증 스캔 기능은 곧 출시됩니다! 
utils.js:16 ℹ️ 빠른 액션 실행: scan-receipt 
utils.js:16 ℹ️ 영수증 스캔 시작 
utils.js:16 ℹ️ 토스트 표시: 📸 영수증 스캔 기능은 곧 출시됩니다! 
utils.js:16 ℹ️ 빠른 액션 실행: add-expense 
utils.js:16 ℹ️ 모달 열림: expense 
utils.js:16 ℹ️ 빠른 액션 실행: add-expense 
utils.js:16 ℹ️ 모달 열림: expense 
utils.js:16 ℹ️ 빠른 액션 실행: nearby-pois 
utils.js:16 ℹ️ 주변 장소 검색 
utils.js:16 ℹ️ 토스트 표시: 📍 주변 장소를 검색중입니다... 
utils.js:16 ℹ️ 빠른 액션 실행: nearby-pois 
utils.js:16 ℹ️ 주변 장소 검색 
utils.js:16 ℹ️ 토스트 표시: 📍 주변 장소를 검색중입니다... 