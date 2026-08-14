# Handoff — Fuel

Written by an AI agent for whichever agent picks this project up next. `README.md`
covers what the project is and how to set it up; `HEALTH_SYNC.md` covers the Apple
Health protocol. This file is about **how the codebase actually works underneath** —
the conventions, the traps, and the reasoning behind decisions that are not obvious
from reading the code cold.

Read it fully before changing anything. Sections are ordered by how likely you are to
need them.

---

## 0. What this project is, as of now

Fuel is a **single-user personal nutrition and fitness dashboard**. One person uses it —
the repo owner. There are no other users, no paying customers, no support burden. That
is why there is no queue infrastructure, no batch jobs, no caching layer: everything is
computed live per request, and that is fine at this scale.

**The iOS app is the product.** Effectively all development happens in `ios/`. The web
app (`src/`, `public/`) is **legacy and no longer maintained** — it still runs at
`fuel.rishib.com` and still works, but it is not where features go, and you should not
spend effort keeping it in step with the app unless explicitly asked.

**The server is not legacy.** `api/` is actively maintained, because the iOS app is a
client of it. Every dashboard read, food write, blood panel, journey total and Health
sync goes through `api/mlog.js` into Neon Postgres. Changing server behaviour changes
the app. Treat `api/` as first-class; treat `src/` and `public/` as archaeology.

The three surfaces:

| Surface | State | Where |
|---|---|---|
| iOS app (`Fuel`) | **Active** — this is the product | `ios/Fuel` |
| Server API | **Active** — the app's backend | `api/` |
| Home Screen widgets | Active, ships inside the app | `ios/FuelWidgets` |
| Health Logger app | Vestigial — see §5.2 | `ios/HealthLogger` |
| Web dashboard | **Legacy, unmaintained** | `src/`, `public/` |

---

## 1. Shipping — the loop you will run constantly

The owner ships continuously. A normal session ends with a TestFlight build. Learn this
sequence; you will run it several times a day.

```bash
# 1. Bump the build number (both occurrences — app + widget extension)
cd ios/Fuel && sed -i '' 's/CURRENT_PROJECT_VERSION: 44/CURRENT_PROJECT_VERSION: 45/g' project.yml

# 2. Regenerate the Xcode project from project.yml
xcodegen generate

# 3. Archive
xcodebuild -project Fuel.xcodeproj -scheme Fuel \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/Fuel45.xcarchive archive -allowProvisioningUpdates

# 4. Export + upload to App Store Connect in one step
xcodebuild -exportArchive -archivePath /tmp/Fuel45.xcarchive \
  -exportPath /tmp/Fuel45Export \
  -exportOptionsPlist /tmp/FuelExportOptions.plist -allowProvisioningUpdates
```

`/tmp/FuelExportOptions.plist` does not survive a reboot. Recreate it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>9VVDB6UALA</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>upload</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
```

Then commit the version bump as its own commit, message `Build 45`.

### Things about shipping that will confuse you

- **`CFBundleVersion` in the built app is always `1`.** This is not a bug. `project.yml`
  hardcodes `CFBundleVersion: "1"` in the Info.plist, and Xcode's
  `manageAppVersionAndBuildNumber` (which defaults to true for App Store distribution)
  assigns the real, incrementing build number at upload time. `CURRENT_PROJECT_VERSION`
  is therefore **our own bookkeeping**, not what App Store Connect sees. Do not "fix"
  this; ~25 builds have shipped this way.
- **Apple enforces a daily upload limit.** Somewhere around 20–25 builds in 24 hours you
  will get:
  ```
  error: exportArchive Validation failed. Upload limit reached.
  ```
  The archive is fine. Nothing is broken. Either wait, or tell the owner they can install
  the archive directly from Xcode. Do not retry in a loop.
- **`** ARCHIVE SUCCEEDED **` followed by `** EXPORT FAILED **`** means the build worked
  and the *upload* failed. Read the actual error before assuming a code problem.
- **App Store review submission is blocked** on the owner signing in to App Store
  Connect. Do not attempt to enter Apple ID credentials — refuse and hand it back.

### Verifying before you ship

```bash
# The app (and the widget extension, which builds with it)
cd ios/Fuel && xcodebuild -project Fuel.xcodeproj -scheme Fuel \
  -destination 'generic/platform=iOS' -configuration Release build 2>&1 | grep -E "error:|warning:|BUILD"

