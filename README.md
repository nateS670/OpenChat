🚀 **OpenChat**

OpenChat is a modern, Peer-to-Peer (P2P), and End-to-End Encrypted (E2EE) WebRTC messaging application built around a serverless architecture with no centralized message database.

After a WebRTC connection is established, messages and files are exchanged directly between browsers through cryptographically secured Data Channels. Server-side infrastructure is used for signaling, configuration, and NAT traversal assistance rather than centralized message storage.

---

📄 **License & Free Use**

OpenChat is released under the MIT License.

You are free to:

- Use OpenChat for personal or commercial projects.
- Modify and rebuild any part of the application.
- Fork and redistribute your own version.
- Integrate OpenChat's code into other projects.

Please retain the original MIT License and copyright notice when redistributing the project.

---

✨ **Key Features**

⚡ Fully P2P Messaging

WebRTC establishes direct connections between users whenever network conditions allow it.

Once a connection is established, messaging traffic is transferred directly between peers instead of passing through a centralized messaging server.

🔒 **End-to-End Encryption**

OpenChat uses browser-side cryptographic mechanisms including ECDH (P-256) and Ed25519 for its peer security model.

Cryptographic keys are generated and handled on the client side, while application data is protected using authenticated encryption mechanisms.

OpenChat does not maintain a centralized database containing users' chat histories.

☁️ **Serverless Signaling**

Signaling is handled through Vercel Serverless Functions and an MQTT-based discovery/signaling layer.

The signaling infrastructure is used to help peers discover and establish connections. Once the WebRTC connection is established, messaging traffic moves to the P2P DataChannel.

🛡️ **Protected Configuration**

Sensitive configuration such as broker credentials and TURN service credentials are kept outside the public frontend source code through Vercel Environment Variables and server-side configuration endpoints.

🌐 **Browser Security**

OpenChat uses security headers and a strict Content Security Policy (CSP) as an additional defense layer against XSS and other browser-side attacks.

User-controlled data is validated and sanitized where appropriate.

📱 **PWA & Notifications**

OpenChat can be installed as a Progressive Web App (PWA) and supports browser notifications where the platform and browser allow them.

---

🛠️ **Technology Stack**

Component| Technology
Frontend| Vanilla JavaScript (ES6+), HTML5, CSS3
Messaging| WebRTC DataChannels
Signaling| MQTT / EMQX
Backend| Vercel Serverless Functions
Cryptography| Web Crypto API, ECDH P-256, Ed25519, AES-GCM, PBKDF2
NAT Traversal| STUN / TURN
TURN Provider| Metered
Application| Progressive Web App (PWA)

---

🏗️ **How It Works**

1. Secure Configuration

When OpenChat starts, the client communicates with the required serverless endpoints to obtain configuration and connection information.

Sensitive service credentials are kept outside the public frontend source code.

2. Peer Discovery & Signaling

Users discover each other through the MQTT signaling infrastructure.

The peers exchange the information required to establish a WebRTC connection and perform the cryptographic handshake.

3. Direct P2P Connection

Once the WebRTC connection is established, the signaling layer is no longer responsible for transporting chat messages.

The peers communicate directly through a WebRTC DataChannel:

User A
   │
   │  Signaling / Discovery
   ▼
Serverless + MQTT
   │
   │  Connection established
   ▼
User A ◄──────── WebRTC DataChannel ────────► User B
                    P2P

4. No Centralized Message Database

OpenChat does not use a centralized database to store users' conversations.

This means there is no central chat-history database containing everyone's messages that can be compromised in a conventional server-side database breach.

---

⚠️ **Important Notes & Architectural Limitations**

OpenChat is an experimental open-source project. Its security model is based on client-side cryptography and peer-to-peer communication, but no software can guarantee absolute security.

🌐 **P2P Connectivity**

WebRTC attempts to establish direct peer-to-peer connections. Depending on network configuration, NAT behavior, firewalls, and connectivity conditions, STUN/TURN infrastructure may be required.

📬 **Offline Messaging**

Because OpenChat does not rely on a centralized message database, it is primarily designed for real-time communication.

Messages that have not been delivered before a peer disconnects may not be recoverable.

👤 **First-Contact Identity Verification**

OpenChat can protect the cryptographic communication channel, but it cannot independently guarantee that a user's claimed real-world identity corresponds to their cryptographic identity when starting a conversation for the first time.

For security-sensitive communication, users should verify the relevant identity fingerprint or safety information through an independent trusted channel.

🔐 **Privacy Model**

The absence of a centralized message database significantly reduces the amount of persistent message data available to a compromised server.

However, signaling and connectivity infrastructure may still process technical metadata required to establish connections.

Therefore, OpenChat should not be interpreted as providing complete anonymity.

---

🛡️ **Security**

OpenChat is designed around a privacy-first, peer-to-peer architecture.

Security-sensitive components include:

- Peer authentication and identity verification
- Cryptographic key generation and management
- WebRTC signaling
- P2P message validation
- Local encrypted storage
- API security
- Session management
- Browser-side security and CSP
- File transfer validation

Security issues may still exist, particularly because OpenChat is an actively developed experimental project.

If you discover a security vulnerability, please report it privately rather than publicly disclosing exploit details.

---

🤖 **Development**

OpenChat was developed with extensive assistance from artificial intelligence as part of an experimental approach to modern web application development.

AI-assisted development does not imply that the project is automatically secure or bug-free. The codebase is continuously reviewed, tested, and improved.

The project is intentionally open-source so that developers can inspect, audit, modify, and improve the implementation.

---

🚀 **Project Philosophy**

OpenChat aims to explore what is possible when modern browser technologies such as:

WebRTC + Web Crypto + MQTT + Serverless Functions

are combined into a communication platform without relying on a centralized message database.

The goal is to minimize centralized infrastructure while keeping communication private, transparent, and accessible.

Contributions, security reviews, improvements, and forks are welcome.

---

📜 **License**

OpenChat is licensed under the **MIT** License.

<img width="1917" height="907" alt="image" src="https://github.com/user-attachments/assets/090ad59c-24b7-4cab-8140-4740a6a000c6" />

<img width="1917" height="906" alt="image" src="https://github.com/user-attachments/assets/df15321b-869d-447d-9f24-9681d0b8e5f0" />

