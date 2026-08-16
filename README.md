🚀 OpenChat
OpenChat is a modern, Peer-to-Peer (P2P), and End-to-End Encrypted (E2EE) WebRTC messaging application that operates entirely on a Serverless architecture without the need for a central database server.
Your messages and data never pass through any central server; instead, they flow directly from browser-to-browser (device-to-device) over cryptographically secured secure pipelines (Data Channels).

📄 License and Free Use (MIT License)
This project is protected under the MIT License. To contribute to the project's open-source philosophy and community development, broad rights are granted to developers and technology companies.
Anyone who reviews, clones, or forks the project has the following rights:

Commercial and Personal Use: You are free to take these codes and integrate them into your own projects (whether corporate or individual).

Free Modification: You are free to completely modify, break, and rebuild the project's design, backend functions, encryption infrastructure, or any other part.

Freedom of Distribution: You can create and launch your own version of OpenChat. (It is sufficient to retain the MIT license text to credit the original owner of the source code.)

✨ Key Features

Fully P2P (Peer-to-Peer) Architecture: Thanks to WebRTC technology, direct connections are established between users. Server load in between drops to zero during messaging.

End-to-End Encryption (E2EE): The moment a session is opened, ECDH (P-256) and Ed25519 cryptographic key pairs are dynamically generated in the browser memory. Messages are never stored as plaintext, even in the local database.

Serverless Signaling: The signaling infrastructure used for users to find each other is securely managed via Vercel Serverless Functions.

Zero-Secret Leak: Critical data such as MQTT Broker addresses and TURN/STUN (Metered.live) API keys are strictly never hosted in the source code (frontend). All of them are masked behind Vercel Environment Variables.

Advanced Security and CSP: By using a strict Content Security Policy (CSP) structure, XSS (Cross-Site Scripting) attacks are completely prevented. Browser console logs are automatically disabled in production.

PWA and Smart Notifications: Can be installed on the device thanks to Progressive Web App (PWA) support. It sends instant native notifications even when the browser is running in the background.

🛠️ Technological Infrastructure

Frontend: Vanilla JavaScript (ES6+), HTML5, CSS3 (Custom Dark Theme)

Messaging & Data Transmission: WebRTC (Peer-to-Peer Data Channels)

Signaling Protocol: MQTT (Asynchronous handshake via EMQX Broker)

Backend Infrastructure: Node.js, Vercel Serverless Functions

NAT Traversal (STUN/TURN): Metered.live API

🏗️ How It Works?

Secure Configuration: When the user opens the application, the frontend layer makes a secure request to the /api/config and /api/ice-servers.js endpoints on Vercel to fetch encrypted broker information and dynamic TURN server credentials.

Cryptographic Handshake: Users find each other through the MQTT channel via unique userId values and exchange ephemeral encryption keys among themselves.

Direct Tunnel (P2P): The moment the handshake is complete, MQTT steps out of the way. The WebRTC tunnel opens, and messages begin flowing directly between the two devices.

⚠️ Important Notes and Architectural Limits (AI & P2P)
When using or developing on the application, you must keep the following points in mind due to its experimental nature:

100% AI-Powered Infrastructure: The architecture, codebase, and optimizations of this project have been built from scratch entirely with the support of artificial intelligence (AI) infrastructure. While this advanced and dynamic coding method offered by AI makes the project extremely fast, minor security vulnerabilities or unexpected edge cases may occasionally arise due to its experimental nature.

Synchronous (Online) Communication: Since the system operates entirely on a Peer-to-Peer (P2P) logic, it works flawlessly and with maximum performance when users are online at the same time.

Offline Message Instability: There is no central database server in the project to store messages for days. Therefore, when parties remain offline for a long time or browser connections are completely broken, there is a possibility that offline messages may not be delivered to the other party in time or may be lost.

Secure Data Flow (No Entry for Hackers): Thanks to the Serverless architecture and End-to-End Encryption (E2EE), your data will never flow to a third-party server, even if a code-based vulnerability occurs in the system. There is no central "message database" to be compromised. Data is cryptographically hosted only between the two devices in communication.

Developer Note: This project was developed with the power of AI to push the boundaries of modern web protocols, bringing server costs down to zero while creating an end-to-end secure and uncensorable communication channel. It is completely open, transparent, and ready for further development.


<img width="1917" height="907" alt="image" src="https://github.com/user-attachments/assets/090ad59c-24b7-4cab-8140-4740a6a000c6" />

<img width="1917" height="906" alt="image" src="https://github.com/user-attachments/assets/df15321b-869d-447d-9f24-9681d0b8e5f0" />

