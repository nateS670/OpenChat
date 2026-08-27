// api/ice-servers.js (Vercel Serverless Node.js)

// 🛡️ [YENİ-SEC FIX] ÖNCEKİ HALİ: allowedOrigins kontrolü sadece CORS
// response header'ını (tarayıcının cevabı OKUYUP OKUYAMAYACAĞINI) belirliyordu
// — isteğin İŞLENMESİNİ hiç engellemiyordu. CORS, sadece TARAYICI JS'inin
// yanıtı okumasını kısıtlar; curl/script/bot gibi tarayıcı DIŞI bir çağrı
// Origin header'ı hiç göndermeden (veya sahte göndererek) bu uç noktayı
// çağırdığında, sunucu isteği YİNE DE işliyor ve METERED_API_KEY'inizle
// alınmış gerçek TURN kimlik bilgilerini herkese döndürüyordu — kotanız
// (ve olası TURN relay kötüye kullanımı) tamamen açıktı.
//
// Artık config.js'teki (bkz. Denetim Raporu Bulgu #2) AYNI, URL tabanlı
// Origin/Referer allowlist kontrolü burada da GERÇEKTEN REDDEDEREK
// uygulanıyor. Aynı dürüst sınırlama geçerli: tarayıcı dışı sahte
// Origin/Referer başlıkları taklit edilebilir, bu yüzden kararlı/hedefli
// bir saldırganı durdurmaz — ama otomatik/toplu kota tüketimini engeller.
const ALLOWED_ORIGINS = [
  'https://openchatt.vercel.app',
  'http://localhost:5500',        // VS Code Live Server için
  'http://127.0.0.1:5500',
  'http://localhost:3000'         // Eğer başka bir local sunucu kullanıyorsan
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

export default async function handler(req, res) {

  // 1. 🛡️ CORS header'ları — SADECE tarayıcıya hangi origin'in yanıtı
  // okuyabileceğini bildirir, tek başına bir güvenlik sınırı DEĞİLDİR
  // (bkz. aşağıdaki asıl reddetme kontrolü).
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://openchatt.vercel.app');
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Tarayıcıların ön kontrol (preflight) isteğini yanıtla
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 🛡️ Sadece GET kabul edilir.
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Yalnızca GET istekleri kabul edilir.' });
  }

  // 🛡️ [YENİ-SEC FIX — ASIL KORUMA] İsteği GERÇEKTEN reddet — CORS
  // header'ları burada yeterli değildi. Ortam değişkeni kontrolünden ÖNCE
  // çalıştırılıyor ki yetkisiz isteklerde yapılandırma bilgisi sızmasın.
  if (!isAllowedRequest(req)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // 2. 🛡️ SİSTEM KONTROLÜ: Eğer Vercel'e anahtar eklenmediyse sistemi çökertmek yerine güvenli hata ver
  if (!process.env.METERED_API_KEY) {
    return res.status(500).json({ error: "Sunucu Yapılandırma Hatası: METERED_API_KEY tanımlanmamış!" });
  }

  try {
    // 3. Metered API isteği
    const r = await fetch(
      `https://openchatt.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`,
      { cache: 'no-store' } // Eski şifrelerin önbellekte kalmasını engeller
    );

    if (!r.ok) {
      return res.status(500).json({ error: "Metered API yanıt vermedi veya anahtar geçersiz" });
    }

    const servers = await r.json();

    // 4. Vercel performans optimizasyonu (5 dakika boyunca Metered'a tekrar istek atıp kotayı harcamaz)
    res.setHeader('Cache-Control', 's-maxage=300');

    // Veriyi HTML/JS tarafına güvenle gönder
    return res.status(200).json(servers);

  } catch (error) {
    console.error("Serverless hata:", error);
    return res.status(500).json({ error: "Serverless fonksiyon hatası oluştu" });
  }
}
