import crypto from 'crypto';
export default function handler(req, res) {
    const { action } = req.query;
    const secretKey = process.env.CHAT_SECRET_KEY;
    if (!secretKey) {
        return res.status(500).json({ error: 'Sunucu yapılandırma hatası: CHAT_SECRET_KEY eksik.' });
    }
    // 1. ADIM: Kullanıcı giriş yaparken kimliğini sunucuya damgalatır
    if (req.method === 'POST' && action === 'issue') {
        const { username, userId, signingPublicKey, alg } = req.body;
        if (!username || !userId || !signingPublicKey) {
            return res.status(400).json({ error: 'Eksik parametreler.' });
        }
        // 🛡️ [FIX] alg: istemcinin kullandığı imza algoritması. Ed25519
        // WebCrypto'da her tarayıcıda yok (Chrome <137 [Mayıs 2025], Safari
        // <17, Firefox <129) — desteklenmeyen tarayıcılarda istemci ECDSA
        // P-256'ya düşüyor ve bunu burada bildiriyor. Bu alan pasaportun
        // imzalanan gövdesine girmezse, doğrulayan peer'lar her zaman
        // Ed25519 varsayar ve ECDSA'ya düşmüş kullanıcıların anahtarını
        // yanlış formatla import etmeye çalışıp sessizce başarısız olur.
        // Whitelist dışı/eksik değer güvenli varsayılan olan Ed25519'a düşer.
        const safeAlg = (alg === 'ECDSA-P256') ? 'ECDSA-P256' : 'Ed25519';
        const identityPayload = JSON.stringify({
            username: username.trim(),
            userId:   userId,
            pubKey:   signingPublicKey,
            alg:      safeAlg,
            // 🛡️ issuedAt: imzalanma zamanı (replay koruması için)
            // exp: pasaport geçerlilik süresi — 24 saat (5dk çok kısaydı,
            //      WebRTC oturumları + yeniden bağlantı denemeleri aşıyordu)
            issuedAt: Date.now(),
            exp:      Date.now() + 24 * 60 * 60 * 1000
        });
        const signature = crypto
            .createHmac('sha256', secretKey)
            .update(identityPayload)
            .digest('hex');
        return res.status(200).json({
            passport:  Buffer.from(identityPayload).toString('base64'),
            signature: signature
        });
    }
    // 2. ADIM: Arkadaş, gelen kullanıcının pasaportunun gerçek olup olmadığını sorgular
    if (req.method === 'POST' && action === 'verify') {
        const { passport, signature } = req.body;
        if (!passport || !signature) {
            return res.status(400).json({ error: 'Doğrulama için pasaport ve imza gereklidir.' });
        }
        let decodedPayload, data;
        try {
            decodedPayload = Buffer.from(passport, 'base64').toString('utf8');
            data           = JSON.parse(decodedPayload);
        } catch (e) {
            return res.status(400).json({ valid: false, error: 'Pasaport çözülemedi.' });
        }
        // İmza doğrulaması — HMAC eşleşmiyorsa sahte pasaport
        const expectedSignature = crypto
            .createHmac('sha256', secretKey)
            .update(decodedPayload)
            .digest('hex');
        let signaturesMatch = false;
        try {
            signaturesMatch = crypto.timingSafeEqual(
                Buffer.from(signature,         'hex'),
                Buffer.from(expectedSignature, 'hex')
            );
        } catch (e) {
            // Buffer boyutları farklıysa timingSafeEqual fırlatır → sahte
            return res.status(401).json({ valid: false, error: 'Geçersiz imza formatı.' });
        }
        if (!signaturesMatch) {
            return res.status(401).json({ valid: false, error: 'Geçersiz imza! Sahte kimlik tespiti.' });
        }
        // Süre kontrolü:
        //   — Yeni format: exp alanını kullan (24 saatlik pencere)
        //   — Eski format (exp yoksa): timestamp'ten 24 saat tolerance ver
        //     (geriye dönük uyumluluk — eski pasaportlar aniden kırılmasın)
        const now = Date.now();
        if (data.exp) {
            if (now > data.exp) {
                return res.status(401).json({ valid: false, error: 'Pasaport süresi dolmuş. Lütfen tekrar giriş yap.' });
            }
        } else if (data.timestamp) {
            // Eski format uyumluluğu: 24 saat tolerance
            if (Math.abs(now - data.timestamp) > 24 * 60 * 60 * 1000) {
                return res.status(401).json({ valid: false, error: 'Pasaport süresi dolmuş. Lütfen tekrar giriş yap.' });
            }
        }
        return res.status(200).json({ valid: true, identity: data });
    }
    return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
}
