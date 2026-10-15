# Design System Template: Liquid Glass, adapted to any product

A **generic, platform-neutral** design file. It is not a finished spec: an agent turns it into a
project-specific `DESIGN.md`, then updates the app to match.

- **Works on:** Android (Views or Compose), iOS / macOS (SwiftUI or UIKit), Web (any framework), Flutter.
- **Design language:** Apple's Liquid Glass ideas (a floating functional layer, materials, motion designed
  together with visuals), expressed through **semantic colour roles** (Material 3 vocabulary) so that it
  runs on any platform's theming system.
- **Reference implementation:** CareBoard's `DESIGN.md` (Android Views, clinical wall board). When unsure
  how a rule plays out in practice, read it.

> **Three kinds of values in this file.**
> **(Apple)** comes from Apple's published guidance. Keep the rule.
> **(default)** is a starting value from this template. The agent may tune it during adaptation.
> **(project)** is a placeholder `{{…}}` that the agent **must** fill. A project `DESIGN.md` with any
> `{{…}}` left in it is not finished.

---

## 0. Agent protocol (read first, follow in order)

You are adapting this template to one product. Do **not** start editing UI code until Phases 1–2 are
done and the user has seen the open decisions.

### Phase 1: Discover (read-only)

Inspect the repository and answer every question below. Record the answers in §A of the output file.

| # | Question | Where to look |
|---|---|---|
| D1 | Platform(s) and UI toolkit | Android: `build.gradle*`, `res/layout` (Views) vs `@Composable`. iOS: `*.xcodeproj`, `Package.swift`, SwiftUI vs UIKit. Web: `package.json` (React/Vue/Svelte/Angular, Tailwind, CSS-in-JS). Flutter: `pubspec.yaml` |
| D2 | Minimum OS / browser targets | `minSdk`, deployment target, `browserslist` |
| D3 | Existing theming source | M3 theme XML / `MaterialTheme`, asset catalogs, CSS variables, Tailwind config, `ThemeData` |
| D4 | Existing design docs or tokens | `DESIGN.md`, `tokens.json`, Figma exports, Storybook |
| D5 | Product type and viewing context | README, screens, user's description (see profiles in Phase 2) |
| D6 | Primary input | Touch, mouse and keyboard, remote/D-pad, wall display (no input) |
| D7 | Hardware floor | Low-end kiosks, old phones, desktop GPUs. Decides the blur tier (§4.1) |
| D8 | Data liveness | Static, user-driven, or live pushed updates (WebSocket, polling) |
| D9 | Main screens and their surfaces | Navigation graph, routes, activities, main layouts |
| D10 | Accessibility obligations | Regulatory (WCAG 2.2 AA, Section 508, EN 301 549, clinical), existing a11y prefs |

If an answer can't be found in the code, **ask the user**. Don't guess D5, D7 or D10.

### Phase 2: Adapt (write the project `DESIGN.md`)

1. Copy this file to the project root as `DESIGN.md` (if one exists, merge into it and keep its project
   decisions).
2. **Pick one profile** (§1) and apply its overrides to every **(default)** value.
3. Fill every `{{…}}` placeholder. Delete platform rows in §9 and §10 that the project doesn't use.
4. Build the **layer map** (§3) from the D9 surfaces: one row per real surface, with file paths.
5. Write the **open decisions** (§12) for anything with cost or product impact (new dependency, blur
   tier, layout changes). Show them to the user and wait for answers before Phase 3.
6. Delete §0 and the "Template" wording from the output; keep the value tags.

### Phase 3: Implement

1. Build the **building blocks first** (§10): tokens, glass surface, motion helper, selection control,
   concentric radius helper, scroll edge. One place for each token; no magic numbers in screens.
