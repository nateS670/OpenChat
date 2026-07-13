const crypto = require('crypto');

// 🛡️ [FIX] auth.js — ÖNCEKİ HALİ: username/userId gönderen HERKESİ, hiçbir
// doğrulama yapmadan imzalıyordu. Bu, çağıranın kim olduğuna bakılmaksızın
// başkasının kimliğine bürünülmesine (impersonation) izin veriyordu.
//
// BU HALİ: İmzalama mantığı AYNI kalıyor (davranışını bozmaz), ama artık
// isteğin geçerli bir API anahtarıyla geldiğini doğruluyor. Böylece sadece
// sizin bildiğiniz bot/admin panel çağırabilir, internetten rastgele
// gelen istekler 401 ile reddedilir.
//
// KURULUM:
//   1) Vercel → Project Settings → Environment Variables → yeni bir değişken
//      ekleyin: AUTH_API_KEY = (uzun, rastgele bir string — örn. aşağıdaki
//      komutla üretebilirsiniz: `openssl rand -hex 32`)
//   2) Bot/admin panelinizin bu endpoint'e istek atarken şu header'ı
//      göndermesini sağlayın:
//        Authorization: Bearer <AUTH_API_KEY'in aynısı>
//   3) AUTH_API_KEY'i asla istemci (tarayıcı) koduna, GitHub'a, loglara
//      yazmayın — sadece Vercel env + bot/panel'in kendi güvenli
//      konfigürasyonunda dursun.

function timingSafeEqual(a, b) {
  // 🛡️ Basit === karşılaştırması timing attack'e açıktır (karakter karakter
  // erken çıkar); crypto.timingSafeEqual sabit zamanlı çalışır.
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir.' });
  }

  // 🛡️ [FIX] API anahtarı kontrolü — bu olmadan imzalama YAPILMAZ.
  const expectedKey = process.env.AUTH_API_KEY;
  if (!expectedKey) {
    return res.status(500).json({ error: 'Sunucu hatası: AUTH_API_KEY sistemde tanımlı değil.' });
  }
  const authHeader = req.headers['authorization'] || '';
  const providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!providedKey || !timingSafeEqual(providedKey, expectedKey)) {
    return res.status(401).json({ error: 'Yetkisiz: geçersiz veya eksik API anahtarı.' });
  }

  const { username, userId } = req.body;
  if (!username || !userId) {
    return res.status(400).json({ error: 'Eksik parametre: username ve userId zorunludur.' });
  }

  const secretKey = process.env.CHAT_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'Sunucu hatası: CHAT_SECRET_KEY sistemde tanımlı değil.' });
  }

  try {
    const sessionData = JSON.stringify({
      username: username.trim(),
      userId: userId,
      timestamp: Date.now(),
    });

    const serverSignature = crypto
      .createHmac('sha256', secretKey)
      .update(sessionData)
      .digest('hex');

    res.status(200).json({
      payload: Buffer.from(sessionData).toString('base64'),
      signature: serverSignature,
    });
  } catch (error) {
    res.status(500).json({ error: 'Kimlik imzalama işlemi sırasında teknik bir hata oluştu.' });
  }
}
