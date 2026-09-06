import crypto from 'crypto';

// 🛡️ [MİMARİ REVİZYON — Plan A: Güven Kökü Sunucudan Cihaza] ─────────────
// ÖNCEKİ HALİ (bu dosyanın bir önceki sürümü): action=issue için Vercel KV
// kullanan sunucu-taraflı "TOFU pinning" uyguluyordu (bir username ilk kez
// pasaport aldığında public key'ini kalıcı olarak sunucuda sabitliyordu).
// Bu, KV veritabanı bağlanamadığında (hesap kısıtlaması, "tamamen
// serverless kalsın" kararı vb.) kv.set() her çağrıda patlayıp 500
// döndürüyordu — giriş tamamen kırılıyordu.
//
// ŞİMDİ: Bu dosya SADECE bir imzalayıcı. Hiçbir kalıcı depoya ihtiyaç
// duymuyor, dolayısıyla KV/veritabanı olmadan da normal çalışır.
//
// NEDEN BU GÜVENSİZ DEĞİL: app.js'te ZATEN çok daha güçlü, tamamen
// cihaz-taraflı bir TOFU (Trust On First Use) sistemi var — bkz.
// _checkAndPinPeerIdentity, _fingerprintIdentityPubKey, _peerKeyFingerprints
// ve kullanıcıya gösterilen "Güvenlik kodu" / "Karşılaştırdım, doğrula" arayüzü.
// Bu sistem tıpkı SSH known_hosts, PGP parmak izi veya Signal güvenlik
// numarası gibi çalışır: bir kullanıcı adıyla ilk konuşulduğunda o kişinin
// kimlik anahtarının parmak izi CİHAZDA kalıcı olarak saklanır; sonraki her
// bağlantıda gelen anahtar bununla karşılaştırılır, uyuşmazsa kullanıcı
// açıkça uyarılır (bkz. _showKeyChangeWarning). Sunucunun bu kararı BİR
// KEZ DAHA, ayrıca ve zayıf bir şekilde (KV'de, cihazlar arası paylaşılan,
// tek-cihaz sınırlaması getiren bir pinleme ile) tekrar etmesine hiç gerek
// yok — hatta bu, gerçek mimariyle (bilinçli olarak sunucusuz/veritabansız)
// tutarsız bir ek bağımlılık yaratıyordu.
//
// Bu dosyanın TEK işi: bir pasaportu (username, userId, pubKey, alg,
// issuedAt, exp) HMAC-SHA256 ile imzalamak (böylece biri "ben imzaladım"
// diye uydurma bir pasaport üretemez / var olanı tahrif edemez) ve süresi
// dolmuş ya da imzası uyuşmayan pasaportları reddetmek. Hangi username'in
// "gerçekten" kime ait olduğu sorusunun cevabı, YUKARIDA açıklanan sebeple,
// KASITLI OLARAK bu dosyanın sorumluluğunda DEĞİL.
//
// KURULUM: Sadece CHAT_SECRET_KEY env değişkeninin Vercel'de tanımlı
// olması yeterli — başka hiçbir servis/veritabanı gerekmiyor.
export default async function handler(req, res) {
  // 🔎 [TEŞHİS] Dış try/catch: öngörülmemiş bir hata patlarsa Vercel
  // loglarına yazıp genel bir 500 döndürür — "sessiz", log bırakmayan bir
  // platform hatasıyla uygulamanın kendi kontrollü hatasını ayırt etmek için.
  try {
    return await handleIdentity(req, res);
  } catch (e) {
    console.error('[identity] Beklenmeyen hata:', e && e.stack ? e.stack : e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Beklenmeyen sunucu hatası.' });
    }
  }
}

async function handleIdentity(req, res) {
    const { action } = req.query;
    const secretKey = process.env.CHAT_SECRET_KEY;
    if (!secretKey) {
        console.error('[identity] CHAT_SECRET_KEY env değişkeni tanımlı değil.');
        return res.status(500).json({ error: 'Sunucu yapılandırma hatası: CHAT_SECRET_KEY eksik.' });
    }

    // 1. ADIM: Kullanıcı giriş yaparken kimliğini sunucuya imzalatır.
    // Bkz. dosya başındaki not: burada KASITLI OLARAK hiçbir sahiplik/
    // benzersizlik kontrolü YAPILMAZ — bu kontrol app.js'te cihaz taraflı
    // TOFU pinleme ile yapılıyor.
    if (req.method === 'POST' && action === 'issue') {
        const { username, userId, signingPublicKey, alg } = req.body;
        if (!username || !userId || !signingPublicKey) {
            return res.status(400).json({ error: 'Eksik parametreler.' });
        }
        if (typeof userId !== 'string' || typeof signingPublicKey !== 'string' || typeof username !== 'string') {
            return res.status(400).json({ error: 'Geçersiz parametre türü.' });
        }
        const safeAlg = (alg === 'ECDSA-P256') ? 'ECDSA-P256' : 'Ed25519';

        const identityPayload = JSON.stringify({
            username: username.trim(),
            userId:   userId,
            pubKey:   signingPublicKey,
            alg:      safeAlg,
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

    // 2. ADIM: Arkadaş, gelen kullanıcının pasaportunun gerçek (sunucu
    // tarafından imzalanmış, tahrif edilmemiş) olup olmadığını sorgular.
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
            if (Math.abs(now - data.timestamp) > 24 * 60 * 60 * 1000) {
                return res.status(401).json({ valid: false, error: 'Pasaport süresi dolmuş. Lütfen tekrar giriş yap.' });
            }
        }
        return res.status(200).json({ valid: true, identity: data });
    }
    return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
}
