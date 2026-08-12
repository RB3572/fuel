# Handoff — Fuel

Written by an AI agent (Claude) at the end of a working session, for whichever agent
picks this project up next on a new machine. This is not user-facing documentation —
`README.md` and `HEALTH_SYNC.md` already cover setup and the health-sync protocol.
This file is about *how the codebase actually works underneath*, the conventions the
existing code follows, and the reasoning behind recent changes, so you don't have to
re-derive it all by reading every file cold.

Read this fully before making changes. Sections are ordered roughly by how likely you
are to need them.

## 0. What this project is

Fuel is a personal athlete/nutrition dashboard: a React+Vite+TS web app, a Vercel
serverless API backed by Neon Postgres, and a native iOS app (two Xcode projects,
actually — see §6). It replaced an older "Google Sheet as database" design entirely;
Postgres via `@neondatabase/serverless` is now the only store. There is no other user
of this codebase — it's a single-user (or small-family) personal tool, not a product
with paying customers, which is why some things (no queue infra, no batch jobs,
everything computed live per-request) are simpler than you'd expect from the code
volume.

Read `README.md` first for environment variables and OAuth setup — it's accurate and
current. Read `HEALTH_SYNC.md` for the Apple Health sync protocol if you're touching
that. Neither duplicates what's below.

## 1. Machine/environment gotchas (if you're setting this up fresh)

This repo was moved from a Mac to Windows partway through its life. Two real problems
came from that, and may recur if it moves again:

1. **macOS AppleDouble junk (`._*` files).** A prior transfer left ~6000 of these
   scattered everywhere, including *inside* `.git/objects` and `.git/logs`, which
   actively corrupted git (`error: non-monotonic index .git/objects/pack/._pack-*.idx`
   on every command). If you see git acting up after a transfer, check for `._*` files
   first — `find . -name '._*'` — and delete them; they're always safe to delete.
2. **`node_modules` copied cross-platform is missing Windows shims.** `.bin/vite` had
   only the Unix shell script, no `vite.cmd`/`vite.ps1`, so `npm run dev` failed with
   `'vite' is not recognized`. Fix: `npm install` (not `ci`) regenerates the correct
   per-platform shims. Don't assume a committed lockfile install is enough after an
   OS change — reinstall.
3. **Node not on system PATH on this machine.** Only reachable at
   `C:\Program Files\nodejs\node.exe` (or `npm.cmd`, `npx.cmd` in the same dir). I did
   *not* fix this by editing the system PATH — that's a system-settings change I don't
   make even on request; the user was told to run this themselves if they want it
   fixed globally:
   ```powershell
   [Environment]::SetEnvironmentVariable('Path', $env:Path + ';C:\Program Files\nodejs', 'User')
   ```
   Until/unless that's done, every shell invocation in this session prefixed `PATH`
   manually, e.g. `export PATH="/c/Program Files/nodejs:$PATH"` in Bash, or called the
   binary by full path directly (`"/c/Program Files/nodejs/node.exe" --test ...`).
