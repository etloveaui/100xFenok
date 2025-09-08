Service Worker installing
sw.js:39 Caching static files
sw.js:43 Data cache ready
sw.js:51 Service Worker install failed: TypeError: Failed to execute 'addAll' on 'Cache': Request failed
(anonymous)	@	sw.js:51
sw.js:58 Service Worker activating
sw.js:78 Service Worker activated successfully
utils.js:16 ℹ️ API 연동 모듈 로드 완료 
utils.js:16 ℹ️ 예산 추적 모듈 로드 완료 
utils.js:16 ℹ️ GPS 위치 추적 모듈 로드 완료 
utils.js:16 ℹ️ POI 관리 및 추천 모듈 로드 완료 
utils.js:16 ℹ️ DOM 로드 완료, 모듈 초기화 시작 
utils.js:16 ℹ️ 모듈 등록됨: config 
utils.js:16 ℹ️ 모듈 등록됨: utils 
utils.js:16 ℹ️ 모듈 등록됨: storage 
utils.js:16 ℹ️ 모듈 등록됨: api 
utils.js:16 ℹ️ 모듈 등록됨: budget 
utils.js:16 ℹ️ 모듈 등록됨: location 
utils.js:16 ℹ️ 모듈 등록됨: poi 
utils.js:16 ℹ️ 모듈 등록됨: itinerary 
utils.js:16 ℹ️ 모듈 등록됨: app 
utils.js:16 ℹ️ 모듈 초기화 순서 계산 완료: 
Array(9)
utils.js:16 ℹ️ === 미야코지마 앱 모듈 초기화 시작 === 
utils.js:16 ℹ️ [config] 초기화 시작... 
index.html:340 SW registered:  
ServiceWorkerRegistration
manifest.json:1 Manifest: Enctype should be set to either application/x-www-form-urlencoded or multipart/form-data. It currently defaults to application/x-www-form-urlencoded
favicon.ico:1 
 Failed to load resource: the server responded with a status of 404 (Not Found)
index.html:1 <meta name="apple-mobile-web-app-capable" content="yes"> is deprecated. Please include <meta name="mobile-web-app-capable" content="yes">
utils.js:22 ⚠️ [config] 초기화 재시도 (1/3) 
utils.js:16 ℹ️ [config] 초기화 시작... 
utils.js:22 ⚠️ [config] 초기화 재시도 (2/3) 
utils.js:16 ℹ️ [config] 초기화 시작... 
utils.js:22 ⚠️ [config] 초기화 재시도 (3/3) 
utils.js:16 ℹ️ [config] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: config Error: [config] 초기화 최종 실패: 초기화 타임아웃
    at ModuleInitializer.initializeModule (app.js:188:27)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [utils] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: utils Error: 누락된 의존성: config
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [storage] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: storage Error: 누락된 의존성: config, utils
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [api] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: api Error: 누락된 의존성: config, storage
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [budget] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: budget Error: 누락된 의존성: config, storage
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [location] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: location Error: 누락된 의존성: config
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [poi] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: poi Error: 누락된 의존성: config, location
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [itinerary] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: itinerary Error: 누락된 의존성: config, storage, api, poi
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
utils.js:16 ℹ️ [app] 초기화 시작... 
utils.js:27 ❌ 모듈 초기화 실패: app Error: 누락된 의존성: config, utils, storage, itinerary
    at ModuleInitializer.initializeModule (app.js:162:19)
    at async ModuleInitializer.initializeAll (app.js:116:21)
    at async HTMLDocument.<anonymous> (app.js:535:24)
error	@	utils.js:27
initializeAll	@	app.js:121
setTimeout		
(anonymous)	@	app.js:199
performInitialization	@	app.js:198
initializeModule	@	app.js:167
await in initializeModule		
initializeModule	@	app.js:182
utils.js:16 ℹ️ === 모듈 초기화 완료 (49542ms) === 
{total: 9, succeeded: 0, failed: 9, skipped: 0, errors: Array(9)}
utils.js:22 ⚠️ 일부 모듈 초기화 실패. 성공: 0/9 
warn	@	utils.js:22
initializeAll	@	app.js:133
setTimeout		
(anonymous)	@	app.js:199
performInitialization	@	app.js:198
initializeModule	@	app.js:167
await in initializeModule		
initializeModule	@	app.js:182

