// 🛡️ [FIX-1] Vercel Edge Middleware — /api/config, /api/bootstrap-key,
// /api/identity, /api/auth, /api/ice-servers uçlarına IP başına dakikalık
// rate limit uygular.
//
// ⚠️ NOT: Bu sürüm HİÇBİR npm paketine ihtiyaç duymaz (Upstash kaldırıldı) —
// çünkü @upstash/ratelimit ve @upstash/redis, `npm install` ile projeye
// eklenip Vercel build'i bunları bundle etmeden Edge Runtime'da
// çalışmıyor ("referencing unsupported modules" hatası buradan geliyordu).
// Bu haliyle dosyayı GitHub'a yapıştırmanız yeterli, ekstra kurulum YOK.
//
// TRADE-OFF: Rate limit sayaçları bellekte (instance başına) tutulur.
// Yani (a) Vercel her cold start'ta veya farklı bir edge bölgesine
// yönlendirmede sayaç sıfırlanabilir, (b) çok yüksek trafikte %100 kesin
// bir garanti vermez. Yine de mevcut durumdan (SIFIR limit) çok daha
// iyidir ve script/bot spam'ini büyük ölçüde engeller. İleride daha güçlü
// bir garantiye ihtiyaç duyarsanız Upstash Redis'e geçebiliriz — o zaman
// package.json'a paketleri gerçekten eklemeniz (npm install) ve Vercel'de
// Upstash entegrasyonunu kurmanız gerekir.
//
// KONUM: Proje kökü — package.json, vercel.json ve api/ klasörüyle AYNI
// SEVİYEDE. api/ klasörünün İÇİNE KOYMAYIN.

export const config = {
  matcher: ['/api/config', '/api/bootstrap-key', '/api/identity', '/api/auth', '/api/ice-servers'],
};

// IP başına dakikada izin verilen istek sayısı.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

// Bellek-içi sayaç. Edge instance'ı yeniden başlayınca sıfırlanır — bu
// beklenen ve kabul edilebilir bir trade-off (yukarıdaki nota bakın).
const _hits = new Map();

function isAllowed(ip) {
  const now = Date.now();
  const arr = (_hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  _hits.set(ip, arr);
  // Map'in sınırsız büyümesini önlemek için basit bir temizlik:
  if (_hits.size > 5000) {
    const cutoff = now - WINDOW_MS;
    for (const [key, times] of _hits) {
      if (!times.some((t) => t > cutoff)) _hits.delete(key);
    }
  }
  return arr.length <= MAX_REQUESTS;
}

export default function middleware(request) {
  // 🛡️ Basit origin kontrolü — spoof edilebilir ama savunma derinliği katar.
  // ALLOWED_ORIGINS env'i tanımlıysa (virgülle ayrılmış liste), listede
  // olmayan Origin header'lı istekler reddedilir. Tanımlı değilse bu
  // kontrol devre dışı kalır (varsayılan: kapalı, açmak isterseniz Vercel'e
  // ALLOWED_ORIGINS env'i ekleyin).
  const origin = request.headers.get('origin');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ error: 'forbidden_origin' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  if (!isAllowed(ip)) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: 'Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.' }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
    );
  }

  // Limit aşılmadıysa devam et — isteği ilgili api/ fonksiyonuna geçir.
  return undefined;
}
