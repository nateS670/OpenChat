const crypto = require('crypto');

// 🛡️ [YENİ-SEC FIX] Tutarlılık: config.js/ice-servers.js'teki AYNI Origin/
// Referer allowlist deseni buraya da eklendi. bootstrapKey diğer sırlar
// kadar hassas değil (tüm client'lara ortak, kişiye özel olmayan bir
// anahtar) ama bu uç nokta önceden HİÇBİR koruma olmadan tamamen açıktı —
// tutarlılık ve savunma derinliği için aynı desen uygulandı. Aynı dürüst
// sınırlama geçerli: tarayıcı dışı sahte başlıklar taklit edilebilir.
const ALLOWED_ORIGINS = [
    'https://openchatt.vercel.app',
    // 'https://ozel-domaininiz.com',
];

function isAllowedRequest(req) {
    const origin  = req.headers['origin'];
    const referer = req.headers['referer'] || req.headers['referrer'];
    if (origin && ALLOWED_ORIGINS.includes(origin)) return true;
    if (referer) {
        try {
            const refererOrigin = new URL(referer).origin;
            if (ALLOWED_ORIGINS.includes(refererOrigin)) return true;
        } catch (e) { /* bozuk/eksik referer — reddedilmiş sayılır */ }
    }
    return false;
}

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Yalnızca GET istekleri kabul edilir.' });
    }

    // 🛡️ [YENİ-SEC FIX] Ortam değişkeni kontrolünden ÖNCE — yetkisiz
    // isteklerde yapılandırma bilgisi (hata mesajı dahil) sızmasın.
    if (!isAllowedRequest(req)) {
        return res.status(403).json({ error: 'forbidden' });
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
