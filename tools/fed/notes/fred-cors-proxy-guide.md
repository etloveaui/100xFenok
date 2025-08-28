# FRED CORS 프록시 가이드 (GitHub Pages/프리뷰 대응)

작성일: 2025-08-28

## 왜 필요한가
- GitHub Pages(https://etloveaui.github.io)에서 FRED API(`api.stlouisfed.org`)를 직접 호출하면 CORS로 차단됩니다.
- 위젯/상세 페이지가 브라우저에서 직접 FRED를 요청하기 때문에, 공개 환경에서는 프록시를 통해 우회가 필요합니다.

## 현재 위젯 동작 요약
- 파일: `tools/fed/fed-monitor-widget.html`
- 프록시 소스 우선순위:
  1) 사용자 설정 프록시: `window.FRED_PROXY_URL` 또는 `localStorage.FRED_PROXY_URL`
  2) 공용 프록시 폴백: `cors.isomorphic-git.org`, `api.allorigins.win`, `thingproxy.freeboard.io` (공용은 가용성 변동이 큼)
  3) 로컬 환경(127.0.0.1/localhost)에서는 개발용 프록시 사용: `scripts/dev/fred-proxy.js`
- API 키: `window.FRED_API_KEY` 또는 `localStorage.FRED_API_KEY` → 없으면 코드 기본값 사용(민감 비밀 아님, 사용량 제한 유의)

## 가장 빠른 사용법(코드 수정 없음)
브라우저 콘솔에서 1회 설정하면, 이후 위젯이 자동으로 해당 프록시를 사용합니다.

1) 프리픽스형(권장)
```
localStorage.setItem('FRED_PROXY_URL','https://<your-worker>.workers.dev')
```

2) 경로형(프록시가 `/fred/series/observations?...` 경로를 그대로 포워딩한다면)
```
localStorage.setItem('FRED_PROXY_URL','https://<your-worker>.workers.dev/fred/series/observations')
```

확인/해제:
```
localStorage.getItem('FRED_PROXY_URL')
localStorage.removeItem('FRED_PROXY_URL')
```

테스트(캐시 무력화):
- 위젯 단독 열기: `https://etloveaui.github.io/100xFenok/tools/fed/fed-monitor-widget.html?v=now`
- 값이 숫자로 보이면 정상(“--”는 데이터 미수신 상태)

## Cloudflare Worker 전용 프록시 배포(권장)
1) Cloudflare Dashboard → Workers → Create Worker
2) 아래 코드 전체 붙여 배포(두 모드 지원: 프리픽스형/경로형). CORS 허용 포함.

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    try {
      let target;
      // 경로형: /fred/series/observations?...
      if (url.pathname.startsWith('/fred/')) {
        target = new URL('https://api.stlouisfed.org' + url.pathname + url.search);
      // 프리픽스형: /https://api.stlouisfed.org/fred/series/observations?...
      } else if (url.pathname.startsWith('/https:/') || url.pathname.startsWith('/http:/')) {
        target = new URL(url.pathname.slice(1) + url.search);
      } else {
        return new Response(JSON.stringify({ error: 'not-found' }), {
          status: 404,
          headers: { 'content-type': 'application/json', ...cors },
        });
      }
      const res = await fetch(target.toString(), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'cf-fred-proxy/1.0' },
      });
      const body = await res.arrayBuffer();
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      headers.set('content-type', res.headers.get('content-type') || 'application/json');
      return new Response(body, { status: res.status, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'proxy-failed', detail: e.message }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...cors },
      });
    }
  }
}
```

3) 콘솔에서 프록시 URL 지정(둘 중 택1)
```
localStorage.setItem('FRED_PROXY_URL','https://<your-worker>.workers.dev')
// 또는
localStorage.setItem('FRED_PROXY_URL','https://<your-worker>.workers.dev/fred/series/observations')
```

## 테스트 체크리스트
- 위젯 단독 페이지에 `?v=timestamp`를 붙여 강제 갱신
- 브라우저 DevTools → Network에서 `fred/series/observations` 응답 200 확인
- UI에 IORB/EFFR/SOFR 숫자, RRP(B) 표기 확인
- bp 표기는 Δ×100 정수, 화살표는 HTML 엔티티(↑↓→)로 표시

## 자주 묻는 문제(FAQ)
- Q. 공용 프록시로는 왜 안 되나요?
  - A. 공용 프록시는 종종 차단되거나 응답이 불안정합니다. 개인 워커 프록시를 권장합니다.

- Q. 값이 계속 “--”로 보입니다.
  - A. 네트워크 실패(프록시 미설정/차단), 또는 FRED 최신값이 결측(".")일 때입니다. 위젯은 결측을 스킵하고 숫자 2개만 골라 표시하도록 보강되어 있습니다. 네트워크 경로부터 점검하세요.

- Q. 어디에 프록시 주소를 넣나요?
  - A. 콘솔에서 `localStorage.FRED_PROXY_URL`로 저장합니다. 코드 수정 없이 페이지가 자동 인식합니다.

## 로컬 개발 프록시(개발 전용)
- 파일: `scripts/dev/fred-proxy.js`
- 실행: `node scripts/dev/fred-proxy.js` → `http://127.0.0.1:8787`
- 로컬 호스트(127.0.0.1/localhost)일 때는 자동으로 이 프록시를 사용하게 구성되어 있습니다.

## 부록: 위젯의 프록시 처리 규칙(요약)
- 우선 `window.FRED_PROXY_URL` → `localStorage.FRED_PROXY_URL` → 공용 프록시 순으로 시도
- 프리픽스형과 경로형 프로토콜 모두 지원
- GitHub Pages/Vercel/Netlify 도메인에서는 직접 호출 대신 프록시 우회 경로를 먼저 시도

## 참고 파일
- 위젯: `tools/fed/fed-monitor-widget.html`
- 상세 페이지(유사 원리 적용 가능): `tools/fed/fed-rates-detail.html`
- 로컬 프록시: `scripts/dev/fred-proxy.js`
- 기타 자산 프록시 예시: `tools/asset/config.js` (STOOQ_PROXY)

