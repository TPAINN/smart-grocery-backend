# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-12

## User Preferences

- User wants parallel agent execution for multi-file fixes
- User wants Greek language in UI/error messages
- User wants scraper fixes verified with Firecrawl before applying

## Key Learnings

- **Search normalization**: Greek υ (upsilon) and ι (iota) are different Unicode code points but sound identical in modern Greek. After NFD diacritic strip, "ξύδι"→"ξυδι" but "ξίδι"→"ξιδι" — different strings. Fix: greekUpsilonFold() maps υ→ι to generate a second search variant.
- **PET_MARKERS**: The regex needs `γατοτρ` and `σκυλοτρ` to catch compound words like "γατοτροφή". The `(^|\s)γατα` pattern doesn't match compound words starting with "γατο".
- **ServerStatusBar**: Only show during initial recipe fetch (wakeTimer). Status polling setIsServerWaking() causes false-positive banner every 15s — never call it from checkStatus().
- **Search score threshold**: `> 5` passes too many low-relevance results. `> 10` better cutoff that still preserves all genuine matches.
- **platescanner reconcileTotal**: 28% tolerance was too loose. 15% forces computed totals (protein×4 + carbs×4 + fat×9) when AI total diverges.
- **Project:** grocery-backend (Express.js + Puppeteer + MongoDB)
- **Galaxias**: Uses Angular SSR → products are `<product-card>` custom elements. CSS selector `product-card` (no dot) selects custom element by tag. `.product-card` (with dot) selects class which DOESN'T EXIST.
- **Masoutis**: Products use `.product` card (not `.product-item`). Price structure: `.pStartPrice` = original/regular price, `.pDscntPrice` = discounted sale price. Need special-case extraction logic for sale items.
- **AI Meal Plan**: callClaude max_tokens 8096 is too small for 7-day plans. Use 16000+ tokens.
- **mealplan.js**: Early API key check must include ANTHROPIC_API_KEY alongside Gemini/Groq/Bytez.
- **GymBeam scraper**: `parseGymBeamRecipe` had a critical bug — returned undefined variable names (cleanIngredients/cleanInstructions from another function scope). Always return `ingredients` and `instructions`.
- **GymBeam noise**: Product promo lines end with " - GymBeam" suffix. Browser-side filter must use `sLower.includes('gymbeam')` not just prefix matching.
- **TheMealDB translation**: Uses static MEAL_NAMES_GR dict → AI batch → MyMemory fallback. Italian dish names (Alfredo, Carbonara variants) and Asian dishes often missing from dict.
- **callAIText** is separate from **callAI** — used for translation tasks (returns plain text, not JSON).

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

[2026-04-16] Do NOT use CSS class selector `.product-card` for Galaxias — use tag selector `product-card` (Angular custom element)
[2026-04-16] Do NOT use `.product-item` for Masoutis card — use `.product`
[2026-04-16] Do NOT forget ANTHROPIC_API_KEY when checking if any AI provider is available
[2026-04-16] Do NOT use 8096 max_tokens for Claude when generating full meal plans — use 16000
[2026-04-16] Do NOT return cleanIngredients/cleanInstructions from parseGymBeamRecipe — use ingredients/instructions
[2026-04-17] Do NOT call setIsServerWaking() from checkStatus() poll — only use it in the recipe fetch wakeTimer
[2026-04-17] Do NOT forget greekUpsilonFold when building search variants — υ and ι are both needed for Greek search
[2026-04-17] Do NOT use score filter > 5 for search — use > 10 to cut low-penalty pet/flavor-only results

## Decision Log

[2026-04-16] Increased Claude max_tokens from 8096 to 16000 for meal plan generation — 7-day plans with alt meals exceed 8096 token output budget
[2026-04-16] Added goalMap aliases (maintain, loss, mild, extreme) to mealplan.js — frontend sends these values but backend only had 'balanced', 'weightloss', 'muscle', 'budget'
[2026-04-16] Used Puppeteer's page.evaluate serialization to pass `storeName` param into browser context for Masoutis special-case price logic
