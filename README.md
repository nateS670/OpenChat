# OpenChat

OpenChat is an experimental browser based chat application built with WebRTC, MQTT signaling, and browser cryptography. It aims to send conversation traffic directly between connected peers and does not provide a central message history service.

> **Status:** Beta and not independently security audited. Do not rely on OpenChat for high risk or safety critical communication.

## What it does

- Peer to peer text and file transfer over WebRTC DataChannels when network conditions allow.
- MQTT based discovery and signaling, plus serverless endpoints for configuration and connectivity.
- Browser side cryptography and locally stored application data.
- PWA installation and browser notifications where supported.

Signaling and connection services still observe some connection metadata. When TURN relaying is needed, traffic is relayed by the TURN service. WebRTC protects transport, but this repository's application level identity and key protocol has not received an independent cryptographic review. A server issued passport proves that a payload was signed by the deployment's shared server secret; it does not prove that a username belongs to a particular real person. Verify a peer fingerprint through a separate trusted channel before relying on it.

## Run locally

The frontend is static HTML and JavaScript, while `api/` contains Vercel serverless functions. Serve the project over HTTPS (or localhost) and deploy with Vercel to exercise the full application. Opening `index.html` directly does not provide the API endpoints.

Configure these Vercel environment variables for the corresponding services:

| Variable | Purpose |
| --- | --- |
| `CHAT_SECRET_KEY` | HMAC signing key used by identity and bootstrap endpoints |
| `MQTT_BROKER_URL` | MQTT broker URL returned by `/api/config` |
| `TOPIC_ROTATE_SECRET` | Secret used to derive the current signaling topic |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Optional broker credentials |
| `METERED_API_KEY` | Metered TURN credential endpoint |
| `AUTH_API_KEY` | API key checked by the auth endpoint |
| `ALLOWED_ORIGINS` | Optional comma separated origin allowlist used by middleware |

Use unique, high entropy values for secrets and configure production origins for your deployment. Never commit `.env` files or production credentials. API access checks based on Origin, Referer, or Fetch Metadata are browser request checks, not user authentication; clients outside browsers can forge some of these headers.

## Architecture

`index.html` contains the UI, `app.js` currently owns most client behavior, `i18n.js` provides translations, and `chat-summary.js` handles chat summaries. `api/` contains the Vercel endpoints. The current frontend is intentionally dependency light, but `app.js` is a large legacy script; see [the architecture notes](docs/ARCHITECTURE.md) for a staged refactoring plan.

## Privacy and security limits

- OpenChat is real time oriented. Undelivered messages may be lost when a peer disconnects.
- Peer to peer connectivity may require STUN/TURN; TURN can relay encrypted transport packets and observe network metadata.
- MQTT and serverless endpoints process metadata needed for discovery and setup.
- Browser local storage is available to scripts running on the same origin. A successful XSS or compromised deployment can undermine client side protections.
- First contact does not establish a real world identity. Compare fingerprints out of band.
- The protocol and implementation have not been independently audited. See [SECURITY-MODEL.md](SECURITY-MODEL.md) and [SECURITY.md](SECURITY.md).

## Contributing

Keep changes small and reviewable, document security relevant behavior, and include reproducible checks for changes to cryptography, signaling, storage, or message parsing. Avoid claims of anonymity or audited end to end security unless supported by independent review.

## License

MIT. See [LICENSE](LICENSE).
