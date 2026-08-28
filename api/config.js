const crypto = require('crypto');

// 🛡️ [KRİTİK FIX — Denetim Raporu Bulgu #2] Origin/Referer doğrulaması
// ═══════════════════════════════════════════════════════════════════
// Bu uç nokta önceden HERHANGİ BİR yerden (giriş yapılmasa bile, hatta
// uygulamayı hiç kullanmayan biri tarafından bile) çağrılabiliyor ve
// MQTT broker kimlik bilgilerini + o günün MQTT topic adını (artık ham
// TOPIC_ROTATE_SECRET değil — bkz. aşağıdaki ayrı not) döndürüyordu. Proje veritabanısız/serverless kalacağı için
// (bilinçli tasarım kararı) gerçek bir oturum/kimlik doğrulaması burada
// uygulanamıyor. Bunun yerine STATELESS (durumsuz) bir önlem olarak,
// isteğin GERÇEKTEN kendi sitenizden geldiğini Origin/Referer başlığı
// üzerinden doğruluyoruz. Tarayıcılar bu başlığı otomatik gönderdiği için
// normal kullanıcılar için hiçbir şey değişmez; sadece curl/script ile
// yapılan toplu/otomatik sızdırma denemelerini engeller.
//
// ⚠️ DÜRÜST SINIRLAMA: Origin/Referer başlıkları tarayıcı DIŞINDAN
// (curl, Postman, özel bir bot) serbestçe taklit edilebilir. Bu yüzden
// kararlı/hedefli bir saldırganı durdurmaz — veritabanısız kalındığı
// sürece buna karşı %100 koruma mümkün değil. Bu yalnızca "hiçbir engel
// olmadan otomatik toplu çekim" çıtasını kaldırır.
//
// KURULUM: Aşağıdaki ALLOWED_ORIGINS listesine kendi domain'(ler)inizi
// yazın (Vercel'in size verdiği *.vercel.app adresi ve varsa özel
// domain'iniz). Birden fazla origin listelenebilir.
const ALLOWED_ORIGINS = [
    'https://openchatt.vercel.app',   // ← kendi Vercel domain'inizle değiştirin
    // 'https://ozel-domaininiz.com',      // ← varsa özel domain'inizi buraya ekleyin (yorum satırını kaldırın)
];

// 🐛 [YENİ-SEC FIX] ÖNCEKİ HALİ `referer.startsWith(o)` kullanıyordu — bu,
// `https://openchatt.vercel.app.saldirgan.com` gibi bir adresin de
// (gerçek origin'in TAM OLARAK önek olarak içinde geçtiği herhangi bir
// domain) kontrolü GEÇMESİNE izin veriyordu, çünkü string düz metin
// olarak "başlıyor" test ediliyordu. Artık `URL` API'siyle referer'ın
// GERÇEK origin'i (şema+host+port) ayrıştırılıp allowlist'le BİREBİR
// karşılaştırılıyor — prefix/subdomain taklidi artık işe yaramaz.
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
    // Güvenlik: Sadece GET isteklerine izin ver
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Yalnızca GET istekleri kabul edilir.' });
    }

    // 🛡️ [KRİTİK FIX] Origin/Referer kontrolü — bkz. yukarıdaki açıklama.
    // Bu bloğu, aşağıdaki ortam değişkeni kontrolünden ÖNCE çalıştırıyoruz
    // ki yetkisiz isteklerde sunucu yapılandırması hakkında hiçbir bilgi
    // (hata mesajı dahil) sızdırılmasın.
    if (!isAllowedRequest(req)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    // 🛡️ KRİTİK KONTROL: Eğer Vercel panelindeki anahtar değişkenler eksikse hata döndür.
    // Böylece kodun içine asla sabit (hardcoded) bir şifre veya yedek adres yazmak zorunda kalmayız.
    if (!process.env.MQTT_BROKER_URL || !process.env.TOPIC_ROTATE_SECRET) {
        return res.status(500).json({
            error: 'Sunucu Yapılandırma Hatası: Gerekli ortam değişkenleri Vercel üzerinde tanımlanmamış!'
        });
    }

    // [MED-01] ve [HIGH-02] KESİN ÇÖZÜMÜ:
    // Bilgiler tamamen Vercel hafızasından okunur, GitHub reponuzda hiçbir iz kalmaz.
    //
    // 🛡️ [YENİ-SEC FIX] TOPIC_ROTATE_SECRET artık YANITA HİÇ KONMUYOR.
    // ÖNCEDEN: ham `topicSecret` client'a gönderiliyordu, client kendi
    // tarafında HMAC-SHA256(topicSecret, ROOM+bugününTarihi) hesaplayıp
    // günlük obfuscated MQTT topic adını türetiyordu (bkz. app.js
    // deriveObfuscatedTopic). Bu hesaplama TAMAMEN deterministik ve
    // sunucu-tarafında da yapılabilir olduğu için (ROOM zaten client
    // kaynağında herkese açık bir sabit, tarih de herkesçe bilinen bir
    // bilgi) — asıl SIRRI (TOPIC_ROTATE_SECRET) hiç ağa göndermeye gerek
    // yok, sadece SONUCU (o günün topic adı) göndermek yeterli.
    // ŞİMDİ: aynı hesaplama burada, sunucuda yapılıyor; client artık
    // `topicSecret`'i hiç görmüyor, sadece `todayTopic`'i alıp doğrudan
    // kullanıyor. MQTT/WebRTC/P2P mimarisine hiçbir etkisi yok — client
    // için nihai sonuç (hangi topic'e bağlanılacağı) birebir aynı.
    const ROOM = 'shareview_ultra_global_v15_nates'; // app.js'teki ROOM sabitiyle AYNI olmalı
    const dateSeed = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const topicHmac = crypto.createHmac('sha256', process.env.TOPIC_ROTATE_SECRET)
        .update(ROOM + dateSeed)
        .digest('hex');
    const todayTopic = 'sv/' + topicHmac.slice(0, 32);

    res.status(200).json({
        mqttBroker: process.env.MQTT_BROKER_URL,
        mqttUsername: process.env.MQTT_USERNAME || "", // Kullanıcı adı zorunlu değilse boş kalabilir
        mqttPassword: process.env.MQTT_PASSWORD || "", // Şifre zorunlu değilse boş kalabilir
        todayTopic: todayTopic
    });
}
