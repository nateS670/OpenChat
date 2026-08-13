// 🛡️ [KRİTİK FIX — Denetim Raporu Bulgu #2] Origin/Referer doğrulaması
// ═══════════════════════════════════════════════════════════════════
// Bu uç nokta önceden HERHANGİ BİR yerden (giriş yapılmasa bile, hatta
// uygulamayı hiç kullanmayan biri tarafından bile) çağrılabiliyor ve
// MQTT broker kimlik bilgilerini + "gizli" oda sırrını (TOPIC_ROTATE_SECRET)
// doğrudan döndürüyordu. Proje veritabanısız/serverless kalacağı için
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

function isAllowedRequest(req) {
    const origin  = req.headers['origin'];
    const referer = req.headers['referer'] || req.headers['referrer'];
    if (origin && ALLOWED_ORIGINS.includes(origin)) return true;
    if (referer && ALLOWED_ORIGINS.some(o => referer.startsWith(o))) return true;
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
    res.status(200).json({
        mqttBroker: process.env.MQTT_BROKER_URL,
        mqttUsername: process.env.MQTT_USERNAME || "", // Kullanıcı adı zorunlu değilse boş kalabilir
        mqttPassword: process.env.MQTT_PASSWORD || "", // Şifre zorunlu değilse boş kalabilir
        topicSecret: process.env.TOPIC_ROTATE_SECRET
    });
}