# Health Logger, if you touched shared sync sources
cd ios/HealthLogger && xcodebuild -project HealthLogger.xcodeproj -scheme HealthLogger \
  -destination 'generic/platform=iOS' -configuration Release build 2>&1 | grep -E "error:|warning:|BUILD"

# The test suite — always, even for changes that look unrelated
npm test
```

**Zero warnings is the standard.** The build is warning-clean; keep it that way.

Server changes deploy with `npx vercel deploy --prod --yes`. Grep the output for
`Aliased` to confirm `fuel.rishib.com` moved.

---

## 2. Verifying visual work without shipping it

This is the most useful technique in this document and it is not obvious.

**You can render SwiftUI headlessly on macOS and look at the result.** `ImageRenderer`
needs no window and no simulator. Compile the *real* source files together with small
stubs for app-level dependencies, render to PNG, and read the image back.

```swift
// harness.swift — compiled with the real GlobeSphere.swift + GlobeLandmarks.swift
import SwiftUI
import AppKit

// Stubs for whatever the file under test pulls in from the wider app.
extension Color { init(hex: UInt32) { /* … */ } }
enum Palette { static func ink(_ s: ColorScheme) -> Color { .black } /* … */ }

@MainActor func render() {
    let page = GlobeSphere(route: route, progress: 0.34, /* … */)
        .frame(width: 300, height: 300)
    let renderer = ImageRenderer(content: page)
    renderer.scale = 2
    if let image = renderer.nsImage, let tiff = image.tiffRepresentation,
       let rep = NSBitmapImageRep(data: tiff),
       let png = rep.representation(using: .png, properties: [:]) {
        try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
}

@main struct Harness { static func main() { MainActor.assumeIsolated { render() } } }
```

```bash
xcrun swiftc -O -parse-as-library harness.swift \
  /path/to/GlobeSphere.swift /path/to/GlobeLandmarks.swift -o harness
./harness out.png
# then Read out.png
```

Note `-parse-as-library` plus `@main` — top-level expressions and multi-file
compilation do not mix.

**This has caught real bugs that reading could not.** In one session it found: both
polar views of the globe filling solid white, a chord slicing across Asia, a hole
punched through Antarctica on the flat map, a chart lane gap from an absent stage, and
a legend that wrapped mid-word. None of those were visible in the source.

For pure-geometry work you can go further and reimplement the projection in Node,
render SVG, and screenshot with headless Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --screenshot=out.png --window-size=900,1250 page.html
```

Both approaches beat guessing. **When you change something visual, render it.**

---

## 3. Code style

### Swift — prose comments, and they matter

The Swift in this project has an unusual and deliberate comment style. Comments are
**full sentences explaining why**, often several lines, frequently at the top of a file
explaining the whole design decision. They read like an engineer talking to a colleague.
They are never "what" restatements.

Calibrate on these:

- `ios/Fuel/Sources/GlobeSphere.swift` — the file header explains why MapKit was
  abandoned for a hand-drawn Canvas globe.
- `ios/Fuel/Sources/SleepCard.swift` — why the card replaced Recovery.
- `ios/Fuel/Sources/HealthWriter.swift` — why write-back is opt-in and narrow.
- `ios/Fuel/Sources/APIKeyStore.swift:34` — why the model list is a table.

A good comment here records a *decision or a scar*: "this was tried and failed because
X", "this is clamped because past 80° turning stops reading as turning". Write in that
register. Do not write comments that describe the diff ("changed from X to Y") — that
belongs in the commit message.

### JavaScript — terse

`api/` is dense: no semicolons, short-circuit chains, `?.`/`??` everywhere, one-line
bodies. **Match the surrounding file.** Do not reformat existing code to your taste.

### Commit messages

Long-form and explanatory, with a short title line that reads like a sentence and a body
of several paragraphs of prose explaining the reasoning, the bug's real cause, and what
was rejected. Look at `git log` for the register — e.g. "A globe with coastlines, and
poles that are ice rather than circles". Not conventional-commits, no prefixes, no
bullet lists.

### No dead code

No feature flags, no unused parameters "for later", no defensive branches for cases the
callers cannot produce. If you delete a path, delete everything that only served it.

---

## 4. Testing

```bash
npm test          # node --test test/*.test.js  — 267 tests, ~1s
```

**Every test is static source inspection.** There is no database, no simulator, no Swift
compiler in the test suite. Tests `readFileSync` the implementation and assert regexes
against its text:

```js
const sphere = read('../ios/Fuel/Sources/GlobeSphere.swift')
assert.match(sphere, /guard anyVisible else \{ return nil \}/)
```

Consequences you must internalise:

1. **Refactoring breaks tests by design.** When you change code a regex pins, update the
   regex. The test is not wrong — it is pinning an invariant, and the pin moves with the
   code. Renaming `centreLat` to `baseLat` broke a test; the fix was the regex.
2. **A passing suite does not mean the Swift compiles.** Always build as well.
3. **Regexes must match the real formatting**, including line breaks. A multi-line call
   needs `\s*\n\s*` in the pattern. Enum cases declared on one line
   (`case awake = "A", rem = "R"`) will not match `/case rem = "R"/` — use
   `.includes()` for those.
4. **Add a test for every behavioural change**, next to related ones. `test/ios-app.test.js`
   is the big one (most iOS invariants live there). Write the test after the
   implementation is stable, asserting the specific thing you built — and write the
   *why* in a comment above it, matching the prose style.

A handful of tests call real exported functions with constructed input. Prefer that when
the function is pure and importable; regex-on-source is the fallback for anything
needing Postgres, a model call, or a Swift compiler.

---

## 5. iOS architecture

### 5.1 The app

`ios/Fuel` — SwiftUI, **iOS 26 minimum**, generated by XcodeGen from `project.yml`.
Bundle `com.labloggercompany.fuel`, team `9VVDB6UALA`.

```bash
cd ios/Fuel && xcodegen generate && open Fuel.xcodeproj
```

**Always `xcodegen generate` after editing `project.yml`, and never edit
`Fuel.xcodeproj` by hand** — it is generated and your changes will be erased.

Five tabs, in `FuelApp.swift`'s `RootView`:

| Tab bar label | View | Notes |
|---|---|---|
| Dashboard | `TodayView` | Page title says "Today"; tab says "Dashboard" — this distinction was requested explicitly, do not collapse it |
| Trends | `TrendsView` | Charts + Compare |
| Log | `CameraLogView` | Camera-first; album button left of the shutter, chat bubble right |
| Coach | `CoachView` | AI chat, 1 week of persisted history |
| More | `MoreView` | Everything else |

`AppStore.swift` is the single `@Observable` store — dashboard state, all API calls,
HealthKit orchestration, chat persistence. It is large and it is the hub; start there
when tracing anything.

Dashboard card order is `FuelClient.swift`'s `allSections`. **The first six are fixed and
must stay in that order** — `nutrition`, `detailedNutrition`, `foodConsumed`, `fitness`,
`workouts`, `sleep` — with a test pinning them; the rest (the Health metric groups) are
user-reorderable. A saved layout naming a section that no longer exists must still
render, which is why `TodayView` has `case "recovery": SleepCard` — Recovery was
replaced by Sleep, and old layouts still name it.

### 5.2 Health Logger is vestigial, but its source files are not

`ios/HealthLogger` is a separate Xcode project, and the app itself is no longer the
sync path — **Fuel reads HealthKit directly**. But six of its source files are shared
into Fuel *by relative path* in `ios/Fuel/project.yml`:

```yaml
- path: ../HealthLogger/Sources/HealthKitCatalog.swift
- path: ../HealthLogger/Sources/SyncEngine.swift
- path: ../HealthLogger/Sources/SyncSink.swift
- path: ../HealthLogger/Sources/SyncStore.swift
- path: ../HealthLogger/Sources/FuelAPI.swift
- path: ../HealthLogger/Sources/BackgroundSync.swift
```

They are genuinely shared, not copied. **A sync fix belongs in exactly one place.** After
editing any of them, build *both* projects — Health Logger still compiles them and can
break independently.

### 5.3 The AI has two implementations of everything

Every AI capability exists twice:

- **On device** (default) — `OnDeviceAI.swift`, Apple `FoundationModels` with
  `@Generable` structured output. No network, no key, no quota, photos never leave the
  phone. This is a hard architectural constraint with a test asserting `OnDeviceAI.swift`
  never references `generativelanguage.googleapis.com` and never imports `URLSession`.
- **BYOK** — `RemoteAI.swift`, the user's own Claude / OpenAI / Gemini key, JSON mode.
  Keys live in the Keychain (`APIKeyStore.swift`).

**Adding an AI capability means implementing it on both paths.** The model lists live in
`APIKeyStore.availableModels` — one editable table, three tiers per provider, and
`defaultModel` is `availableModels[1]` (the balanced tier) *by construction*. Keep three
entries in that order. `model(for:)` falls back to the default when a stored selection is
no longer in the list, which is what makes a provider retiring a model a non-event.

### 5.4 Widgets

`ios/FuelWidgets` — sixteen Home Screen widgets plus Lock Screen/Control Center controls,
themed from the user's palette, reading a shared snapshot via App Group
`group.com.labloggercompany.fuel` (`WidgetShared.swift` / `WidgetPublisher.swift`). No
network from the extension.

**Hard copy rule, previously requested and enforced by a test: widgets say "Burned" and
"Consumed". Never "In", "Out", or "Eaten".**

---

## 6. iOS traps that cost real time

These were each learned the hard way. Read before touching the relevant area.

### 6.1 A `DragGesture` inside a `ScrollView` steals vertical scrolling

A SwiftUI `DragGesture` claims the touch as soon as `minimumDistance` is met **in any
direction**. Filtering by direction in `onChanged` is far too late — the scroll view has
already lost. `simultaneousGesture` does not fix it either.

The only fix is a UIKit `UIPanGestureRecognizer` that *declines* in
`gestureRecognizerShouldBegin`. See `HorizontalPan.swift`, built on
`UIGestureRecognizerRepresentable` (iOS 18+). Use it for anything horizontal that sits
inside a scroll view — swipe-to-act rows, day paging.

### 6.2 `.drawingGroup()` does not render system controls

It rasterises through Metal, and system-drawn things — segmented pickers, materials —
come out as solid colour blocks. A segmented Day/Week/Month picker turned into a solid
yellow rectangle during page transitions. Do not rasterise a subtree containing system
controls.

### 6.3 `.refreshable` holds the scroll view down until its closure returns

Long work plus a content rebuild leaves the content visibly offset after the spinner
disappears. The fix in `AppStore.pullToRefresh(reason:syncing:)` is to detach the real
work and return quickly (with a short sleep so the animation reads as deliberate).

### 6.4 MapKit cannot draw a globe

Two separate findings:

- Driving `MapCameraPosition` from a drag re-renders the whole planet — about **2 frames
  per second**. It is the tile pipeline; nothing about the call site fixes it.
- MapKit **will not zoom out far enough** to show the whole world in a small view. The
  round-the-equator card could never work as a map.

Both are now hand-drawn `Canvas` in `GlobeSphere.swift`: an orthographic sphere, and an
equirectangular `FlatWorldMap` for world-spanning routes. A frame is one pass over ~1200
points and is effectively free.

Also: `MapProxy.convert` returns `nil` until layout has happened, and a static map never
re-asks — which is why route lines rendered on some journey cards and not others. The fix
is to project from an `MKMapRect` captured via `.onMapCameraChange(frequency: .onEnd)`.

### 6.5 Orthographic projection rules that produce bugs if ignored

- Visibility is `cosC = sin(φ0)sin(φ) + cos(φ0)cos(φ)cos(λ−λ0) >= 0`.
- A hidden point pinned to the rim is correct *only if some part of the shape is
  visible*. An outline that encircles a pole and is entirely hidden pins all the way
  around the disc — and a closed path around a disc **fills it**. Both polar views went
  solid white. Guard: nothing visible means nothing drawn.
- Coarse outlines chord across the face when two consecutive points are both behind.
  Resample to ~2° once, up front.

### 6.6 HealthKit

- **A metric the user was never asked about throws `errorAuthorizationNotDetermined`.**
  With `withThrowingTaskGroup`, one such metric aborts the entire sync — so adding new
  read types silently killed the metrics that already worked. `statistics()` is now
  non-throwing and resolves to empty. **Keep it that way.**
- **HealthKit never re-prompts on its own.** A build that reads more types than the last
  one must call `requestAuthorization` again or the new metrics read empty forever. See
  `HealthKitCatalog.readTypesSignature` + `AppStore.requestHealthAccessIfCatalogueGrew()`,
  called before the session's first sync.
- **Apple reports four sleep stages, not five.** Core is N1+N2 together; Deep is N3.
  Do not present N1 and N2 separately.

### 6.7 Swift type-checker timeouts

Large SwiftUI view bodies hit "unable to type-check this expression in reasonable time".
The fix is always the same: extract a helper, or break the expression into typed locals.
It has happened in `TodayView`'s workouts section and in `HealthExtras`.

### 6.8 Charts

- Plot categorical-looking axes against **numbers**, not category strings, when you care
  which lane is on top — a categorical domain's order is not yours to control.
- Place lanes by **row index, not by an intrinsic value**. Using a stage's "depth" left a
  gap where an absent lane would have been.
- **Pin `chartXScale`** to your data's real range. Left alone, Charts rounds out to a
  nice number — a sleep chart starting at 2:15 AM rendered an axis from midnight and
  spent the first third of the card on nothing.

---

## 7. Server architecture

### 7.1 Everything routes through `api/mlog.js`

One dispatcher reads `?fuel_route=<name>` and calls a handler in `api/_lib/`. Some public
paths are rewritten to it in `vercel.json`; **the iOS app mostly calls
`/api/mlog?fuel_route=…` directly**, with no rewrite involved.

**This has caused a silent, total feature failure.** Eight client calls used
`?integration=` instead of `?fuel_route=`, matched no route, and saved meals had simply
never worked. When adding a route, verify the client's exact query string against
`mlog.js`'s dispatch, and test against production — distinct 401 messages per route are
a good way to prove the dispatch is reached.

### 7.2 `extras` is a jsonb column of mostly-numbers

`health_daily.extras` holds the ~35 metrics added after the original eighteen, plus the
sleep breakdown. It is merged, not replaced:

```sql
extras = COALESCE(health_daily.extras, '{}'::jsonb) || COALESCE(EXCLUDED.extras, '{}'::jsonb)
```

**One key is a string**: `sleepStages`, the night's hypnogram, packed as
`"D,-45,-20;C,-20,15"` (stage, start, end, in minutes around the midnight the night
ended on — negative before midnight). It travels in `extraText` on the wire and is
validated by length and character class server-side.

Because of that, the client cannot decode `extras` as `[String: Double]` — a strict
decode throws on the string and takes the whole day's extras with it. `ExtraValues` in
`FuelClient.swift` decodes each value as whatever it turns out to be. **If you add
another non-numeric key, it goes through `extraText` and `ExtraValues.text`.**

### 7.3 Dates from Postgres are not strings

`String(row.collected_on)` yields `"Thu Jan 02 2026 …"`, not `"2026-01-02"`. This
shipped as a bug **twice** (blood panels, then journeys). Use the `databaseDateKey()`
helper. Never `.slice(0, 10)` a stringified date.

### 7.4 Consumed calories has an override path

Calories consumed is normally the live sum of `food_entries`, but a manual history edit
must override it without rewriting the food log. Every read must be:

```js
number(health?.calories_consumed_override) ?? (foodEntriesSum || null)
```

Grep `calories_consumed_override` before adding a new read path. Missing it is a
silent "editing history doesn't move the average" bug.

### 7.5 `total_expenditure_kcal` is usually `active + resting`

Derived server-side when not sent explicitly. If you adjust resting or active energy for
a day, carry the delta into total — deficit maths reads the stored total, not a
recomputed sum.

### 7.6 No cron, no batch jobs, nothing "finalises" a day

Every dashboard load recomputes 30 days from raw rows. The "is this day done" signal is
the `partial_day` boolean, not a date comparison. Reuse it.

### 7.7 The website's Gemini chain is not the app's model list

`api/_lib/meal-plan.js`'s `GEMINI_MODEL_FALLBACKS` is a *fallback chain* tried in order,
ordered cheapest-first and restricted to multimodal models with a free tier. It is a
different thing, solving a different problem, from `APIKeyStore.availableModels`.
Changing one does not change the other. Google retires free-tier models often; the
comment above the list records each dead model and why.

Also, on any Gemini response: read text with the shared `responseText()` helper, which
filters `thought: true` parts. Raw `parts.map(p => p.text)` concatenation glues the
model's reasoning onto the front of the JSON and fails to parse. This has been the root
cause of two separate user-facing bugs.

---

## 8. Working with the owner

- **They ship constantly.** Default to finishing with a build unless told otherwise.
- **They ask for several things in one message.** Do all of them. It is normal to get a
  paragraph containing five unrelated feature requests.
- **They send screenshots of bugs.** Look carefully; the defect is often a small visual
  detail (a dot 2px off a line, a word wrapping).
- **They correct course bluntly and expect it absorbed without ceremony.** "Undo the
  today thing. you got it wrong." Fix it and move on.
- **Push is expected when asked, not by default.** Confirm before assuming.
- **Privacy:** this is one person's medical and location data. Blood results in
  particular were shared with an explicit instruction never to make them public. Keep
  test data synthetic, and delete any rows you create while probing production.

Pull production env with `npx vercel env pull /tmp/fuel.env` when you must, and
`rm -f /tmp/fuel.env` immediately afterwards.

---

## 9. Known state and open items

**Current:** build 44 uploaded; `master` clean and pushed; 267 tests passing; both apps
build warning-free.

Open, in rough priority order:

1. **App Store review submission is blocked** on the owner signing in to App Store
   Connect. Everything else for submission is done.
2. **The website's Gemini chain still ends on `gemini-3.6-flash`** while the app moved to
   3.7. Deliberately left — it is a cost decision (3.7 Flash is roughly an order of
   magnitude above the flash-lites the chain is built around), not a correctness one.
3. **A standing research question:** backwards sync to Apple Health is implemented for
   logged food only (`HealthWriter.swift`, opt-in, single toggle). Whether to extend it
   beyond food was never decided.
4. **`ios/HealthLogger/archive.sh` has a long-standing uncommitted mode flip**
   (`100755` → `100644`). Origin unknown. Ask before touching.
5. **The legacy web app has drifted.** It does not know about blood panels, journeys,
   body measurements, the sleep card, or the extras metrics. That is expected and fine.

Stale tasks in the agent task list reference web-era work (saved meals, food history,
place tagging) that has since shipped on iOS. Do not treat that list as authoritative.
