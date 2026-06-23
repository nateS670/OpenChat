// api/ice-servers.js (Vercel Serverless Node.js)
export default async function handler(req, res) {
  
  // 1. 🛡️ KOTA KORUMASI (CORS Güvenliği): Sadece senin izin verdiğin siteler bu API'yi kullanabilsin
  const allowedOrigins = [
    'https://openchatt.vercel.app', 
    'http://localhost:5500',        // VS Code Live Server için
    'http://127.0.0.1:5500',
    'http://localhost:3000'         // Eğer başka bir local sunucu kullanıyorsan
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Eğer yabancı bir site istek atarsa sadece senin ana sitene izin ver, yabancıya kapıyı kapat
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

  // 2. 🛡️ SİSTEM KONTROLÜ: Eğer Vercel'e anahtar eklenmediyse sistemi çökertmek yerine güvenli hata ver
  if (!process.env.METERED_API_KEY) {
    return res.status(500).json({ error: "Sunucu Yapılandırma Hatası: METERED_API_KEY tanımlanmamış!" });
  }

  try {
    // 3. Claude'un kurduğu temiz Metered API isteği
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
