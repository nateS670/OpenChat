const crypto = require('crypto');

export default function handler(req, res) {
    const { action } = req.query;

    const secretKey = process.env.CHAT_SECRET_KEY;
    if (!secretKey) {
        return res.status(500).json({ error: 'Sunucu yapılandırma hatası: CHAT_SECRET_KEY eksik.' });
    }

    // 1. ADIM: Kullanıcı ilk giriş yaparken kimliğini ve imzalama anahtarını sunucuya damgalatır
    if (req.method === 'POST' && action === 'issue') {
        const { username, userId, signingPublicKey } = req.body;

        if (!username || !userId || !signingPublicKey) {
            return res.status(400).json({ error: 'Eksik parametreler.' });
        }

        const identityPayload = JSON.stringify({
            username: username.trim(),
            userId: userId,
            pubKey: signingPublicKey,
            timestamp: Date.now()
        });

        // Sunucu tarafında taklit edilemez imza oluşturulur
        const signature = crypto.createHmac('sha256', secretKey).update(identityPayload).digest('hex');

        return res.status(200).json({
            passport: Buffer.from(identityPayload).toString('base64'),
            signature: signature
        });
    }

    // 2. ADIM: Bir arkadaşı, gelen kullanıcının pasaportunun gerçek olup olmadığını sunucuya sorgulatır
    if (req.method === 'POST' && action === 'verify') {
        const { passport, signature } = req.body;

        if (!passport || !signature) {
            return res.status(400).json({ error: 'Doğrulama için pasaport ve imza gereklidir.' });
        }

        try {
            const decodedPayload = Buffer.from(passport, 'base64').toString('utf8');
            const expectedSignature = crypto.createHmac('sha256', secretKey).update(decodedPayload).digest('hex');

            // İmza eşleşiyorsa kimlik gerçektir, tahrif edilmemiştir
            if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
                const data = JSON.parse(decodedPayload);
                
                // Replay atağını önlemek için 5 dakikadan eski pasaportları reddet
                if (Math.abs(Date.now() - data.timestamp) > 5 * 60 * 1000) {
                    return res.status(401).json({ valid: false, error: 'Pasaport süresi dolmuş (Replay Attack koruması).' });
                }

                return res.status(200).json({ valid: true, identity: data });
            } else {
                return res.status(401).json({ valid: false, error: 'Geçersiz imza! Sahte kimlik tespiti.' });
            }
        } catch (e) {
            return res.status(400).json({ valid: false, error: 'Pasaport çözülemedi.' });
        }
    }

    return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
}
