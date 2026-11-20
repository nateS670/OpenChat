# Security model (working draft)

This document records the guarantees the current design appears to target and the limits visible from the repository. It is not a security audit or a protocol specification. The crypto and identity flows need independent review before stronger claims are made.

## Intended protections

- WebRTC DataChannels provide encrypted transport between connected peers.
- The client uses Web Crypto for local storage encryption and peer key operations.
- The application does not operate a central message-history database.
- The UI supports comparing a peer fingerprint and warns when a pinned identity changes.

These mechanisms do not by themselves prove that the other endpoint is the person the user expects, prevent a compromised client from reading messages, or hide network metadata.

## Assets and trust boundaries

| Asset | Where it is handled | Main trust boundary |
| --- | --- | --- |
| Message and file contents | Browser memory, WebRTC DataChannel, optional TURN relay | Both endpoint browsers and their deployed code |
| Local chat/account data | Browser storage; parts are encrypted by client code | Same-origin scripts, device access, password strength and key lifecycle |
| Peer identity keys and fingerprints | MQTT presence messages and browser storage | Signaling broker and first-contact verification |
| MQTT and topic configuration | `/api/config` response to browsers | Anyone able to call the endpoint can inspect returned values |
| TURN credentials | `/api/ice-servers` response to browsers | Credential lifetime, provider, and endpoint access |
| Passport signing secret | `CHAT_SECRET_KEY` in the serverless deployment | Deployment environment and server operator |

## What this does not protect against

- A malicious or compromised deployment can serve modified JavaScript to users.
- An XSS bug or malicious same-origin script can access data while the application is running.
- A first-contact attacker may substitute a peer identity unless users compare fingerprints over an independent channel.
- Signaling and TURN providers can observe connection metadata; a TURN relay can see encrypted transport packets and traffic timing/volume.
- Browser storage can be read by local device users or same-origin scripts. Encryption at rest does not protect data while unlocked.
- The current architecture has no centralized delivery queue, so offline delivery and recovery are not guaranteed.

## Repository observations requiring review

1. `api/identity.js` issues an HMAC-signed passport for caller-supplied username, user ID, and public key. The endpoint comments explicitly state that it does not enforce username ownership or uniqueness. Treat the passport as a server-authenticated statement that the deployment signed those fields, not as proof of a person's identity.
2. `api/config.js` returns MQTT connection configuration to the browser. Anything returned to a browser must be treated as public to that client; origin checks are not authentication.
3. `middleware.js` keeps rate-limit counters in per-instance memory. Deployments, cold starts, and regions may have separate counters, so this is a best-effort throttle and not a global abuse limit.
4. `app.js` contains identity, encryption, storage, signaling, file transfer, and UI logic in one large file. This makes review and regression isolation difficult.
5. The repository does not currently provide a visible automated test suite or CI workflow for cryptographic protocol behavior.

These are review priorities, not confirmed vulnerabilities. Validate each item against the deployed configuration and full protocol before making deployment decisions.

## Security review gates

Before describing the project as suitable for sensitive communications:

- Specify the handshake transcript, key derivation, identity binding, replay handling, and group membership checks.
- Have an independent reviewer assess the cryptographic protocol and implementation.
- Add tests for valid/invalid passports, key changes, replayed signaling, malformed packets, and encrypt/decrypt interoperability.
- Define API abuse controls using a shared rate-limit store or provider controls where global limits are required.
- Publish a clear vulnerability response contact and supported release policy.
