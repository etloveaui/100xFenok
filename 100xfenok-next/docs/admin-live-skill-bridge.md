# Admin Live Skill Bridge

Purpose: let the Cloudflare-hosted Admin Live bench call local Mac mini search skills
without storing third-party search API keys in the Worker.

## Runtime Split

- Worker / 100x web app stores only:
  - `FENO_SKILL_BRIDGE_URL`
  - `FENO_SKILL_BRIDGE_TOKEN`
- Mac mini bridge stores the real provider keys:
  - `TAVILY_API_KEY`
  - `BRAVE_SEARCH_API_KEY`
  - `NAVER_CLIENT_ID`
  - `NAVER_CLIENT_SECRET`
  - `KAKAO_REST_API_KEY`

## Mac Mini Command

```bash
cd source/100xFenok/100xfenok-next
FENO_SKILL_BRIDGE_TOKEN=... npm run live:skill-bridge
```

Defaults:

- host: `127.0.0.1`
- port: `3577`
- endpoint for Worker: `https://<tunnel-host>/live-search`

The bridge loads environment files in this order without overwriting already-set
environment variables:

1. `FENO_SKILL_BRIDGE_ENV_FILE`
2. `.env.local`
3. `.env`
4. `~/.secrets/mcp-keys.env`

Set `FENO_SKILL_BRIDGE_SKIP_ENV_FILES=1` for hermetic tests that must not load
local secret files.

## Endpoints

- `GET /healthz`: unauthenticated liveness only.
- `GET /health`: bearer-token protected provider readiness and bridge metrics.
- `POST /live-search`: bearer-token protected search bridge.

Request body:

```json
{
  "tool": "feno-search",
  "query": "NVDA latest news",
  "provider": "auto",
  "maxResults": 5
}
```

Supported tools:

- `feno-search`: Tavily first, Brave fallback when `provider=auto`.
- `naver-search`: `web`, `news`, `blog`, `shop`, `image`, `local`, `book`, `kin`, `cafe`, `doc`, `encyc`.
- `kakao-search`: `web`, `blog`, `place`, `image`, `vclip`, `book`, `cafe`.

## Local Verification

```bash
npm run test:live-bridge
npm run test:live-provider-boundary
npm run test:live-tool-registry
npm run test:live-skill-bridge
npm run probe:live-skill-bridge
```

`test:live-bridge` runs all three focused guards together and is wired into the
Worker deploy workflow before the Cloudflare build step.

The provider-boundary smoke fails if third-party provider key env names appear in
Worker-side app/config files. The Worker may know only the bridge URL and bridge
token.

The registry smoke validates the env gate: without both Worker-side bridge envs,
search tools stay pending and emit no Gemini declarations; with both envs,
`searchFenoWeb`, `searchNaverWeb`, and `searchKakaoWeb` become available.

The bridge smoke starts a local mock provider server and validates the full bridge HTTP path
for auth, health, feno-search Tavily/Brave shape, Naver shape, and Kakao/Daum
web/place shape. It also checks trailing-slash tolerance, invalid JSON handling,
and bearer-protected bridge metrics. It does not use real provider keys or
network calls.

Provider endpoint overrides exist only to make this testable without spending
quota:

- `FENO_SKILL_BRIDGE_TAVILY_URL`
- `FENO_SKILL_BRIDGE_BRAVE_URL`
- `FENO_SKILL_BRIDGE_NAVER_BASE`
- `FENO_SKILL_BRIDGE_KAKAO_SEARCH_BASE`
- `FENO_SKILL_BRIDGE_KAKAO_LOCAL_KEYWORD_URL`
- `FENO_SKILL_BRIDGE_KAKAO_BOOK_URL`

## Live Provider Probe

The provider probe is approval-gated because it calls real provider APIs through
the bridge and spends quota. Without `--live`, it prints the planned checks only:

```bash
npm run probe:live-skill-bridge
```

After explicit approval and after the bridge is running with real provider keys:

```bash
FENO_SKILL_BRIDGE_URL=http://127.0.0.1:3577/live-search \
FENO_SKILL_BRIDGE_TOKEN=... \
npm run probe:live-skill-bridge -- --live
```

Use `--live --full` only when the broader provider matrix is needed. The full
probe additionally checks Brave, Tavily, Naver cafe, Kakao place, and Kakao
book.

## Deployment Gate

Do not expose the bridge without a private Cloudflare Tunnel route and a strong
`FENO_SKILL_BRIDGE_TOKEN`. The Worker must point to the tunnel URL, not to a raw
local address.

## Cutover Checklist

Run these only after explicit approval, because they touch secrets, external
network exposure, or production deploy state.

1. Generate a strong random `FENO_SKILL_BRIDGE_TOKEN`.
2. Start the Mac mini bridge on localhost:

   ```bash
   cd source/100xFenok/100xfenok-next
   FENO_SKILL_BRIDGE_TOKEN=... npm run live:skill-bridge
   ```

3. Expose only this localhost service through a Cloudflare Tunnel route:

   ```text
   https://<private-tunnel-host>/live-search -> http://127.0.0.1:3577/live-search
   ```

4. Set Worker-side secrets/env through the active Cloudflare deployment surface:

   ```bash
   printf '%s' 'https://<private-tunnel-host>/live-search' | npx wrangler secret put FENO_SKILL_BRIDGE_URL
   printf '%s' '<same-strong-token>' | npx wrangler secret put FENO_SKILL_BRIDGE_TOKEN
   ```

5. Deploy the Worker through the normal guarded flow.
6. Run the live provider probe from the Mac mini bridge surface:

   ```bash
   FENO_SKILL_BRIDGE_URL=https://<private-tunnel-host>/live-search \
   FENO_SKILL_BRIDGE_TOKEN=<same-strong-token> \
   npm run probe:live-skill-bridge -- --live
   ```

7. Verify `/admin/live` registry:
   - `feno-data`: available
   - `feno-search`: available
   - `naver-search`: available
   - `kakao-search`: available
   - `google-search`: locked
8. Run one live Gemini tool-call smoke per enabled tool:
   - `getFenoTickerContext`
   - `searchFenoWeb`
   - `searchNaverWeb`
   - `searchKakaoWeb`

Never commit provider keys, bridge tokens, tunnel credentials, or local
supervision files containing secrets.
