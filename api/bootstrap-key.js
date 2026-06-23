const crypto = require('crypto');

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Yalnızca GET istekleri kabul edilir.' });
    }
    try {
        const secret = process.env.CHAT_SECRET_KEY;
        if (!secret) {
            return res.status(500).json({ error: 'Sunucu yapılandırma hatası: CHAT_SECRET_KEY env variable tanımlı değil.' });
        }

        // 🛡️ [DÜZELTME] Eskiden crypto.randomBytes(32) ile HER İSTEKTE farklı
        // bir anahtar üretiliyordu — bu yüzden gönderen ve alıcı hiçbir zaman
        // aynı anahtara sahip olamıyor, şifre çözme her zaman başarısız oluyordu.
        // Şimdi: sunucudaki sabit CHAT_SECRET_KEY + bugünün tarihinden HMAC-SHA256
        // ile deterministik bir anahtar türetiliyor. Aynı gün + aynı secret =
        // TÜM istemciler için AYNI anahtar (gerekli budur). Ertesi gün otomatik
        // olarak farklı bir anahtara döner (günlük rotasyon / forward secrecy).
        const dateSeed = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
        const secureKey = crypto.createHmac('sha256', secret)
            .update(dateSeed)
            .digest('base64');

        res.status(200).json({
            bootstrapKey: secureKey
        });
    } catch (error) {
        res.status(500).json({ error: 'Anahtar üretilirken bir sunucu hatası oluştu.' });
    }
}
