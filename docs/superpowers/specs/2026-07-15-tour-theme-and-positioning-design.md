# Theme-aware, self-revealing spotlight tour

## Goal

Make the onboarding tour follow the app's active light/dark theme and keep every step anchored to its intended control even when the right rail is collapsed.

## Scope

- Web tour: `web-app/web/src/desktop/SpotlightTour.tsx` and its styles in `web-app/web/src/web-extras.css`.
- Electron tour: `src/windows/assistant/tour.js` and `src/windows/assistant/tour.css`.
- Preserve the current tour copy, step order, keyboard controls, progress, animations, and persistence behavior.
- Remove the duplicate `dismissed` declaration that currently prevents the Electron module from parsing.

## Theme design

Tour chrome uses semantic CSS variables instead of hard-coded dark colors: mask, tooltip surfaces, border, title/body/muted text, ghost hover, dots, arrow, shadow, and accent. The web variables resolve from the GLP theme tokens already switched by `html[data-theme]`; therefore an open tour updates immediately when the topbar theme switch changes. The Electron stylesheet keeps its current dark appearance as the default and defines `html[data-theme="light"]` overrides so it follows the same attribute whenever that surface enables light mode. No tour-specific theme state or observer is introduced.

## Target-reveal and positioning design

JD and résumé steps declare that they require the right rail. Before either implementation measures such a target, it checks `body.rail-collapsed` and clicks `#toggle-rail-btn` once to reopen the rail through the app's existing state/persistence path. It waits for the rail transition, scrolls the target into view, and then measures it.

Every navigation starts a new monotonic positioning run and immediately invalidates the previous target geometry. Delayed scroll/measurement callbacks verify that their run is still current before updating the spotlight, preventing rapid Next/Previous clicks from applying stale coordinates. Visibility checks include dimensions, rendered ancestor visibility, opacity, and viewport intersection.

If a target remains unavailable after reveal and measurement—for example, the responsive layout uses `display:none` for the rail—the current step renders as a centered tooltip with no spotlight. It never retains the preceding step's ring, arrow, or tooltip coordinates, and the user can continue normally.

## Component behavior

- `SpotlightTour` owns the current step, positioning run, measured rectangle, tooltip position, and centered-fallback state.
- Electron `startTour` owns equivalent run state and shared helpers for reveal, visibility, centered fallback, and positioning.
- The existing rail toggle remains the single owner of rail state. The tour triggers it; it does not directly mutate React state or storage.
- Theme changes are CSS-only and require no component rerender.

## Error handling

- Missing toggle button: continue to measurement; use centered fallback if the target is still unavailable.
- Missing/hidden target: centered fallback for that step.
- Superseded timer/measurement: ignore it using the positioning-run id.
- Destroyed tour: pending work sees the dismissed/run state and performs no DOM writes.

## Testing and verification

- Add a web regression test that starts with the right rail collapsed, advances to JD/résumé, verifies the rail toggle is invoked, and verifies the current step does not use the previous target geometry.
- Add a hidden-target regression test for centered fallback.
- Add a CSS contract test confirming tour chrome uses semantic theme variables with light/dark definitions.
- Syntax-check the Electron module to catch duplicate declarations.
- Run the complete web test suite and `npm run build` from `web-app/`.
- Manually verify the live dev server still responds on ports 5173 and 8787.

## Success criteria

1. The tour visually follows the active app theme without reload.
2. JD and résumé steps automatically reopen a manually collapsed right rail.
3. A hidden or missing target never leaves the tour at the previous step's position.
4. Rapid navigation cannot apply an older step's delayed measurement.
5. Electron `tour.js` parses, web tests pass, and the required production build succeeds.
