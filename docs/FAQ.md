# Frequently Asked Questions


## Why do we call `https://lm-api-reads.fantasy.espn.com` instead of the old `fantasy.espn.com/apis/v3` host?

ESPN silently migrated its Fantasy front‑end to the **“League‑Manager API”** (`lm-api-reads`) in 2023‑24.  
The old `fantasy.espn.com/apis/v3` host still resolves but increasingly returns 403s or HTML when you request private‑league data.  
Every working open‑source scraper in 2024‑25—whether written in Node, R, Go, or a Cloudflare Worker—has already switched to the new host.

### Minimum headers required
```text
Cookie: SWID={uuid}; espn_s2={token}
Accept: application/json
X-Fantasy-Source: kona
X-Fantasy-Platform: kona-web-2.0.0
```
* **`SWID` / `espn_s2`** – user‑specific cookies pasted once, stored encrypted in KV.  
* **Kona headers** – ESPN’s edge looks for these to decide JSON vs HTML.

### Implementation cheat‑sheet
1. **Build URL**  
   `https://lm-api-reads.fantasy.espn.com/apis/v3/games/{sport}/seasons/{year}/segments/0/leagues/{leagueId}?view=mSettings`
2. **Inject headers/cookies** in a Cloudflare Worker (see `shared/espnFetch.ts` for real code).  
3. Expect **JSON** when cookies are valid; surface any non‑JSON upstream response back to the UI.

### Proof it works (non‑Python repos & threads)
* `espn-fantasy-football-api` (Node) – switched host & headers in Oct 2024.  
* `ffscrapr` / `hoopR` (R) – vignettes updated Feb 2023.  
* GitHub issue #539 in `espn-api` – 403 fixed by changing host.  
* Steven Morse blog *“Using ESPN’s new Fantasy API (v3)”* – Apr 2024.  
* Multiple Reddit threads (`r/fantasyfootballcoding`, `r/fantasybaseball`) confirm the same fix.

_Future Devs_: **Do not** hit the legacy host unless you enjoy HTML payloads and sporadic 429s.

