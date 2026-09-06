import crypto from 'crypto';
import { kv } from '@vercel/kv';

// 🛡️ [KRİTİK FIX — Güvenlik Araştırmacısı Bulgu #1] ÖNCEKİ HALİ: action=issue
// HİÇBİR kimlik doğrulaması yapmıyordu — herkes, herhangi bir username/userId
// için, kendi ürettiği bir public key ile geçerli, sunucu-imzalı bir pasaport
// alabiliyordu. Saldırgan {username:'victim', userId:'victim',
// signingPublicKey:<kendi anahtarı>} gönderip 'victim' kimliğine bürünen
// geçerli bir pasaport elde edebiliyordu.
//
// NEDEN Origin/Referer/CORS/rate-limit/client-side validation İLE
// KAPATILAMAZ: Bunların hiçbiri "bu userId gerçekten bu isteği atana mı ait"
// sorusuna cevap vermez — sadece isteğin nereden geldiğini kısıtlar, KİMİN
// GÖNDERDİĞİNİ değil. Saldırgan zaten kendi tarayıcısından, meşru bir origin
// ile bu isteği atabilir.
//
// NEDEN CHALLENGE-RESPONSE (imzalanmış public key doğrulaması) DA YETERSİZ:
// Bu sadece "gönderen, gönderdiği signingPublicKey'in özel anahtarına sahip
// mi" sorusuna cevap verir. Saldırgan KENDİ ürettiği bir anahtar çifti
// gönderdiği için bu challenge'ı da sorunsuzca imzalar — kanıtlamamız
// gereken şey "bu userId'nin sahibi bu mu" sorusu, "bu anahtarın sahibi bu
// mu" değil. İkisi farklı sorular.
//
// GERÇEK ÇÖZÜM: Mimari şifreyi sunucuya hiç göndermediği için ("Şifren
// cihazında saklanır") sunucu şifreyi doğrulayamaz. Bunun yerine TOFU
// (Trust On First Use) sabitleme uyguluyoruz: bir username için İLK kez
// pasaport verildiğinde, o public key Vercel KV'de KALICI olarak sabitlenir.
// Sonraki HER istek, AYNI public key ile gelmek ZORUNDA — aksi halde
// reddedilir. Meşru kullanıcı doğru şifreyle her girişte (istemci tarafı
// PBKDF2 türetimi sayesinde) hep AYNI anahtarı üretir, yani bu onu hiç
// etkilemez; şifreyi BİLMEYEN biri artık farklı bir anahtarla bu username'i
// ele geçiremez.
//
// KURULUM:
//   1) `npm install @vercel/kv`
//   2) Vercel Dashboard → Storage → bir Redis/KV veritabanı oluşturup
//      projenize bağlayın (gerekli env değişkenlerini otomatik ekler).
//   3) Bu dosyayı `api/identity.js` ile değiştirip redeploy edin.
//
// BİLİNEN SINIR (kasıtlı, kullanıcıyla üzerinde anlaşıldı): Aynı hesaba
// birden fazla cihazdan giriş desteklenmiyor — ikinci cihaz farklı bir
// rastgele anahtar üreteceği için 409 ile reddedilir. Tek-cihaz modeli
// bilinçli bir tercih olarak kabul edildi.
export default async function handler(req, res) {
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
        if (typeof userId !== 'string' || typeof signingPublicKey !== 'string' || typeof username !== 'string') {
            return res.status(400).json({ error: 'Geçersiz parametre türü.' });
        }
        const safeAlg = (alg === 'ECDSA-P256') ? 'ECDSA-P256' : 'Ed25519';

        // 🛡️ [KRİTİK FIX] TOFU sabitleme — bkz. dosya başındaki ayrıntılı not.
        const pinKey = `identity-pin:${userId.toLowerCase()}`;
        const pinRecord = { pubKey: signingPublicKey, alg: safeAlg, pinnedAt: Date.now() };

        // Atomik "sadece anahtar yoksa yaz" — iki eşzamanlı isteğin aynı
        // yeni kullanıcı adını birbirinin üzerine yazmasını (race condition)
        // önler.
        let claimed;
        try {
            claimed = await kv.set(pinKey, pinRecord, { nx: true });
        } catch (e) {
            return res.status(500).json({ error: 'Kimlik sabitleme deposuna erişilemedi.' });
        }

        if (claimed === null) {
            // Bu userId için zaten sabitlenmiş bir kayıt var — eşleşiyor mu bak.
            let existingPin;
            try {
                existingPin = await kv.get(pinKey);
            } catch (e) {
                return res.status(500).json({ error: 'Kimlik sabitleme deposuna erişilemedi.' });
            }
            if (!existingPin || existingPin.pubKey !== signingPublicKey) {
                // 🛡️ Tam olarak güvenlik araştırmacısının bulduğu senaryo
                // burada engelleniyor: farklı bir anahtar — bu userId zaten
                // başka bir anahtara sabitlenmiş. Şifreyi bilmeyen biri bu
                // kullanıcı adına bürünmeye çalışıyor olabilir.
                return res.status(409).json({
                    error: 'Bu kullanıcı adı için farklı bir kimlik anahtarı zaten kayıtlı. Şifrenizi yanlış girmiş olabilirsiniz.'
                });
            }
            // Anahtar eşleşiyor — meşru kullanıcı, normal şekilde devam.
        }

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
