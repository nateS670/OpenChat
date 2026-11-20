# Architecture and refactoring plan

## Current shape

- `index.html`: UI markup, styles, and the current static page shell.
- `app.js`: a large classic script containing application state, local storage, password handling, cryptography, identity, MQTT, WebRTC, file transfer, rendering, and event handlers.
- `i18n.js` and `chat-summary.js`: separately loaded browser scripts.
- `api/`: Vercel serverless functions for identity, auth, configuration, bootstrap key, and ICE servers.
- `middleware.js`: best-effort in-memory API throttling and optional origin filtering.

The browser code has no module or package boundary today. Moving script code into ES modules changes load order and CSP behavior, so a one-shot split would be risky.

## Staged extraction

1. **Add a safety net.** Record key user flows and add tests around protocol primitives and API input validation. Capture representative packet fixtures and current behavior before moving code.
2. **Extract pure helpers.** Move byte/base64 conversion, validation, canonical serialization, fingerprint formatting, and packet shape checks into modules with no DOM or network access.
3. **Separate cryptography.** Create a crypto module with explicit inputs/outputs for key generation, derivation, signing, verification, encryption, and decryption. Keep storage and UI out of it. Document the protocol alongside tests.
4. **Separate transports.** Isolate MQTT signaling and WebRTC DataChannel lifecycle behind small interfaces. Keep message validation at the boundary and test disconnect/reconnect behavior.
5. **Separate state and UI.** Move persistence, chat state, and rendering/event binding into distinct modules. Keep `index.html` as markup and remove inline event handlers only when corresponding CSP hashes are updated and verified.
6. **Enforce in CI.** Run syntax checks, tests, lint, and dependency/security checks on pull requests. Require a manual security review for crypto or identity protocol changes.

## Invariants to preserve

- Never silently accept a changed pinned peer identity.
- Reject malformed, oversized, replayed, or unauthorized signaling and data-channel payloads before rendering or storing them.
- Do not log plaintext messages, passwords, key material, or TURN credentials.
- Keep keys non-extractable where the Web Crypto API and persistence design allow it; document any export needed for storage.
- Keep CSP strict. When script/style sources change, verify the deployed headers and remove stale hashes rather than adding broad inline allowances.
- Keep endpoint origin checks described as browser-side defense in depth, not authentication.

## Suggested first engineering milestone

Create a small testable protocol package for canonical message encoding, signature verification, fingerprint calculation, and packet validation. Do not change wire behavior during this milestone. Once fixtures pass on both sides, extraction can proceed function by function with a small diff and a clear rollback point.
