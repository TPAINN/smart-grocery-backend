# Memory

> Chronological action log. Hooks and AI append to this file automatically.
> Old sessions are consolidated by the daemon weekly.

| 04:50 | Fixed MyMarket scraper: card=article.product--teaser, price via GA data attr, name/img updated | services/scraper.js | done | ~200 |

| 12:50 | Fixed 8 market scrapers STORE_CONFIGS (Masoutis card/price, Galaxias Angular element, img selectors for 5 markets) + Masoutis special-case price extraction | services/scraper.js | SUCCESS | ~400 |
| 12:51 | Fixed mealplan 500 error: added ANTHROPIC_API_KEY to key check, Claude max_tokens 8096->16000, goalMap aliases | routes/mealplan.js,services/aiService.js | SUCCESS | ~200 |
| 12:52 | Added 20 missing Greek translations to MEAL_NAMES_GR (Italian+Asian dishes) | routes/meals.js | SUCCESS | ~150 |
| 03:00 | Created daily scraper scheduled task (03:00 nightly, node runAll.js) | C:/Users/Admin/.claude/scheduled-tasks/smart-grocery-daily-scraper/SKILL.md | created | ~100 |
| 04:45 | Created Render cron job: renderRunAll.js + render.yaml (01:00 UTC daily, frankfurt, starter plan, 3 workers) | renderRunAll.js, render.yaml, .gitignore, package.json | commit 9ce39b8, pushed | ~400 |
| 00:00 | Fixed search 'ξύδι'→no results: greekUpsilonFold υ→ι in expandQuery; PET_MARKERS add γατοτρ/σκυλοτρ; score filter >10 | routes/prices.js | SUCCESS | ~200 |
| 00:00 | Removed false-positive setIsServerWaking from status poll; now only recipe fetch sets it | src/App.jsx | SUCCESS | ~100 |
| 00:00 | Removed blue outline on search bar: outline: none !important on :focus-visible | src/App.css | SUCCESS | ~80 |
| 00:00 | Improved platescanner SYSTEM_PROMPT: Greek food reference values, macro math formula, reconcile tolerance 28%→15% | routes/platescanner.js | SUCCESS | ~300 |
| 12:52 | Fixed GymBeam critical bug (wrong return var names) + strengthened noise filter | services/webRecipeScraper.js | SUCCESS | ~300 |
| 17:00 | platescanner.js v2: added healthScore, vitamins, sugar, /analyze-text, clarifying questions | routes/platescanner.js | done | ~2500 |
| 16:09 | Fixed Lidl scraper (data-grid-data JSON attr + imageList/image/cutoutimageV2), fixed AB (AB_URLS constant), fixed Galaxias img, reduced Render concurrency to 3 for 512MB RAM, added dateScraped to upserts, added debug-scrape endpoint | services/scraper.js, server.js | pushed fc54fb7..394ecd2 | ~8k tokens |