2. Migrate surfaces **in layer-map order, one screen at a time**. Each step leaves the app building.
3. Wire the accessibility modes (§8) **with** the first glass surface, not at the end.
4. Keep a progress file (`DESIGN_PROGRESS.md`, or the project's existing one) with **DONE / IN
   PROGRESS / TODO** and a dated log. Update it after every step.

### Phase 4: Verify

- Builds pass; existing tests pass.
- Screenshot or run each changed screen in light, dark, high-contrast and reduced-motion modes.
- Run the checklist in §11 (Don'ts) against the diff.
- Report what was verified and what wasn't. Don't claim a mode works if you didn't look at it.

---

## A. Project facts *(agent fills in Phase 1)*

| Item | Value |
|---|---|
| Product | `{{PRODUCT_NAME}}`: `{{one-line description}}` |
| Profile (§1) | `{{Wall board / Mobile app / Productivity / Content & marketing site}}` |
| Platform and toolkit | `{{e.g. Android Views, minSdk 26}}` |
| Theme source of truth | `{{file / module}}` |
| Input | `{{touch / pointer / remote / none}}` |
| Hardware floor and blur tier | `{{e.g. API 26 kiosks → Tier B}}` |
| Data liveness | `{{static / user-driven / live}}` |
| Accessibility target | `{{e.g. WCAG 2.2 AA + 7:1 for distance text}}` |
| Progress file | `{{DESIGN_PROGRESS.md}}` |

---

## 1. Product profiles

Pick **one**. It overrides the **(default)** values across the file. When a product sits between two,
pick the stricter one for motion and contrast.

| Setting | **Wall board / kiosk** (read from distance, live data) | **Mobile app** (consumer, touch) | **Productivity / dashboard** (desktop or tablet, dense) | **Content & marketing site** (web, scroll) |
|---|---|---|---|---|
| Glass budget on screen | 3–4 | 3–5 | 2–3 | 1–2 (nav, one CTA bar) |
| Motion intensity | Low: springs on controls only | Full | Medium: shorter durations (×0.8) | Medium; scroll-linked reveals allowed once |
| Bounce (release damping) | 0.6 | 0.55 | 0.7 | 0.7 |
| Body text | 15–17sp min, **min 11sp**, no light weights | 16–17 pt / sp | 13–15 px, min 11 | 16–18 px, min 12 |
| Contrast target | **7:1** small text | 4.5:1 | 4.5:1 | 4.5:1 |
| Touch / click target | 48dp | 44pt / 48dp | 32px pointer, 44px touch | 44px |
| Live-data motion | Cross-fade only | Cross-fade + gentle insert | Cross-fade only | n/a |
| Default blur tier | B (opaque-ish) | A where supported | A where supported | A (`backdrop-filter`) |
| First load | Skeletons | Skeletons | Skeletons | Server render; no skeleton flash |

---

## 2. Core rules (apply everywhere, every profile)

1. **Two layers.** *Content* (cards, rows, lists, media, widgets) uses solid tonal surfaces.
   *Glass* (bars, tab bars, switchers, toolbars, panels, sheets, menus, popovers) floats above content.
   "Don't use Liquid Glass in the content layer" (Apple).
2. **Use glass sparingly.** Only for "the most important functional elements" (Apple). Respect the
   profile's glass budget.
3. **No glass on glass.** Anything on glass uses fills or vibrant text, never a second glass layer.
   When a glass sheet expands over floating glass buttons, remove the buttons (Apple).
4. **Regular glass by default.** *Clear* glass only over photos or video, with a ~35% dimming layer
   (Apple). Never mix Regular and Clear on one screen (Apple).
5. **Glass has no colour of its own.** Labels and icons on glass are monochrome (`onSurface`,
   `onSurfaceVariant`). **Tint only to convey meaning**: one primary action per surface, or a real
   status. Tint the control's *background*, not just its icon (Apple).
6. **Non-interactive items stay off glass.** Titles, clocks, counts and status indicators on glass look
   like buttons (Apple). Put them as plain text in or next to the bar.
7. **Concentric corners.** inner radius = outer radius − padding, min 8dp/pt/px (Apple). Capsules for
   single touch actions; rounded rectangles for dense, stacked controls (Apple).
8. **No solid bar backgrounds, no dividers.** Where content scrolls under floating glass, use one
   **scroll edge effect** per pane: *hard* with pinned headers, *soft* otherwise (Apple).
9. **One selection language.** Tabs, segmented controls, chips and sidebars all show "selected" with
   the same sliding selection pill and the same spring (Apple).
10. **Motion is feedback for what the user did.** Data that changes by itself (pushes, polling) doesn't
    bounce or slide. Glass controls are springy; content is calm.
11. **Morph, don't pop.** A surface opened by a control grows out of that control and returns into it
    (Apple).
12. **Accessible by construction.** Every glass surface has an opaque fallback (Reduce Transparency), a
    high-contrast variant (Increase Contrast) and a fade-only motion path (Reduce Motion).
13. **Never colour alone.** Every status pairs colour with text or an icon.

---

## 3. Layer map *(agent fills in Phase 2)*

One row per real surface found in D9. Every surface is either **Content** or **Glass**; there is no
third option.

| Surface | File / component | Layer | Treatment |
|---|---|---|---|
| `{{App bar / top bar}}` | `{{path}}` | Glass | Capsule groups (§6.1); title as plain text |
| `{{Primary navigation: tabs / switcher / sidebar}}` | `{{path}}` | Glass | Glass capsule + selection pill (§6.2) |
| `{{Primary action}}` | `{{path}}` | Glass, tinted | The single tinted control on that surface |
| `{{Cards / list rows / table}}` | `{{path}}` | Content | Tonal surface, no elevation (§6.3) |
| `{{Status chips / KPIs / badges}}` | `{{path}}` | Content | Tonal wash + icon/dot, not pressable |
| `{{Detail panel / inspector}}` | `{{path}}` | Glass (large) | Morphs from the tapped item (§5.3 E) |
| `{{Menus / popovers}}` | `{{path}}` | Glass (large) | Morphs from the source button (§5.3 F) |
| `{{Modal sheets / dialogs / editors}}` | `{{path}}` | Glass (large) | Over a scrim; inner sections are tonal |
| `{{Toasts / snackbars}}` | `{{path}}` | Glass (small) | Rise and fade; don't stack |

---

## 4. Material tokens

### 4.1 The glass recipe

Real glass *samples what's behind it*. Platforms differ a lot in how cheaply they can do that, so the
recipe has two tiers. **Tier B must look right on its own**; Tier A is an enhancement.

| Layer (bottom → top) | **Tier B**: no blur (all targets) | **Tier A**: backdrop blur |
|---|---|---|
| Backdrop | none | blur 24 (small) / 32 (large) **(default)** |
| Fill | `surfaceContainerHigh` at 88% (small) / 97% (large) **(default)** | `surface` at 62% (small) / 76% (large) **(default)** |
| Ambient colour | An app background wash or gradient shows through the translucency | same |
| Rim highlight | 1-unit gradient stroke, top-leading white at 35% light / 14% dark → 0% bottom-trailing **(default)** | same |
| Shadow | 6 (small) / 12 (large) elevation, tinted shadow 18% light / 40% dark **(default)** | same |
| Content on glass | `onSurface`, `onSurfaceVariant`; monochrome icons | same |

**Tier A availability by platform**

| Platform | How | Use Tier A when |
|---|---|---|
| iOS / macOS 26+ | Native `glassEffect` / `UIGlassEffect` / `NSGlassEffectView`. Use the system material; skip this recipe | Always: prefer native glass |
| iOS / macOS older | `.ultraThinMaterial` / `UIVisualEffectView` + rim and shadow | Always |
| Android 12+ (API 31) | Window blur for dialogs/sheets (`Window.setBackgroundBlurRadius`); backdrop blur needs a capture library (BlurView, Haze for Compose) | Hardware isn't a low-end kiosk and `isCrossWindowBlurEnabled()` |
| Android < 12 | none | Never: Tier B |
| Web | `backdrop-filter: blur()` with `-webkit-` prefix | `@supports (backdrop-filter: blur(1px))` and not a low-power target |
| Flutter | `BackdropFilter` + `ClipRRect` | Profile allows it; keep the blurred area small |

Rules:
- **Group neighbours.** Adjacent glass controls share **one** glass shape (Apple's
  `GlassEffectContainer`): one shape, one shadow, one sampling pass.
- **Size changes material.** Bigger glass is more opaque and casts a deeper shadow; small glass is
  clearer (Apple). *Small* for bars and switchers, *large* for panels, sheets and dialogs.
- **Tinted glass** (primary action only) = the fill above blended 35% toward `primary`, content
  `onPrimaryContainer` **(default)**. A tone, not a solid fill (Apple).
- **Identity (off).** Under Reduce Transparency every glass surface becomes opaque
  `surfaceContainerHigh` + 1-unit `outlineVariant` border, no blur, no rim.
- **Live blur over constantly changing content is expensive.** For live-data profiles prefer Tier B.

### 4.2 Shape: concentric radii

**inner = outer − padding, min 8** (Apple). Never hard-code an inner radius; derive it (§10.4).

| Container | Radius **(default)** | Padding | Inner (derived) |
|---|---|---|---|
| Screen-level panels, sheets, detail | 28 | 14–18 | 10–14 → children ≥ 8 |
| Content card | 24 | 16 | 8 |
| Section inside a panel | 20 | 12–14 | 8 |
| Glass capsule group | 50% (capsule) | 4–6 | capsule |
| Chips, tags, KPI pills | capsule | — | — |
| Dialog / keypad card | 32 | 24–28 | 8–12 |

Units: dp (Android), pt (Apple), px or rem (web), logical px (Flutter).

### 4.3 Colour

Use **semantic roles**, never raw hex in components. The canonical vocabulary is Material 3; map it to
the platform:

| Role | Android | Apple | Web (CSS vars) | Flutter |
|---|---|---|---|---|
| `surface`, `surfaceContainer{Low,,High,Highest}` | `?attr/colorSurface…` / `MaterialTheme.colorScheme` | Asset catalog colours named by role (or `systemBackground` / `secondarySystemBackground`) | `--color-surface…` | `ColorScheme.surface…` |
| `onSurface`, `onSurfaceVariant` | `colorOnSurface…` | `label`, `secondaryLabel` | `--color-on-surface…` | `onSurface…` |
| `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer` | `colorPrimary…` | `accentColor` + asset roles | `--color-primary…` | `primary…` |
| `outline`, `outlineVariant` | `colorOutline…` | `separator`, `opaqueSeparator` | `--color-outline…` | `outline…` |
| `error`, `onError` | `colorError…` | `systemRed` (or an asset role) | `--color-error…` | `error…` |
| Status: `urgent`, `caution`, `success`, `info` | custom attrs | asset colours | `--color-status-*` | `ThemeExtension` |

Rules:
- **Chrome is neutral.** Status hues belong to **content** only; never decorate chrome with them
  (Apple: "Avoid using the same color to mean different things").
- **Prominence budget:** 1 tinted control per glass surface; at most 2 on screen (Apple).
- **Contrast:** ≥ 4.5:1 for text under 18 units, ≥ 3:1 for large or bold text (Apple, WCAG). Use the
  profile's target where it is higher. Add a `readable(fg, bg, min)` helper that enforces it.
- Every palette ships **light, dark and high-contrast** variants. Material Theme Builder exports
  medium- and high-contrast schemes; Apple asset catalogs have a "High Contrast" appearance; web uses
  `@media (prefers-contrast: more)`.
- Brand palettes are swapped by changing the role values only. No component should know which palette
  is active.

### 4.4 Type and spacing

- **Body** and **minimum** sizes: from the profile (§1). No light weights below 20 units.
- **Numbers** that change or line up (counts, timers, prices, tables): tabular figures
  (`fontFeatureSettings "tnum"`, `.monospacedDigit()`, `font-variant-numeric: tabular-nums`,
  `FontFeature.tabularFigures()`).
- **Touch targets**: from the profile; never below 44.
- **Padding:** about 12 around bordered controls, about 24 around borderless ones (Apple).
- **Bars:** max 3 groups, fixed 10–12 gap between groups, one primary action on the trailing side,
  short titles (Apple).
- **Spacing scale (default):** 4, 8, 12, 16, 20, 24, 32, 48. Use only these.

---

## 5. Motion system

### 5.1 Principles

- **Glass is elastic; content is calm.** Springs and bounce only on glass controls (press, selection
  pill, morphing panels). Content uses short fades and small translations.
- **Morph, don't pop.** Surfaces grow out of the control that opened them and return into it (Apple).
- **Materialize, don't fade.** Glass appears by ramping material (rim, shadow, opacity, blur) with a
  small scale, not by alpha alone (Apple).
- **Interruptible.** Springs retarget mid-flight. Never block input while an animation settles.
- **No motion for data.** Pushed or polled updates change in place. Only alert onset gets attention
  motion, and never as the only signal.
- **No loops near 0.2 Hz** (Apple). Any pulse should be ≤ 1.2s per half-cycle.

### 5.2 Tokens **(default)**

One module owns these values (§10.2). Screens never contain durations or spring numbers.

| Token | Use | Stiffness / damping ratio | ≈ iOS `response` / `dampingFraction` |
|---|---|---|---|
| `spring.press` | press-in to scale 0.96 | 1500 / 1.0 | 0.16 / 1.0 |
| `spring.release` | release, one soft bounce | 400 / 0.55 (profile) | 0.31 / 0.55 |
| `spring.select` | selection pill slide and stretch | 500 / 0.78 | 0.28 / 0.78 |
| `spring.morph` | panels, popovers, sheets growing from source | 380 / 0.82 | 0.32 / 0.82 |
| `spring.settle` | Reduce Motion replacement for every spring | 800 / 1.0 | 0.22 / 1.0 |

Conversion (mass 1): `response = 2π / √stiffness`, `dampingFraction = dampingRatio`.

| Token | Use | Value |
|---|---|---|
| `dur.micro` | tint, colour, icon swaps | 120ms, standard ease |
| `dur.short` | fade-through between content layouts | 200ms, emphasized decelerate in / accelerate out |
| `dur.medium` | screen switch shared-axis, sheet in | 300ms, emphasized |
| `dur.long` | large container transform | 380ms, emphasized |
| `stagger` | first-load cascade | 18ms per item, cap 8 |
| `offset.enter` | content enter translation | 12 (cards), 8 (rows) |
| `ease.emphasized` | — | cubic-bezier(0.2, 0, 0, 1) |

**Platform mapping**

| Concept | Android Views | Compose | SwiftUI / UIKit | Web | Flutter |
|---|---|---|---|---|---|
| Spring | `SpringAnimation` (`androidx.dynamicanimation`) | `spring(dampingRatio, stiffness)` | `.spring(response:dampingFraction:)` / `UISpringTimingParameters` | Motion (`motion`) `type: "spring"` or CSS `linear()` spring curve | `SpringSimulation` / `SpringDescription` |
| Shared axis | `MaterialSharedAxis` | `AnimatedContent` + slide/fade | `.transition(.push(from:))` | View Transitions API / framework transition | `SharedAxisTransition` (`animations`) |
| Container transform | `MaterialContainerTransform` | `SharedTransitionLayout` | `matchedGeometryEffect`, `.navigationTransition(.zoom)`, `glassEffectID` | View Transitions (`view-transition-name`) | `OpenContainer` |
| Fade-through | `MaterialFadeThrough` | `Crossfade` | `.transition(.opacity)` | opacity transition | `FadeThroughTransition` |

### 5.3 Motion catalogue

Map each pattern to real surfaces in the project's layer map. Delete patterns the product doesn't have.

#### A. Pressing a glass control
- **Down:** scale to 0.96 on `spring.press`, instantly. A radial white glow at 18% spreads from the
  finger or pointer over ~220ms (Apple: "illuminates from within").
- **Up:** scale to 1.0 on `spring.release`; glow fades out over 160ms. Haptic on touch platforms
  (light tap for keys, confirm for primary actions).
- **Pointer platforms:** add hover (fill +4% `onSurface`) and a visible focus ring (2-unit `primary`,
  offset 2). Keyboard activation gets the same press motion.
- **Content** cards and rows don't bounce: pressed overlay `onSurface` at 6%, nothing else.

#### B. Switching top-level screens (tabs / switcher)
1. **Selection pill** (tonal `primary` fill, not glass) slides to the new segment on `spring.select`,
   stretching up to 12% toward the destination mid-slide, then relaxing. Lifts on touch-down (scale
   1.06, rim on). Dragging across the control drags the pill, which snaps to the nearest segment.
2. **Content:** shared-axis X, `dur.medium`; forward = later in the switcher order. Outgoing slides
   −30 and fades, incoming from +30. Titles cross-fade at `dur.short`.
3. **Ambient colour** (if the app has a background wash) moves from the old centre to the new one
   (600ms, emphasized) instead of jumping.
4. **Reduce Motion:** pill jumps with a `dur.micro` colour cross-fade; content fade-through.

#### C. Switching layouts within a screen (cards ↔ table, grid ↔ list)
- Same selection pill as B.
- `fade-through` at `dur.short`; outgoing scales to 0.98. Then a **cascade** of the first visible
  items (rise `offset.enter`, `stagger`, cap 8). Only the first frame animates; recycled or lazily
  loaded items never animate in.
- Keep scroll position per layout.

#### D. First load and live updates
- **First load:** skeletons (tonal shimmer 1.2s, `surfaceContainerHighest` ↔ `surfaceContainer`),
  then fade-through into real content with the cascade.
- **Live updates:** no movement or re-layout while the user is touching the screen.
  - Changed text cross-fades (`dur.micro`). Changed status chips animate fill and text tint together.
  - Inserts and removals: fade only, `dur.short`.
  - User-requested re-sorts animate moves (~220ms). This is the one place items move.
- **Alert onset:** one stronger flash (scale 1.0 → 1.02 → 1.0, 300ms), then a slow pulse (§5.1).
- **Changing numbers:** cross-fade with a 6-unit shift in the direction of change.

#### E. Opening detail from an item
- Container transform from the item to the detail surface, `dur.long`. Parallel task (inspector,
  side panel): no scrim. Modal: scrim.
- The glass **thickens** during the morph (elevation 2 → 12, fill small → large).
- **Close:** reverse into the item; if the item is offscreen, dematerialize (scale 0.96, fade, 160ms).
- Switching items while open cross-fades the content and doesn't re-morph.

#### F. Menus and popovers
- Scale from 0.6 at the source (pivot = source centre) to 1.0 on `spring.morph`; corner radius goes
  from capsule to the panel radius; content fades in after 60ms (Apple).

#### G. Modal sheets, dialogs, editors
- Scrim fades in (45%, `dur.short`). The surface materializes from its source (scale 0.92 → 1,
  `spring.morph`, rim and shadow ramp in). Side sheets slide from the trailing edge, inset 16 (Apple).
- Step navigation inside (prev / next): body cross-slides on X; the glass surface stays put.
- Confirm dialogs (discard etc.) morph from the button that triggered them.
- **Errors:** short decaying horizontal shake (360ms) + error colour flash + error haptic. Under
  Reduce Motion: error text only.

#### H. Scroll edge effects
- **Hard** (pinned headers, tables): header gets an opaque background and a 1-unit `outlineVariant`
  hairline only once content scrolls under it (fade 120ms).
- **Soft** (everything else under floating glass): 24-unit gradient from the pane colour to
  transparent, fading in when content is under it.
- One per pane. None where nothing floats.
- Web: CSS `mask-image` gradient or a sticky pseudo-element; toggle with an `IntersectionObserver`
  sentinel.

#### I. Toasts and transient notices
- Rise 12 and fade, `dur.short`. Don't stack; replace.

### 5.4 Reduce Motion mapping

| Normal | Reduced |
|---|---|
| Springs with bounce | `spring.settle` |
| Press scale and glow | Pressed overlay only |
| Shared-axis / slide | Fade-through, `dur.short` |
| Container transform | Cross-fade at destination |
| Cascade / stagger | Single fade |
| Number rolls, radial spring-outs, sweeps | Appear in place |
| Pulses | Static indicator |
| Shake | Error text only |
| Blur ramp | No blur animation |
| Scroll-linked reveals (web) | Content visible immediately |

---

## 6. Component specs

### 6.1 Glass capsule group
- Height 52, inner padding 4, capsule. Children 44 tall (44 + 2×4 = 52, concentric) **(default)**.
- Background: §4.1 small recipe. Children have no background except the selection pill.
- Groups are separated by 10–12. Never nest a group inside another.

### 6.2 Selection pill: the only way to show "selected"
- One element behind the segments; capsule; tonal `primary` fill; selected label `onPrimary`
  (`dur.micro`). Motion per §5.3 B.
- Used by every single-select control: tabs, segmented controls, filter chips, sidebar items, settings
  choices.
- Accessible: exposes "selected" state (`aria-selected` / `accessibilityTraits.isSelected` /
  `stateDescription` / `Semantics(selected:)`); arrow keys move selection on pointer platforms.

### 6.3 Content card / row
- `surfaceContainerHigh`, 24 radius, 1-unit `outlineVariant` stroke, **no elevation**.
- Selected: 2-unit `primary` ring. Alert: severity ring (pulse per §5.1).

### 6.4 Large glass panel (detail, popover, sheet, dialog)
- §4.1 large recipe, 28 radius (32 for dialogs and keypads).
- Inner sections are tonal content (`surfaceContainer`), concentric radius.
- Modal: 45% scrim. Parallel: no scrim.

### 6.5 Status chip vs action chip
- **Status chip:** content layer, tonal wash + dot or icon, never glass, not pressable.
- **Action chip:** inside a glass group, uses the selection pill, pressable.

---

## 7. Layout

- **Edge-to-edge:** content scrolls under floating glass, which sits inset 16 from the edges. Pad
  content by the height of the floating chrome so nothing rests under glass in its resting state
  (Apple).
- **Hierarchy by layout, not boxes:** remove borders and dividers whose only job is separation; group
  with spacing (Apple).
- **Responsive:** `{{breakpoints, e.g. compact < 600, medium < 840, expanded ≥ 840}}`. On expanded
  widths, detail opens as a side panel (parallel); on compact, as a sheet (modal).
- **Profile specifics:** wall boards use 24 side margins and put the most important item at the
  largest size; sites keep a max content width (`{{e.g. 1200px}}`).

---

## 8. Accessibility modes

| Mode | Android | Apple | Web | Flutter | Effect |
|---|---|---|---|---|---|
| **Reduce transparency** | No system flag: add app pref; also when `isCrossWindowBlurEnabled()` is false | `accessibilityReduceTransparency` | `prefers-reduced-transparency: reduce` (+ app setting; support is partial) | App setting | Glass → identity (opaque + outline) |
| **Increase contrast** | API 34+ `UiModeManager.getContrast()`; app pref | `colorSchemeContrast == .increased` | `prefers-contrast: more` | `MediaQuery.highContrast` | High-contrast palette, opaque glass, 1.5-unit `onSurface` outline on glass and chips, no tinted glass, 7:1 |
| **Reduce motion** | `ANIMATOR_DURATION_SCALE == 0` / `ValueAnimator.areAnimatorsEnabled()`; app pref | `accessibilityReduceMotion` | `prefers-reduced-motion: reduce` | `MediaQuery.disableAnimations` | §5.4 |
| **Large text** | `fontScale` | Dynamic Type | `rem` units, 200% zoom | `textScaler` | Layouts reflow; no clipped labels |

Also required: labels on every icon-only control, a polite live region for summaries (not every item),
a non-gesture alternative for every gesture, visible keyboard focus on pointer platforms, and logical
focus order.

---

## 9. Platform notes *(keep only the project's platform)*

- **Android Views:** colours from theme attributes only (`?attr/…`); glass as a custom `Drawable` +
  `FrameLayout`; springs need `androidx.dynamicanimation` (≈30 KB). Before adding it, fall back to
  `OvershootInterpolator(1.2f)` for release and `PathInterpolator(0.2,0,0,1)` for emphasized motion.
- **Jetpack Compose:** tokens in a `CompositionLocal`; glass as a `Modifier.glass(size)`; Haze for
  Tier A blur; `SharedTransitionLayout` for morphs.
- **SwiftUI / UIKit:** on OS 26+ use the system glass (`glassEffect`, `GlassEffectContainer`,
  `glassEffectID`, `.buttonStyle(.glass)`) and **don't** re-draw the recipe; this file's rules (layers,
  budget, tint, motion) still apply. Older OS: materials + rim + shadow.
- **Web:** tokens as CSS custom properties on `:root`, redefined for `prefers-color-scheme: dark` and
  `prefers-contrast: more`; glass as one `.glass` / `.glass--large` class or component;
  `backdrop-filter` inside `@supports`; motion through one module that reads `prefers-reduced-motion`.
  Mind GPU cost of large `backdrop-filter` areas on mobile Safari.
- **Flutter:** tokens via `ThemeExtension`; glass widget wraps `ClipRRect` + optional `BackdropFilter`;
  `animations` package for transitions.

---

## 10. Building blocks (build these first)

| # | Block | Responsibility | Project location |
|---|---|---|---|
| 1 | **Tokens** | Colour roles, radii, spacing, type, motion values. The only place values live | `{{path}}` |
| 2 | **Motion** | Springs and durations from §5.2, helpers `press`, `materialize`, `morph`, `sharedAxis`, `fadeThrough`, `cascade`, `tint`. Reads Reduce Motion once and swaps implementations | `{{path}}` |
| 3 | **Glass surface** | §4.1 recipe in small and large sizes, tinted variant, identity fallback, Tier A when available | `{{path}}` |
| 4 | **Concentric** | `inner(outer, padding, min = 8)` and a shape factory. All nested radii go through it | `{{path}}` |
| 5 | **Segmented control** | Glass capsule + selection pill (§6.2), finger/pointer tracking, keyboard, one `onSelected` callback. Replaces every single-select control | `{{path}}` |
| 6 | **Scroll edge** | Soft or hard edge for a scrolling pane under floating chrome | `{{path}}` |
| 7 | **Skeleton** | Shimmer placeholders for cards and rows | `{{path}}` |
| 8 | **Readable** | Contrast check `readable(fg, bg, min)` used for any computed colour | `{{path}}` |

---

## 11. Don'ts (checklist for every UI diff)

- [ ] No glass on content: cards, rows, lists, tables, KPIs, status chips, clocks.
- [ ] No glass on glass.
- [ ] No more than one tinted control per glass surface; no tint for decoration.
- [ ] No status colours on chrome; no colour as the only signal.
- [ ] No motion on pushed/polled data beyond a cross-fade; no re-layout under the user's finger.
- [ ] No bounce on content; no pure alpha fade for glass appearing.
- [ ] No scroll edge where nothing floats; no soft and hard on one pane.
- [ ] No hard-coded inner radii, colours, durations or springs in screens.
- [ ] No glass surface without its Reduce Transparency, Increase Contrast and Reduce Motion paths.
- [ ] No refraction shaders, lensing or motion-sensor highlights unless the platform provides them
      natively (the rim gradient is the specular cue).

---

## 12. Open decisions *(agent writes these in Phase 2, user answers before Phase 3)*

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Blur tier | Tier B everywhere / Tier A where supported | `{{based on D7, D8}}` | |
| 2 | New dependencies | `{{e.g. dynamicanimation, Haze, motion}}` | `{{…}}` | |
| 3 | Layout changes from rule 6 (titles and clocks off glass) | `{{…}}` | `{{…}}` | |
| 4 | `{{project-specific}}` | | | |

---

## 13. Sources

- Apple, Liquid Glass overview and adoption:
  https://developer.apple.com/documentation/technologyoverviews/liquid-glass,
  https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Apple, Applying Liquid Glass to custom views:
  https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
- Apple HIG: materials, color, motion, layout, typography, accessibility, tab bars, toolbars,
  segmented controls, sheets, popovers, menus, scroll views
- WWDC25: 219 *Meet Liquid Glass*, 356 *Get to know the new design system*, 323 / 284 / 310 (SwiftUI,
  UIKit, AppKit adoption)
- Material 3: color roles, motion (easing and duration), shape — https://m3.material.io
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- Reference implementation: CareBoard `DESIGN.md` (Android Views, wall board profile)
