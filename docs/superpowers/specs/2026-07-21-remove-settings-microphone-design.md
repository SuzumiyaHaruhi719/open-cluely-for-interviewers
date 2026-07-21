# Remove the Duplicate Settings Microphone Control

## Purpose

Keep microphone selection in one visible, operational location: the audio card on the main interview page. Settings should not duplicate a control that already exists beside the capture button.

## Scope

- Remove the Audio section and microphone selector from `SettingsModal`.
- Remove Settings-only microphone enumeration code and props.
- Keep `useAppSettings().settings.micDeviceId` and `setMicDeviceId()` because the main-page selector and capture pipeline still use that persisted value.
- Keep the main-page microphone selector, its recording lock, permission affordance, and device-change behavior unchanged.
- Leave the evaluation-report model as the only Settings control.

## Data flow

- `ChannelCard` enumerates available microphones on the main page.
- A selection calls `Shell`'s `appSettings.setMicDeviceId()`.
- `useAppSettings` persists the device id under `mic.inputDeviceId`.
- The capture pipeline reads that selected device when microphone recording starts.
- Opening Settings does not enumerate devices or expose a second mutation path.

## Error handling

Existing main-page behavior remains authoritative: unavailable devices fall back through the capture path, recording locks the selector, and the permission affordance can reveal device names.

## Acceptance

- Settings contains no microphone or Audio section.
- Settings still changes the evaluation-report model.
- The main-page microphone selector still renders, persists changes, and locks during capture.
- Focused and full tests pass; the production build succeeds.
- The rebuilt app is visually checked at `http://127.0.0.1:8788/`.
