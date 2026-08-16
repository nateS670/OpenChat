# 🚀 OpenChat

**OpenChat** is a modern, Peer-to-Peer (P2P), and End-to-End Encrypted (E2EE) WebRTC messaging application built on a completely **Serverless** architecture—requiring no central database server.

Your messages and data never touch any central server; they flow directly from browser-to-browser (device-to-device) over cryptographically secured **Data Channels**.

---

## 📄 License & Free Use (MIT License)

This project is protected under the **MIT License**. To contribute to the project's open-source philosophy and community development, broad rights are granted to developers and technology companies.

Anyone who reviews, clones, or forks the project has the following rights:

* **Commercial & Personal Use:** Feel free to take this code and integrate it into your own projects (corporate or individual).
* **Free Modification:** You are free to modify, break, and rebuild the project's design, backend functions, encryption infrastructure, or any other part entirely.
* **Freedom of Distribution:** You can create and launch your own version of OpenChat (simply retaining the MIT license text to credit the original author).

---

## ✨ Key Features

* **⚡ Fully P2P Architecture:** Thanks to WebRTC technology, direct connections are established between users, dropping intermediate server load to zero during messaging.
* **🔒 End-to-End Encryption (E2EE):** The moment a session opens, `ECDH (P-256)` and `Ed25519` cryptographic key pairs are dynamically generated in the browser memory. Messages are never stored as plaintext, even in the local database.
* **☁️ Serverless Signaling:** The signaling infrastructure used for users to discover each other is managed securely via **Vercel Serverless Functions**.
* **🛡️ Zero-Secret Leak:** Critical data like MQTT Broker addresses and TURN/STUN (`Metered.live`) API keys are never hardcoded in the frontend source code. Everything is securely masked behind **Vercel Environment Variables**.
* **🌐 Advanced Security & CSP:** Protected via a strict Content Security Policy (CSP) to completely prevent XSS attacks. Browser console logs are automatically disabled in production.
* **📱 PWA & Smart Notifications:** Fully installable as a Progressive Web App (PWA). It delivers instant native notifications even when the browser is running in the background.

---

## 🛠️ Technological Stack

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 (Custom Dark Theme)
* **Messaging & Data Transport:** WebRTC (Peer-to-Peer Data Channels)
* **Signaling Protocol:** MQTT (Asynchronous handshake via EMQX Broker)
* **Backend Infrastructure:** Node.js, Vercel Serverless Functions
* **NAT Traversal (STUN/TURN):** Metered.live API

---

## 🏗️ How It Works

1. **Secure Configuration:** When a user opens the app, the frontend makes a secure request to `/api/config` and `/api/ice-servers.js` on Vercel to fetch encrypted broker information and dynamic TURN credentials.
2. **Cryptographic Handshake:** Users discover each other through the MQTT channel using unique `userId` values, then exchange temporary (ephemeral) encryption keys.
3. **Direct Tunnel (P2P):** Once the handshake completes, MQTT steps out of the picture. A direct WebRTC tunnel opens, and messages flow strictly between the two devices.

---

## ⚠️ Important Notes & Architectural Limits (AI & P2P)

Because of the experimental nature of this project, please keep the following in mind:

* **🤖 100% AI-Powered Infrastructure:** The architecture, codebase, and optimizations of this project were built entirely from scratch with the assistance of artificial intelligence. While AI enables rapid development and high performance, its experimental nature means minor security edge cases or unexpected bugs may occasionally surface.
* **🌐 Synchronous (Online) Communication:** Since the system relies purely on a P2P model, it performs best and most seamlessly when both users are online at the same time.
* **📬 Offline Message Instability:** There is no central database server storing messages for days. If parties remain offline for extended periods or browser connections drop entirely, undelivered offline messages may be lost.
* **🔒 Secure Data Flow (Hack-Resilient):** Thanks to the serverless design and E2EE, even if a code vulnerability arises, your data never flows to a third-party server because there is **no central message database** to compromise. Data exists solely on the two communicating devices.

---

> **Developer Note:** This project was developed leveraging the power of AI to push the boundaries of modern web protocols—driving server costs down to zero while establishing an end-to-end secure, uncensorable communication channel. It is entirely open, transparent, and ready for further evolution. Contributions and forks are welcome!

<img width="1917" height="907" alt="image" src="https://github.com/user-attachments/assets/090ad59c-24b7-4cab-8140-4740a6a000c6" />

<img width="1917" height="906" alt="image" src="https://github.com/user-attachments/assets/df15321b-869d-447d-9f24-9681d0b8e5f0" />

