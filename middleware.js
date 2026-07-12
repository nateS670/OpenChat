// 🛡️ [FIX-1] Vercel Edge Middleware — /api/config, /api/bootstrap-key,
// /api/identity uçlarına IP başına dakikalık rate limit uygular.
//
// Framework-agnostic: Next.js KULLANMADIĞINIZ için (app.js vanilla JS) burada
// next/server yerine standart Web Response/Request API'leri kullanılıyor —
// bu, düz bir Vercel projesinde (Next.js olmadan) da çalışır.
//
// KURULUM:
//   npm i @upstash/ratelimit @upstash/redis
//   Vercel Dashboard → Storage/Marketplace → Upstash entegrasyonunu ekleyin;
//   bu, UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN env değişkenlerini
//   otomatik olarak projenize ekler.
//
// KONUM: Bu dosya PROJE KÖKÜNE gider — package.json, vercel.json ve api/
// klasörüyle AYNI SEVİYEDE. api/ klasörünün İÇİNE KOYMAYIN.
//
//   your-project/
//   ├── api/
//   │   ├── config.js
//   │   ├── bootstrap-key.js
//   │   └── identity.js
//   ├── middleware.js      <-- BURAYA
//   ├── vercel.json         <-- BURAYA (proje kökü)
//   ├── package.json
//   └── ... (index.html, app.js, vb. statik dosyalarınız)

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const config = {
  // 🛡️ [FIX-1 GÜNCELLEME] auth.js (muhtemelen login/şifre kontrolü — brute-force
  // riski) ve ice-servers.js (muhtemelen TURN kimlik bilgisi — maliyet riski)
  // de eklendi. Bu ikisi login/TURN dışında bir işe yarıyorsa bana söyleyin,
  // matcher'ı ona göre daraltalım/genişletelim.
  matcher: ['/api/config', '/api/bootstrap-key', '/api/identity', '/api/auth', '/api/ice-servers'],
};

let ratelimit = null;
let authRatelimit = null; // 🛡️ login için ayrı, daha sıkı limit (brute-force koruması)
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    // IP başına 20 istek / 60 saniye.
    limiter: Ratelimit.slidingWindow(20, '60 s'),
    analytics: true,
    prefix: 'ratelimit:sensitive-api',
  });
  // 🛡️ /api/auth (login) için: IP başına 15 dakikada 5 deneme. Genel API
  // limitinden çok daha sıkı — amaç kota korumak değil, şifre denemesini
  // (brute-force) yavaşlatmak. Meşru bir kullanıcı 5 denemede giremiyorsa
  // zaten şifresini unutmuştur; bu limit onu fazla rahatsız etmez.
  authRatelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    analytics: true,
    prefix: 'ratelimit:auth-login',
  });
}

// Upstash env'leri henüz tanımlı değilse (örn. ilk kurulum sırasında) devre
// dışı kalmak yerine basit bellek-içi bir limitleyiciye düşer. NOT: Bu,
// serverless/edge instance başına çalışır, tam garanti vermez — üretimde
// mutlaka Upstash env'lerini tanımlayın.
const _memHits = new Map();
function memoryLimit(ip, strict = false) {
  const now = Date.now();
  const windowMs = strict ? 15 * 60_000 : 60_000;
  const max = strict ? 5 : 20;
  const key = strict ? `auth:${ip}` : ip;
  const arr = (_memHits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  _memHits.set(key, arr);
  return arr.length <= max;
}

export default async function middleware(request) {
  // 🛡️ [FIX-1] Basit origin kontrolü — spoof edilebilir ama savunma derinliği
  // katar. ALLOWED_ORIGINS env'i tanımlıysa (virgülle ayrılmış liste),
  // listede olmayan Origin header'lı istekler reddedilir.
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

  const isAuthPath = new URL(request.url).pathname === '/api/auth';
  const limiter = isAuthPath ? authRatelimit : ratelimit;
  const allowed = limiter ? (await limiter.limit(ip)).success : memoryLimit(ip, isAuthPath);

  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: 'Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin.' }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
    );
  }

  // İstek limiti aşmadıysa normal akışa devam et (isteği api/ fonksiyonuna geçir).
  return undefined; // Vercel Edge Middleware'de undefined/void dönmek = devam et
}
