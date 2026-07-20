# Doubao-First ASR and Xunfei Removal

## Purpose

Make Doubao Seed ASR 2.0 Duration the product's only user-facing speech-recognition provider, remove provider selection, and remove Xunfei from every active web and Electron path. Paraformer and simulation may remain internal implementation/QA facilities but cannot be selected by an interviewer.

## Product behavior

- Every normal interview uses `volc`, backed by the server-owned `volc.seedasr.sauc.duration` entitlement.
- Settings has no ASR provider selector. Xunfei credentials and controls no longer exist.
- A browser or desktop profile that previously persisted any provider choice purges that preference; normal configuration always sends `volc`.
- The normal product configuration cannot select Xunfei or Paraformer. Test-only simulation remains available to deterministic QA.
- Automatic Expert follow-ups are enabled for every normal interview. Their Settings row and top-bar toggle are removed, and retired browser preferences cannot disable them.
- Missing Doubao environment credentials produce the existing actionable Doubao error. The runtime must not silently fall back to another recognizer.

## Architecture

### Web application

- Remove `xfyun` from the shared ASR contract, renderer settings, message parsing, WebSocket validation, health capabilities, and relay routing.
- Delete the Xunfei WebSocket client and its provider-specific tests.
- Remove the ASR selector and provider persistence. The renderer always configures `volc`; internal simulation is injected only by automated tests.
- Remove the Auto-follow-up setting and top-bar toggle. The renderer always configures `autoGenerate: true`; the server-side switch remains an internal test/cancellation seam rather than a product preference.
- Default the relay, WebSocket session initialization, normalization fallbacks, and top-bar metadata to `volc`.
- Treat Doubao and simulation speaker IDs as native acoustic clusters: first-seen guessing stays disabled and DeepSeek Flash maps clusters to interviewer/candidate roles.

### Electron application

- Remove the Xunfei service, startup wiring, settings IPC fields, saved-state fields, credential controls, renderer branches, and styling.
- Remove provider selection and always restore/configure `volc` for normal application sessions.
- Retain Paraformer only as non-user-facing implementation compatibility; do not add a hidden Xunfei branch.

## State migration

- Web `localStorage`: `open-cluely.asrProvider` and `open-cluely.autoGenerate` are retired and removed on load.
- Electron state: any saved ASR provider normalizes to `volc`; obsolete Xunfei credential fields are ignored rather than copied into normalized state.
- No API key, secret, or token is moved into browser state. Doubao credentials stay environment-owned.

## Data flow

1. Startup fixes the normal ASR provider to `volc` and automatic Expert follow-ups to enabled.
2. The client sends those fixed product policies; the server supplies Doubao credentials and Duration resource configuration.
3. The relay opens Seed ASR 2.0, preserves native speaker IDs, and streams partial/final transcripts.
4. The speaker partitioner maps one or more interviewer clusters and the candidate cluster semantically.
5. Confirmed interviewer turns feed panel context; confirmed candidate turns feed the continuous Flash monitor and Expert workflow.

## Error handling

- An unavailable Doubao entitlement fails visibly with the existing provider-specific message.
- Retired provider and Auto preferences are purged before fixed configuration is sent.
- A raw WebSocket request that explicitly sends `xfyun` fails schema validation; there is no silent compatibility mode.

## Verification

- Tests first prove fixed Doubao configuration, retired preference purging, absence of the ASR and Auto controls, absence of the Xunfei capability/protocol member, Doubao no-guess role policy, and Electron state migration.
- Focused suites run red before implementation and green afterward.
- Full web, server, and Electron tests; production builds; health checks; repository search for active Xunfei paths; and an in-app settings acceptance check complete the removal.

## Scope boundaries

- Paraformer is not exposed to interviewers; deleting its internal client is outside this change.
- Historical git commits are not rewritten.
- Historical design documents may describe earlier decisions, but current product docs and executable paths must not advertise Xunfei.