4. **`.claude/launch.json`** (used by the Browser-preview tool to start the dev
   server) had to be pointed at `node.exe` directly rather than `npm.cmd`, because
   `vite.cmd`'s own shim internally invokes a bare `node` that isn't resolvable in
   that tool's spawn environment:
   ```json
   {
     "name": "dev",
     "runtimeExecutable": "C:\\Program Files\\nodejs\\node.exe",
     "runtimeArgs": ["node_modules/vite/bin/vite.js"],
     "port": 5173,
     "autoPort": true
   }
   ```
   If port 5173 is taken (another session's dev server), `autoPort: true` lets the
   tool reassign one — don't hardcode a fallback port.
5. **The Browser-preview pane can get stuck** ("Policy check in progress for this
   tab", or a started server vanishing from `preview_list` between calls). If that
   happens, opening a fresh tab (`tabs_create`) and retrying usually clears it; it's a
   tooling flakiness, not a code problem. Don't burn much time on it — static
   verification (`node --check`, `tsc --noEmit`, the test suite, `oxlint`) is the
   reliable fallback and is what most of this session's verification actually rested
   on. When a live check *did* work, it was done by injecting DOM state via
   `javascript_tool` and reading `read_page`/`read_console_messages` rather than
   trusting screenshots — screenshots in this environment require the pane to be
   actively displayed and time out otherwise.

## 2. Code style — read this before writing a single line

The existing code is **extremely** terse and dense: no semicolons, minimal
whitespace, short-circuit chains, one-line function bodies packed onto a single
physical line, arrow functions everywhere, `?.`/`??` used aggressively. This is
consistent across `api/`, `public/*.js`, and to a lesser extent `src/App.tsx`. **Match
it.** Don't reformat existing code to be "more readable" by your own preferences, and
don't write new code in a noticeably different style from what surrounds it — a
sudden shift in formatting inside one file reads as a diff you didn't mean to make.

Exceptions where slightly more breathing room is normal: multi-line SQL template
literals (`sql\`...\``), and genuinely complex conditional logic where a one-liner
would be unreadable even by this codebase's standards.

**Comments are sparse and purposeful.** When they exist, they explain *why*, not
*what* — a past incident, a non-obvious constraint, a browser/platform quirk, the
reason a retry exists. Good examples already in the codebase (read these to calibrate
tone):
- `api/_lib/meal-plan.js:9-24` — why the Gemini model fallback list is ordered the
  way it is (each entry is a *dead* model that used to be first, and why).
- `public/quicklog.js:39-44` — why a bare `"Script error."` is treated specially.
- `api/_lib/daily-history.js:71-77` — why saving a history edit also clears
  `partial_day`.

Never write a comment that just restates the line under it. Never leave a comment
explaining what *this specific bug fix* changed relative to before ("changed to X
because it used to do Y") — that belongs in the commit message, not the code; a
comment should make sense to someone who never saw the old version.

**No dead code, no speculative abstraction.** This codebase does not have
feature-flag scaffolding, unused parameters "for future use," or defensive fallbacks
for cases that can't happen given the calling code. If you remove a code path, remove
everything that only existed to serve it (see §4.2 for a concrete example of doing
this correctly).

## 3. Testing convention — important, easy to get wrong

Run tests with:
```bash
npm test
# or directly:
node --test test/*.test.js
```

**There is no live database in this test suite**, despite comments in a couple of
test files (`test/health-sync.test.js`, `test/ios-app.test.js`) that mention "the
PGlite harness" — that harness is aspirational/external, not present in this repo.
`pglite` isn't even in `package.json`. Don't go looking for it, and don't assume
comments referencing it mean there's a real integration-test path you're missing.

**The actual pattern, used across all ~19 test files, is static source inspection:**
read the relevant source file(s) as text with `readFileSync`, then assert with
`assert.match`/`assert.doesNotMatch`/`assert.equal` against regexes or exact
substrings of the *implementation itself*. E.g.:
```js
const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
assert.match(mealPlan, /const restingCaloriesFloor = goals\.restingCaloriesFloor > 0 \? goals\.restingCaloriesFloor : null/)
```
This means tests are tightly coupled to exact source text, not behavior through a
real interpreter/DB. **When you refactor code that an existing test regex matches,
you must update the test's regex to match the new text** — the test isn't "wrong,"
it's pinning an invariant, and the pin needs to move with the code. This bit me once
this session: extracting `Boolean(health?.partial_day)` into a `partialDay` variable
broke a test that regex-matched the old inline expression; I fixed the regex rather
than reverting the refactor, since the invariant it was protecting (partial days
excluded from the deficit chart) was still true. When you do this, add both the
"still true after refactor" assertion *and*, if useful, a positive assertion that
would catch the invariant actually breaking (not just the text changing) — see
`test/daily-history.test.js`'s "the deficit chart still suppresses days that are
genuinely in progress" test for the pattern.

A few tests *do* call real exported functions with constructed input (not just regex
on source) — e.g. `test/energy-goals-ai.test.js`'s test for `responseText()`
filtering `thought:true` parts, or `calculateCalorieTarget()`. Prefer this style over
pure regex-matching when the function is pure and cheap to call directly; it actually
exercises the logic instead of just pinning its shape. Regex-on-source is the
fallback for anything that needs a real Postgres connection, a real Gemini call, or a
Swift compiler — none of which exist in this test environment.

**iOS files are tested the same way** — `test/ios-app.test.js` reads `.swift` files
as text and regex-matches them. There is **no way to actually compile or run the iOS
app from this environment** (Xcode is Mac-only, this machine is Windows). Every iOS
change this session was verified by careful manual re-reading only — no compiler ever
checked it. Be extra careful with Swift edits: check call sites by hand (`grep`) after
changing a function signature, check optional/non-optional types line up, and don't
trust that "it looks right" is equivalent to "it compiles." If the next session is
back on a Mac, actually building `ios/Fuel` once to catch anything this session missed
would be a good first move.

**Before finishing any change, run in this order:**
1. `node --check <file>` per changed `.js` file (syntax only, fast) — full paths
   needed if Node isn't on PATH, e.g.
   `"/c/Program Files/nodejs/node.exe" --check api/_lib/meal-plan.js`.
2. `node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` for any `.tsx`/`.ts`
   change (there's no `tsc.cmd` shim reliably on Windows — invoke via
   `node node_modules/typescript/bin/tsc` rather than `npx tsc`).
3. `node --test test/*.test.js` — full suite, every time, even for a change that
   looks unrelated to existing tests. It's fast (~1-1.5s for 165 tests) and cheap
   insurance.
4. `node_modules/.bin/oxlint.cmd <files>` (PowerShell) or the `.bin/oxlint` shell
   script (Bash) — warnings are fine to leave if pre-existing and unrelated to your
   change (there are a handful of long-standing `no-unused-vars`/`no-useless-escape`
   warnings in `api/_lib/meal-plan.js` and `public/meal-plan.js` that predate this
   session); don't introduce *new* ones.

**Add a new test for every behavioral change**, in the same file as related existing
tests where one exists (e.g. meal-plan chat behavior → `test/energy-goals-ai.test.js`,
history editing → `test/daily-history.test.js`), or a new file named after the feature
if nothing existing fits (e.g. `test/resting-calories-floor.test.js`). Write the test
*after* the implementation is stable, asserting the specific invariant you just
built or fixed — not a vague "it has this function" check.

## 4. Architecture facts that took real digging to establish

These are things that weren't obvious from file names alone and cost real
investigation time this session. Saving you that time is most of the point of this
document.

### 4.1 There is no batch job, no cron, no "day finalized" step anywhere

Every dashboard load recomputes everything live from raw rows
(`api/_lib/neon-dashboard.js`'s `getNeonDashboard`) — 30 days of `health_daily`,
`food_entries`, `supplements`, plus a fresh `getUserGoals` call, on every single
request, no caching layer server-side. `trends[]` (the chart data) is rebuilt from
scratch every time, not read from a precomputed table. If you're tempted to add a
"finalize the day" cron job for some new feature, know that nothing else in this
codebase does that, and the existing convention for "is this day done?" is the
`partial_day` boolean on `health_daily` (set by the HealthKit sync client, cleared to
`false` by any manual edit via `daily-history.js`'s `saveDailyHistory` — see
`api/_lib/daily-history.js:71-77`'s comment for exactly why). Reuse that flag as your
"day is over" signal rather than inventing date-comparison logic — see
`api/_lib/neon-dashboard.js`'s `applyRestingFloor()` for a recent example that gates
strictly on `partialDay`, not on `date < today`.

### 4.2 `total_expenditure_kcal` is (usually) `active + resting`, not independent

When the iOS HealthKit sync sends a day's totals and doesn't have an explicit "Total
Energy" figure, the server derives it:
`api/_lib/health-sync.js`'s `normalizeDailyTotal()`:
```js
totalExpenditure: finite(raw?.totalExpenditure) ?? (activeEnergy != null && restingEnergy != null ? activeEnergy + restingEnergy : null)
```
This matters any time you adjust resting or active energy for a day — if you bump one
without carrying the same delta into total, the deficit/surplus calculations (which
read `total_expenditure_kcal` directly, not `active + resting` recomputed) will
silently disagree with the number you meant to fix. This is exactly the shape of bug
this session fixed twice: once in `energy-reference.js`'s historical averages, once in
`neon-dashboard.js`'s live trends/summary. If you add another feature that corrects
resting or active energy, carry the delta into total the same way
`applyRestingFloor()` does.

### 4.3 Two parallel "consumed calories" paths, deliberately

Calories consumed for a day is **not** a stored column — it's normally the live sum
of `food_entries` for that date. But a manual history edit needs to be able to
override it without touching the underlying food log (editing "how many calories I
ate" shouldn't delete or rewrite individual food entries). So there's a second,
optional column, `health_daily.calories_consumed_override`, and the convention
**everywhere that reads a day's consumed calories** is:
```js
number(health?.calories_consumed_override) ?? (foodEntriesSum || null)
```
This exact pattern appears in `neon-dashboard.js` (twice — trends and today), and as
of this session, also in `energy-reference.js`'s historical-average SQL (it didn't
before — that was the actual root cause of "editing history doesn't move the average"
reported and fixed this session). **If you add a third place that reads consumed
calories, you must apply this same override-preference pattern, or you'll reintroduce
exactly that bug in a new spot.** Grep for `calories_consumed_override` before adding
any new consumed-calories read path, and check every existing usage stays consistent.

### 4.4 The Gemini "thinking parts" gotcha — read this before touching any Gemini call

Gemini 3.x models are "thinking" models: they can emit their internal reasoning as
extra `parts[]` entries in the response, flagged `thought: true`, interleaved with (or
before) the actual answer text. **Naively concatenating `parts.map(p => p.text)`
produces a string with the reasoning glued onto the front of the real JSON, which
fails to parse.** This has now been the root cause of two separate user-facing bugs in
this codebase's history: once for quick-log's photo parsing (fixed in commit
`01b782e`, "Read the answer out of a thinking model's response, not its reasoning"),
and once — because the *first* fix was never propagated to the other two call sites —
for the chat/meal-plan JSON parsing (fixed this session). **The correct, only, way to
read text out of a Gemini candidate anywhere in this codebase is the shared
`responseText(payload)` helper in `api/_lib/meal-plan.js`:**
```js
export function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.filter((part) => part?.thought !== true).map((part) => part?.text || '').join('').trim()
}
```
**If you ever see `candidate?.content?.parts?.map(...)` or similar raw concatenation
anywhere (a new file, a new function, code someone pasted from an old version), that
is a live bug waiting to reproduce this exact failure mode — fix it to call
`responseText()` instead.** I grepped for this pattern across `api/_lib/meal-plan.js`
this session and there should be zero raw occurrences left as of commit `50d03d6` —
verify that's still true before assuming a new symptom is something else. There's also
a regression test for this now: `test/energy-goals-ai.test.js`, "a thinking model's
reasoning is excluded before the chat/plan JSON is parsed."

Separately, disabling "thinking" outright (so it doesn't eat the output token budget
and truncate the JSON) is done via `generationConfig.thinkingConfig.thinkingBudget: 0`
for `gemini-2.5.x` models, or `generationConfig.thinkingLevel: 'minimal'` for
`gemini-3.x`+ (there's no true zero for 3.x). The `bodyForModel()`/`stripThinking()`
functions in `meal-plan.js` handle picking the right field per model family and
recovering if a model rejects the field entirely — read the comment block right above
`THINKING_BUDGET_FAMILY`/`THINKING_LEVEL_FAMILY` (`meal-plan.js` around line
648-664) before touching this; it's already handling a real, previously-hit failure
mode (a 400 from asking for less thinking the wrong way).

### 4.5 Chat/plan generation is now strictly manual-trigger-only — don't reintroduce automatic regeneration

Earlier in this project, meal plans regenerated automatically: on page load, whenever
food was logged (web chat, iOS camera/manual log), and via keyword-sniffing user
messages for phrases like "make me a new plan." All of that was **deliberately
removed** this session, on explicit user request, on both platforms:

- **Web** (`api/_lib/meal-plan.js`, `public/meal-plan.js`): the chat action
  (`action: 'chat'`) never regenerates the plan — it only replies and can log food /
  update context / update goals directly. The plan text is completely frozen until the
  user clicks "New plan" (`action: 'plan'`, always sent with `force: true` from the
  client). The client no longer auto-calls `generatePlan()` on load either — if there's
  no plan yet, the chat shell still opens (composer + New Plan button reachable) with
  a "No plan yet, tap New plan" status instead.
- **iOS** (`ios/Fuel/Sources/AppStore.swift`, `CoachView.swift`): `announceLogged()`
  (called after every food log) now only appends the "Logged X" message — it used to
  also call `OnDeviceAI.shared.planRestOfDay(...)` and append a plan message. That call
  moved to a new, separate `generateNewPlan()` method, wired to an explicit toolbar
  button in `CoachView` (SF Symbol `arrow.triangle.2.circlepath`, labeled "New plan").

**Both platforms also now enforce "only the single most recent plan is ever shown"**:
regenerating filters out any prior plan-marked message before appending the new one.
Web marks a message as a plan with `kind: 'plan'` on the JSON object stored in
`meal_plan_sessions.messages` (jsonb); iOS marks it with `ChatMessage.isPlan: Bool`.
**If you add any new code path that can produce a plan (a new UI entry point, an MCP
tool, whatever), it must (a) only fire on an explicit user action, never automatically
from a food-log or chat turn, and (b) filter out prior plan messages before appending
the new one, on both platforms if you touch both.** Search for `kind !== 'plan'`
(web) / `isPlan` (iOS) for the existing filter call sites to copy the pattern from.

The chat "stale plan, must regenerate first" gate (`plan_stale`, HTTP 409) was also
removed — chat is now always allowed regardless of whether the cached plan's food
fingerprint still matches current data, since the plan no longer silently refreshes
itself as a side effect of chatting. Don't reintroduce a blocking gate here without
re-deciding this tradeoff deliberately.

### 4.6 Chat messages are designed to survive the client disappearing

This was a deliberate feature added this session, not an accident of the request
model: `handleMealPlan`'s chat action in `api/_lib/meal-plan.js` **always persists the
reply to Postgres (`saveCachedPlan`) before it ever calls `sendJson`** to respond.
Because Vercel's Node.js serverless functions run to completion once invoked
regardless of whether the client's TCP connection is still open (this is standard
AWS Lambda behavior underneath — the invocation's lifecycle is the handler's own
returned promise, not the peer socket), a request that the client times out, or whose
tab gets closed, or whose phone gets locked mid-flight, still finishes and saves its
result server-side in the overwhelming majority of cases. **Do not add any code that
reads the response object's connection state (`res.writableEnded`, `req.aborted`,
etc.) to bail out early inside `handleMealPlan`** — that would break this property.
The client complements this with:
- `CHAT_REQUEST_TIMEOUT_MS = 58000` in `public/meal-plan.js` — deliberately just under
  Vercel's 60s function ceiling (`vercel.json`'s `functions.maxDuration`), so the
  client rarely aborts a request that was about to legitimately succeed.
- `keepalive: true` on the fetch, for text-only messages (not photos — the keepalive
  body-size limit, ~64KB, would just make an image upload fail outright).
- A `refreshConversation()` re-fetch on `visibilitychange` (tab foregrounded),
  `pageshow` with `event.persisted` (back-forward-cache restore), and `online` — so a
  reply that finished server-side while the tab was backgrounded/offline shows up
  without the user needing to manually reload.

If you touch `sendMessage()` in `public/meal-plan.js`, preserve this — it's not
incidental complexity, it's the actual fix for "the AI doesn't answer if I close the
tab," which was an explicit user complaint.

### 4.7 The Goals system is one table, and "ranged" fields vs. "off-by-default" fields are handled differently

`api/_lib/goals.js`'s `user_goals` table holds calorie/macro/activity targets *and* a
personal profile (height/weight/age/objective) *and*, as of this session, a
`resting_calories_floor`. Two different patterns coexist for two different kinds of
field:

- **Ranged goals with a sensible default** (protein, carbs, move, steps, etc.):
  handled uniformly by `sanitizeGoals()`'s `ranges` map — every key always has a
  value, missing input falls back to the current saved value, out-of-range input
  clamps. The client always sends the *entire* `GoalValues` object on every save (see
  `GoalsSetup` in `src/App.tsx` — it's a single form, not per-field diffing).
- **Off-by-default numeric settings** (currently just `resting_calories_floor`): `0`
  from the client means "disabled," stored as SQL `null` (not a literal `0`), and
  every downstream reader must treat `null`/`0` as "don't apply this." See
  `goals.js`: `const restingCaloriesFloor = goals.restingCaloriesFloor > 0 ? goals.restingCaloriesFloor : null`.
  If you add another optional/nullable numeric setting, follow this pattern rather
  than trying to force it into the ranged-defaults uniform loop — a real default value
  doesn't make sense for a feature that should be off for most users.

One more subtlety that caused a real (caught-before-shipping) bug this session:
`api/_lib/energy-reference.js`'s `getEnergyReference()` now reads
`user_goals.resting_calories_floor` directly in SQL. `getUserGoals()` (the normal
path) always calls `ensureGoalsTable()` first, so the column is guaranteed to exist.
**But `automaticallySetGoals()` used to call `getEnergyReference()` *before* its own
later `saveUserGoals()` call would have created the table** — a genuine "works for
existing users, breaks on a brand-new user's very first request" bug. Fixed by adding
an explicit `await ensureGoalsTable()` at the top of `automaticallySetGoals()`. If you
add a third caller of `getEnergyReference()` anywhere, check it has an
`ensureGoalsTable()` (or equivalent) guarantee upstream — it won't fail loudly in
development if you get this wrong, only intermittently in production for whichever
user hits the ungated path first.

Also: never `CROSS JOIN` (or plain `JOIN`) a per-user settings table into a query that
needs to return rows for users who might not have a settings row yet — that silently
zeroes the entire result set instead of just leaving the setting unset. Use a scalar
subquery (`(SELECT x FROM t WHERE user_id = $1)`) instead when the presence of a
settings row is optional. This is exactly what `energy-reference.js`'s
`completed_burn` CTE does now, on purpose, after an earlier draft of the same feature
used `CROSS JOIN` and would have broken every fresh user (caught via review before
committing — see `resting-calories-floor.test.js`'s explicit
`assert.doesNotMatch(reference, /CROSS JOIN/)` regression test).

## 5. Web app structure quick-reference

- `src/App.tsx` — the entire React dashboard. Single large file, not split into
  components-per-file. `TopNav`/`DashMenu` are the shared nav, duplicated (not
  componentized — see below) as raw HTML in the two standalone static pages.
- `public/meal-plan.html` + `public/meal-plan.js` + `public/meal-plan.css` — the
  "Fuel AI" chat/plan screen. **Not part of the React app** — a standalone vanilla-JS
  page, served statically, that happens to share the nav bar's visual design.
- `public/recipes.html` — same deal, standalone page.
- `public/quicklog.html` + `public/quicklog.js` — the camera-first "take a photo, log
  it, done" flow. Also standalone. Deliberately has almost no UI chrome — see its file
  header comment.
- **The shared nav bar is duplicated in three places**: the `TopNav` React component
  in `App.tsx`, and hand-written matching HTML in `meal-plan.html` and `recipes.html`.
  There's a comment in `App.tsx` right above `TopNav` acknowledging this
  ("`recipes.html`, `meal-plan.html` render the same markup so the bar never
  changes") — **if you add/remove a nav item, you must edit all three places**
  identically (icon SVG path, label, href). This bit the "quicklog has no way to be
  reached" bug this session — the nav simply never had an entry for it anywhere.
- `api/mlog.js` is a single dispatcher: it reads a `fuel_route` query param (set via
  `vercel.json` rewrites) and routes to the actual handler in `api/_lib/`. This is why
  you'll see `/api/meal-plan` in client code but `handleMealPlan` living in
  `api/_lib/meal-plan.js` and dispatched from `api/mlog.js`'s big if-chain — check
  `vercel.json`'s `rewrites` array to find where a given public path actually goes.

## 6. iOS structure quick-reference

Two separate Xcode projects, not one app with two targets:
- **`ios/Fuel`** — the main, actively-developed app. Camera-first food logging, an
  on-device AI "Coach" tab (Apple's `FoundationModels`/on-device LLM — no network call,
  no API key, nothing sent to any model provider; this is a hard architectural
  constraint checked by `test/ios-app.test.js`'s "the AI runs on device, not through
  Gemini" test, which asserts `OnDeviceAI.swift` never references
  `generativelanguage.googleapis.com` or imports `URLSession`), and a dashboard view
  that mirrors the website's (`AppStore.swift` is the shared observable store,
  `CoachView.swift` is the AI chat screen, `CameraLogView.swift` is the log tab).
- **`ios/HealthLogger`** — an older, narrower app: it just reads HealthKit and POSTs
  to `/api/health/sync/v1`. `ios/Fuel` now reads HealthKit itself too (see
  `AppStore.swift`'s header comment — "Health data does not arrive via Health Logger
  or a Shortcut: Fuel reads HealthKit itself... One app instead of two"), sharing the
  actual sync engine source files by path reference in `ios/Fuel/project.yml`
  (`../HealthLogger/Sources/SyncEngine.swift` etc. — not copied, genuinely shared via
  relative path in the Xcode project file), so a fix to sync logic in one location
  fixes both. Don't duplicate a HealthKit-sync fix into both trees — find the actual
  shared source file first.
- Sign-in: native Google OAuth (no client secret embedded — see
  `test/ios-app.test.js`'s "the iOS app signs in with PKCE and never stores a
  password" for the exact invariant checked) plus Apple Sign In, both verified
  server-side and matched to the same account by email.
- `Info.plist` has an explicit encryption-export-compliance exemption declared (see
  the commit "Declare the encryption exemption in Info.plist") — don't remove it
  without knowing why it's there (App Store submission requirement).

## 7. Recent session history (chronological, this machine)

For context on *why* things are the shape they are right now, in order:

1. **Workspace get-acquainted + git corruption cleanup.** Found and removed ~6000
   macOS AppleDouble junk files (see §1).
2. **Quick log had no UI entry point** (the page/API worked fine in isolation, but
   nothing linked to it) + **"Fuel AI returns 'Unable to answer that message'"** (a
   generic client-side fallback, root-caused to the auto-regenerate-on-stale-plan
   retry flow being fragile) + the original ask to make the AI screen manual-trigger
   for plan generation with single-plan-history. Fixed the nav (added a Quick Log
   entry in all three nav locations, §5), and did the first pass of removing
   automatic plan regeneration (later hardened further in step 4).
3. **Repo got pulled/re-verified, quick log camera screen threw
   "Something went wrong. Script error." specifically on Arc's mobile browser, not
   Chrome.** Root cause: a global `window.addEventListener('error', ...)` handler was
   treating *any* page error — including ones from Arc's own injected overlay
   scripts ("Arc Max"), running in the same top-level context — as this page's own
   fatal failure. Fixed by ignoring the browser-generic, filename-less
   `"Script error."` case (same-origin code always has a filename; a bare one with
   none is never this page's own bug). Also added a `navigator.mediaDevices`
   availability pre-check for a clearer message on browsers/embeds with no camera API
   at all.
4. **"Turn off automatic meal plan generation on logging; make chat survive closing
   the tab."** This is where §4.5 and §4.6 above were built — both web and iOS
   (the iOS side had never actually been touched in step 2/3, only web had). Also
   discovered and fixed the Windows dev-server PATH issues (§1) as part of getting
   live browser verification working for this change.
5. **New resting-calories-floor setting + "editing history doesn't move the average
   deficit/surplus" bug.** This is where §4.1–§4.3 above were established/exercised.
   Caught and fixed two bugs in my own draft before shipping (§4.3's CROSS-JOIN
   zero-row hazard, and the `automaticallySetGoals` missing-table-guarantee bug) —
   worth noting because it demonstrates the level of scrutiny this kind of SQL change
   needs; a query that "looks right" against the happy path can still zero out results
   for edge-case users.
6. **"AI sometimes doesn't work — long load, then 'invalid response'"; make the meal
   plan collapsible.** Root-caused to §4.4's thinking-parts bug (a real, previously
   partially-fixed defect, not a new one) — this is likely the single most impactful
   fix in this session if the user was hitting it as often as described, since it was
   silently discarding valid Gemini answers. Also added the collapsible `<details>`
   plan UI (verified live in-browser: click collapses/expands, chevron rotates
   correctly, `open` property toggles as expected — see §1 point 5 for how that
   verification was actually done without a working screenshot pipeline).

Every commit above was pushed directly to `origin/master` on the user's explicit,
standing instruction ("Yes always push automatically") given in this session. That
preference is **not** written into any config file, so it does **not** carry over to
a new session/machine by itself — if you're a fresh agent picking this up, either ask
the user to confirm the same preference again, or write it into a `CLAUDE.md` at the
repo root if they want it to persist automatically next time (they were offered this
and hadn't answered as of this document being written).

## 8. Things I'd flag to the user if this were a longer session

Not fixed, just noticed — worth surfacing to whoever picks this up, not necessarily
worth fixing unprompted:

- **iOS changes are unverified by a compiler.** Every Swift edit this session was
  reviewed by hand only (no Xcode available on this Windows machine). Build
  `ios/Fuel` on a Mac at the first opportunity to catch anything missed — particularly
  around the `OnDeviceAI.planRestOfDay(justLogged: String?, ...)` signature change
  (was non-optional `String`) and its single call site in the new
  `AppStore.generateNewPlan()`.
- **`ios/HealthLogger/archive.sh` has a pending, unexplained local change** — just a
  file-mode flip (`100755` → `100644`, executable bit lost), present since before this
  session started, never committed, left alone throughout because its origin/intent
  is unknown. Ask the user before touching it.
- **Gemini model fallback list will need periodic updates.** Per the comment in
  `api/_lib/meal-plan.js:9-24`, Google retires free-tier models faster than anything
  else in this stack, and it's happened at least twice already (each time silently
  breaking the app until someone noticed). If the AI features stop working again and
  §4.4's fix doesn't explain it, check whether `GEMINI_MODEL_FALLBACKS` needs a new
  entry — that's the other classic failure mode here.
