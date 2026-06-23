const crypto = require('crypto');

export default function handler(req, res) {
    // Sadece POST isteklerine izin vererek güvenliği artırıyoruz
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir.' });
    }

    const { username, userId } = req.body;

    // Girdi doğrulaması (Input Validation)
    if (!username || !userId) {
        return res.status(400).json({ error: 'Eksik parametre: username ve userId zorunludur.' });
    }

    // Vercel panelinden tanımlayacağın gizli anahtar
    const secretKey = process.env.CHAT_SECRET_KEY; 
    if (!secretKey) {
        return res.status(500).json({ error: 'Sunucu hatası: CHAT_SECRET_KEY sistemde tanımlı değil.' });
    }

    try {
        // MED-03: İstemciden gelen veriyi ve zaman damgasını birleştiriyoruz
        const sessionData = JSON.stringify({
            username: username.trim(),
            userId: userId,
            timestamp: Date.now()
        });
        
        // Sunucu tarafında HMAC-SHA256 algoritmasıyla veriyi imzalıyoruz
        const serverSignature = crypto
            .createHmac('sha256', secretKey)
            .update(sessionData)
            .digest('hex');

        // Güvenli taşıma için veriyi Base64 formatına çevirip imza ile birlikte dönüyoruz
        res.status(200).json({
            payload: Buffer.from(sessionData).toString('base64'),
            signature: serverSignature
        });

    } catch (error) {
        res.status(500).json({ error: 'Kimlik imzalama işlemi sırasında teknik bir hata oluştu.' });
    }
}
