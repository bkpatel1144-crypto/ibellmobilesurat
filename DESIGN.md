# IBELL MOBILE: Design

Adapted from `DESIGN_TEMPLATE.md` (Liquid Glass with semantic colour roles). The rules in that file apply; this page records the project decisions.

## A. Project facts

| Item | Value |
|---|---|
| Product | IBELL MOBILE: billing, stock and accounts for a new and used mobile phone shop |
| Profile | Productivity / dashboard (desktop at the counter, phone as secondary) |
| Platform | Web: React 18 + Vite, plain CSS custom properties |
| Theme source of truth | `src/styles/tokens.css` |
| Input | Mouse and keyboard, barcode scanner (IMEI), touch on phones |
| Blur tier | A where `backdrop-filter` is supported; Tier B fallback otherwise |
| Data liveness | Live (Firestore `onSnapshot`): updates cross-fade only |
| Accessibility | WCAG 2.2 AA: 4.5:1 text, visible focus, reduced motion, reduced transparency, increased contrast |

## Palette

Monochrome by request: black and white. Light theme = white cards on a light grey ground, black primary. Dark theme = near-black cards on black, white primary. Status hues (green, red, amber) appear only on content chips and amounts, always with text.

## Layer map

| Surface | File | Layer |
|---|---|---|
| Sidebar navigation | `src/components/Layout.jsx` | Glass (small) + sliding selection pill |
| Top bar actions | `PageHeader` in `Layout.jsx` | Glass capsule group; title is plain text |
| Primary action (New Sale, Save…) | each page | The single tinted (black/white) control |
| KPI tiles, cards, tables, device lines | `ui.jsx`, pages | Content: tonal, no elevation |
| Status chips | `StatusChip`, `.chip` | Content: tonal wash + dot + text |
| Dialogs (party, payment, repair, passkey…) | `Modal` in `ui.jsx` | Glass (large) over 45% scrim, materialize motion |
| Search dropdowns | `PartySelect`, sale device search | Glass (large), morph from field |
| Toasts | `ToastContext.jsx` | Glass (large), rise and fade, never stacked |

## Building blocks

| Block | Location |
|---|---|
| Tokens (colour, radius, spacing, type, motion) | `src/styles/tokens.css` |
| Glass surface (`.glass`, `.glass--large`, identity fallback) | `src/styles/app.css` |
| Selection pill (segmented control, sidebar) | `Segmented` in `ui.jsx`, `.nav-pill` |
| Soft scroll edge | `.scroll-edge` + `useScrolled` |
| Skeleton | `SkeletonPage` |

## Decisions

1. Blur: Tier A with an `@supports` guard; opaque under `prefers-reduced-transparency` and `prefers-contrast: more`.
2. No new animation dependency: springs are CSS `linear()` curves in tokens; all collapse under `prefers-reduced-motion`.
3. Charts are single-series in the primary ink, so no categorical palette is needed.
