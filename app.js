/* ================================================================
   openchat — Dark Theme Edition
   ================================================================ */

// ── Push Notification kaldırıldı: serverless yapıya dönüldü ──────
async function initPushNotifications(){ /* no-op: kaldırıldı */ }

// 🛡️ [HIGH-02]/[MED-01] BROKER artık burada SABİT DEĞİL — bkz. loadServerConfig()
// (aşağıda) ve connectNetwork(): broker adresi + kimlik bilgileri MQTT
// bağlantısı kurulmadan hemen önce /api/config'ten asenkron olarak alınır.
const ROOM    = 'shareview_ultra_global_v15_nates';
const DB_KEY  = 'shareview_ultra_localdb_v6';
// 🛡️ [KRİTİK-V3-H1] Mesaj içeriği ARTIK DB_KEY (plaintext) içinde DEĞİL.
// Ayrı, her zaman şifreli bir depoda tutulur. Anahtar yoksa hiç yazılmaz.
const MSG_KEY = 'shareview_ultra_msgs_v1';
let _decryptedMsgCache = {}; // bellekteki çözülmüş mesajlar — getDB()/saveDB() buradan okur/yazar
const APP_VERSION = '3.5.0';
const SES_KEY = 'shareview_ultra_session_v6';
const ACC_KEY = 'sv_accounts';
const THEME_KEY = 'sv_theme'; // dark theme preference

// ══════════════════════════════════════════════════════════════════
//  🔒 CONSOLE KORUMASI — Production'da console.log/warn tamamen
//  kapatılır. Hassas bilgiler (ICE config, TURN URL, AES key vb.)
//  konsolda görünmez. Sadece console.error aktif kalır.
//  🛡️ [SAST-8 FIX] Bu blok, arkadaşlık isteği hata ayıklaması için
//  geçici olarak devre dışı bırakılmıştı — o sorun artık çözüldü
//  (kimlik doğrulama + friend_accept yönlendirme düzeltmeleri), bu
//  yüzden koruma yeniden etkinleştirildi.
// ══════════════════════════════════════════════════════════════════
(()=>{
  if(location.hostname !== 'localhost'){
    ['log','warn','info','debug'].forEach(m => console[m] = () => {});
  }
})();

const $   = id => document.getElementById(id);
// Null-safe element setter — null element için hata fırlatmaz
const $set = (id, prop, val) => { const el=$(id); if(el) el[prop]=val; return el; };
const $on  = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev,fn); return el; };
// 🛡️ [MED-06] Kriptografik olarak güvenli ID üretimi — Math.random() tahmin edilebilirdi
const uid = () => {
  const arr = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(arr, b => b.toString(36).padStart(2,'0')).join('').slice(0,9);
};
const gt  = () => new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
const now = () => Date.now();

// ══════════════════════════════════════════════════════════════════
//  🔐 ŞİFRE GÜVENLİK MOTORU v2.0
//  PBKDF2-SHA256 · Injection Koruması · Session Persistence
// ══════════════════════════════════════════════════════════════════

const PW_STORE_KEY   = 'sv_pw_store_v1';
const SESSION_AUTH   = 'sv_session_auth'; // sessionStorage — sekme kapanınca silinir

function _hexToBytes(hex){ return new Uint8Array(hex.match(/.{2}/g).map(b=>parseInt(b,16))); }

// ══════════════════════════════════════════════════════════════════
// 🛡️ [MED-04] Şifreli localStorage Sarmalayıcısı
// Mesaj geçmişi ve kullanıcı verisi AES-GCM ile şifrelenir.
// Anahtar: kullanıcı şifresinden PBKDF2 ile türetilir (login sonrası).
// XSS veya paylaşılan cihazda ham veri okunamaz.
// ══════════════════════════════════════════════════════════════════
let _lsEncKey = null; // CryptoKey — başarılı login sonrası set edilir

async function _setLsEncKey(password, saltHex){
  try{
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), {name:'PBKDF2'}, false, ['deriveKey']
    );
    // 🛡️ [MED-03] extractable:true — sessionStorage'a aktarılabilsin diye.
    // Not: XSS zaten çalışan kodun anahtarına erişebilirdi (_lsGetDecrypted çağırarak);
    // extractable olması tehdit modelini değiştirmiyor, sadece F5/reload sonrası
    // şifreyi tekrar sormamayı mümkün kılıyor.
    _lsEncKey = await crypto.subtle.deriveKey(
      {name:'PBKDF2', salt:_hexToBytes(saltHex), iterations:100000, hash:'SHA-256'},
      km, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']
    );
    // 🛡️ [MED-03] sessionStorage'a geçici aktar (sekme kapanınca otomatik silinir)
    // Bu, aynı sekmede F5/yenileme sonrası şifreyi tekrar sormayı önler.
    try{
      const raw = await crypto.subtle.exportKey('raw', _lsEncKey);
      sessionStorage.setItem('_sk', _ab2b64(raw));
    }catch(e){}
    // 🛡️ [KRİTİK-V3-H1] Anahtar hazır olur olmaz şifreli mesajları belleğe çöz
    await _loadEncryptedMessages();
    // 🛡️ [SAST-3 FIX] Outbox'ı da artık hazır olan anahtarla yeniden oku/birleştir
    await _reloadOutboxAfterKeyReady();
  }catch(e){ _lsEncKey = null; }
}

// 🛡️ [MED-03] Sayfa yenilemesinde (aynı sekme) anahtarı sessionStorage'dan geri yükle
async function _tryRestoreEncKeyFromSession(){
  try{
    const sk = sessionStorage.getItem('_sk');
    if(!sk) return false;
    const raw = _b642ab(sk);
    _lsEncKey = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, true, ['encrypt','decrypt']);
    await _loadEncryptedMessages();
    // 🛡️ [SAST-3 FIX] Outbox'ı da artık hazır olan anahtarla yeniden oku/birleştir
    await _reloadOutboxAfterKeyReady();
    return true;
  }catch(e){
    sessionStorage.removeItem('_sk');
    _lsEncKey = null;
    return false;
  }
}

// ── localStorage ↔ ArrayBuffer base64 yardımcıları ──────────────
function _ab2b64(ab){
  const bytes = new Uint8Array(ab);
  let s = '';
  for(let i=0; i<bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function _b642ab(b64){
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for(let i=0; i<s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function _lsSetEncrypted(key, value){
  if(!_lsEncKey){ localStorage.setItem(key, value); return; }
  try{
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      {name:'AES-GCM', iv}, _lsEncKey, new TextEncoder().encode(value)
    );
    localStorage.setItem(key, JSON.stringify({
      _enc: 1,
      iv:   _ab2b64(iv.buffer),
      ct:   _ab2b64(ct)
    }));
  }catch(e){ localStorage.setItem(key, value); }
}

async function _lsGetDecrypted(key){
  const raw = localStorage.getItem(key);
  if(!raw || !_lsEncKey) return raw;
  try{
    const p = JSON.parse(raw);
    if(!p || p._enc !== 1) return raw;
    const iv = _b642ab(p.iv);
    const ct = _b642ab(p.ct);
    const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, _lsEncKey, ct);
    return new TextDecoder().decode(pt);
  }catch(e){ return raw; }
}

// ══════════════════════════════════════════════════════════════════
// 🛡️ [KRİTİK-V3-H1] Mesaj geçmişi yükleme + tek seferlik migration
// Önceki sürümlerde mesajlar DB_KEY içinde düz metin tutuluyordu.
// Anahtar ilk kez hazır olduğunda, eski düz metin mesajları bulup
// şifreli MSG_KEY deposuna taşır ve DB_KEY'den siler.
// ══════════════════════════════════════════════════════════════════
async function _loadEncryptedMessages(){
  try{
    if(_lsEncKey && !localStorage.getItem(MSG_KEY)){
      try{
        const legacyRaw = localStorage.getItem(DB_KEY);
        if(legacyRaw){
          const legacy = JSON.parse(legacyRaw);
          if(legacy && legacy.messages && Object.keys(legacy.messages).length>0){
            await _lsSetEncrypted(MSG_KEY, JSON.stringify(legacy.messages));
            delete legacy.messages;
            localStorage.setItem(DB_KEY, JSON.stringify(legacy));
            console.log('[SEC] Eski düz metin mesajlar şifrelenip taşındı ✅');
          }
        }
      }catch(e){ console.error('[SEC] Migration hatası:', e); }
    }

    const raw = await _lsGetDecrypted(MSG_KEY);
    if(!raw){ _decryptedMsgCache = {}; }
    else{
      try{ _decryptedMsgCache = JSON.parse(raw) || {}; }
      catch(e){ _decryptedMsgCache = {}; }
    }
    // Açık bir sohbet varsa, yeni çözülen mesajlarla yeniden render et
    try{
      if(typeof renderChat==='function' && typeof chatId!=='undefined' && chatId) renderChat();
    }catch(e){}
  }catch(e){
    _decryptedMsgCache = {};
  }
}

// ── Injection / XSS Koruması ──────────────────────────────────────
// Kullanıcı adı: sadece [a-zA-Z0-9_] — SQL/XSS karakterleri imkânsız
const _SAFE_USERNAME = /^[a-zA-Z0-9_]{3,16}$/;
// Şifre: kontrol karakterleri ve null byte temizle, uzunluk sınırı
function _sanitizePassword(pw){
  if(typeof pw !== 'string') return '';
  // Null byte, zero-width chars, control chars temizle
  return pw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\ufeff]/g,'').slice(0,64);
}
function _sanitizeUsername(u){
  if(typeof u !== 'string') return '';
  // Sadece izin verilen karakterleri tut, rest = boş
  return u.replace(/[^a-zA-Z0-9_]/g,'').slice(0,16);
}
function _validateUsername(u){ return _SAFE_USERNAME.test(u); }
function _validatePassword(p){ return typeof p==='string' && p.length>=6 && p.length<=64; }

// ── LocalStorage şifre deposu ─────────────────────────────────────
function _getPwStore(){ try{ return JSON.parse(localStorage.getItem(PW_STORE_KEY)||'{}'); }catch(e){ return {}; } }
function _setPwStore(s){ localStorage.setItem(PW_STORE_KEY, JSON.stringify(s)); }

// ── Salt üretimi ──────────────────────────────────────────────────
function _genSalt(){
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── PBKDF2-SHA256 — 310.000 iterasyon ────────────────────────────
async function _pbkdf2Hash(password, saltHex){
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(password), {name:'PBKDF2'}, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt:_hexToBytes(saltHex), iterations:310_000, hash:'SHA-256' },
    keyMat, 256
  );
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── Timing-safe karşılaştırma ─────────────────────────────────────
function _safeCompare(a, b){
  if(a.length !== b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Şifre kaydet ──────────────────────────────────────────────────
async function pwSave(user_id, password){
  const cleanPw = _sanitizePassword(password);
  if(!_validatePassword(cleanPw)) throw new Error('Geçersiz şifre');
  const salt = _genSalt();
  const hash = await _pbkdf2Hash(cleanPw, salt);
  const store = _getPwStore();
  store[_sanitizeUsername(user_id).toLowerCase()] = { salt, hash };
  _setPwStore(store);
  // 🛡️ [KRİTİK-V3-H1] Yeni kayıt/şifre belirleme sırasında da anahtarı türet
  // ve AWAIT et — eskiden bu hiç çağrılmıyordu, yeni kullanıcılarda şifreleme
  // hiç başlamıyordu.
  await _setLsEncKey(cleanPw + salt, salt);
}

// ── Şifre doğrula ─────────────────────────────────────────────────
async function pwVerify(user_id, password){
  const cleanPw = _sanitizePassword(password);
  const store = _getPwStore();
  const entry = store[_sanitizeUsername(user_id).toLowerCase()];
  if(!entry) return null;
  if(!_validatePassword(cleanPw)) return false;
  const hash = await _pbkdf2Hash(cleanPw, entry.salt);
  const ok = _safeCompare(hash, entry.hash);
  // 🛡️ [KRİTİK-V3-H1] Başarılı girişte anahtarı AWAIT ederek türet —
  // eskiden fire-and-forget'ti (.catch ile, await edilmeden), bu yüzden
  // çağıran kod anahtar hazır olmadan UI'ı açabiliyordu.
  if(ok) await _setLsEncKey(cleanPw + entry.salt, entry.salt);
  return ok;
}

// ── Şifre varlık kontrolü ─────────────────────────────────────────
function pwExists(user_id){ return !!((_getPwStore())[_sanitizeUsername(user_id).toLowerCase()]); }

// ── SESSION PERSISTENCE ───────────────────────────────────────────
// localStorage: tarayıcı kapatılsa bile oturum kalır, tekrar giriş gerekmez.
function sessionMark(user_id){
  localStorage.setItem(SESSION_AUTH, JSON.stringify({u:user_id.toLowerCase(), t:Date.now()}));
}
// 🛡️ [MED-05] Oturum 7 günden eski ise otomatik sonlandır
const _SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
function sessionGet(){
  try{
    const s=JSON.parse(localStorage.getItem(SESSION_AUTH)||'null');
    if(!s) return null;
    if(Date.now() - s.t > _SESSION_TTL){ sessionClear(); return null; }
    return s;
  }catch(e){ return null; }
}
function sessionClear(){
  localStorage.removeItem(SESSION_AUTH);
  localStorage.removeItem(SES_KEY);
  // 🛡️ [KRİTİK-V3-H1] Çıkışta şifreleme anahtarını da temizle — aynı sekmede
  // farklı bir kullanıcı giriş yaparsa önceki kullanıcının anahtarı sızmasın.
  _lsEncKey = null;
  _decryptedMsgCache = {};
  try{ sessionStorage.removeItem('_sk'); }catch(e){}
}

// ── Şifre göster/gizle ────────────────────────────────────────────
window.togglePwVis=()=>{
  const inp=$('authPassword');
  const btn=$('pwToggleBtn');
  if(inp.type==='password'){ inp.type='text'; btn.textContent='🙈'; }
  else { inp.type='password'; btn.textContent='👁'; }
};

// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════

// ── 1. WHITELIST — İzin Verilen ID Formatı ────────────────────────
// Kullanıcı adı: 3-24 karakter, harf/rakam/alt çizgi/tire
// Token: sv_ ile başlayan 11 karakter alphanumeric
const WL_USERNAME = /^[a-zA-Z0-9_\-]{3,24}$/;
const WL_TOKEN    = /^T-[A-Z0-9]{9}$/;

function isWhitelisted(user_id, token){
  if(!user_id || !WL_USERNAME.test(user_id)) return false;
  if(token && !WL_TOKEN.test(token)) return false;
  return true;
}

// ── 2. ECDH KEY EXCHANGE + AES-256-GCM ŞIFRELEME ──────────────────
// 🛡️ [HIGH-01] Sabit kodlanmış AES anahtarı KALDIRILDI.
//    Her oturum için ECDH (P-256) anahtar çifti üretilir.
//    Özel mesajlar: per-peer ECDH-derived AES-256-GCM anahtarıyla şifrelenir.
//    Broadcast mesajlar: günlük dönen, kodda SABİT OLMAYAN bootstrap anahtarıyla şifrelenir.
//
// 🛡️ [HIGH-07] Şifreleme başarısız olursa plaintext gönderilmez — hata fırlatılır.

// --- ECDH Session Keypair (her tarayıcı oturumunda yeni üretilir) ---
let _sessionKeyPair = null;
const _peerPublicKeyCache = {}; // user_id → JWK string
const _peerAESKeyCache    = {}; // user_id → CryptoKey (ECDH-derived)

(async function _initECDH(){
  try{
    _sessionKeyPair = await crypto.subtle.generateKey(
      {name:'ECDH', namedCurve:'P-256'}, true, ['deriveKey']
    );
  }catch(e){ console.error('[SEC] ECDH başlatma hatası:', e); }
})();

// ══════════════════════════════════════════════════════════════════
//  🔐 KİMLİK PASAPORTU — Ed25519 + Sunucu HMAC-SHA256 doğrulaması
//  [HIGH-03] / [YENİ-H2] / [HIGH-04]
//
//  Artık bir presence mesajındaki "from" alanına kör güvenilmiyor.
//  Oturum başına bir Ed25519 imza anahtar çifti üretilir; genel anahtar
//  POST /api/identity?action=issue ile sunucuya gönderilir. Sunucu
//  (Vercel Env: CHAT_SECRET_KEY) kullanıcı adı + id + genel anahtarı
//  HMAC-SHA256 ile imzalayıp bir "pasaport" döner. Bu pasaport + presence
//  mesajının kendisinin Ed25519 imzası, her sendPresence() ile birlikte
//  yayınlanır. Bir peer'dan presence alındığında, WebRTC (DataChannel)
//  bağlantısı kurulmadan ÖNCE pasaport POST /api/identity?action=verify
//  ile sunucuya doğrulatılır VE presence imzası yerel olarak pasaportun
//  içindeki genel anahtarla doğrulanır (özel anahtara sahip olmayan biri
//  çalıntı bir pasaportu yeniden oynatamaz). Doğrulama başarısız olursa
//  (tahrif edilmiş/sahte kimlik, olası MITM) o peer ile ASLA WebRTC
//  bağlantısı kurulmaz.
//
//  ⚠️ Beklenen sunucu sözleşmesi (uçlarınızın gövdesiyle EŞLEŞTİRİN):
//    POST /api/identity?action=issue   body: {username, userId, signingPublicKey}
//      → { passport: {username, userId, signingPublicKey, issuedAt, ...}, signature }
//    POST /api/identity?action=verify  body: {passport, signature}
//      → { valid: true|false }
//  signingPublicKey/signature alanları Base64 (ham bayt) olarak kodlanır.
// ══════════════════════════════════════════════════════════════════

let _idKeyPair       = null;  // Ed25519/ECDSA CryptoKeyPair (oturuma özel, private key asla ağa çıkmaz)
let _myPassport       = null; // sunucudan alınan { passport, signature }
let _passportPromise  = null;
let _sigAlgName       = null; // 'Ed25519' | 'ECDSA-P256' — bu oturumda hangi imza algoritması kullanılıyor
const _verifiedPeers        = new Set(); // sunucu+yerel olarak doğrulanmış user_id'ler (bu oturum)
const _lastPresenceIdentity = {};        // user_id → son alınan {passport,passportSig,nonce,presenceSig}
const _verifyCache          = {};        // tekrar tekrar /api/identity sorgulamamak için

// 🛡️ [FIX] Ed25519, WebCrypto'da HER tarayıcıda yok: Safari/iOS 17'den,
// Firefox 129'dan, Chrome ise ANCAK 137'den (Mayıs 2025) itibaren destekliyor.
// Güncellenmemiş/eski Chrome, eski Android WebView, iOS 16 ve altı, Firefox
// 128 ve altı gibi durumlarda generateKey burada İSTİSNA fırlatıyordu →
// _ensureIdentityPassport() hata veriyordu → presence kimliksiz gidiyordu →
// hiçbir peer bu kullanıcıyla DataChannel kurmuyordu (bkz. _ensurePeerVerified)
// → mesajlar outbox'ta sonsuza dek birikiyordu. ECDSA P-256, WebCrypto'da
// 2014'ten beri TÜM tarayıcılarda var; Ed25519 yoksa ona düşülür.
async function _ensureIdKeyPair(){
  if(_idKeyPair) return _idKeyPair;
  if(!crypto.subtle || !crypto.subtle.generateKey){
    throw new Error('[SEC] WebCrypto bu tarayıcıda kullanılamıyor');
  }
  try{
    _idKeyPair = await crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify']);
    _sigAlgName = 'Ed25519';
  }catch(e){
    console.warn('[SEC] Ed25519 desteklenmiyor, ECDSA P-256 imza anahtarına düşülüyor:', e);
    _idKeyPair = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify']);
    _sigAlgName = 'ECDSA-P256';
  }
  return _idKeyPair;
}

async function _exportEdPubB64(){
  const kp = await _ensureIdKeyPair();
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return _b64(raw);
}

// Sunucudan imzalı pasaport iste — oturum başına bir kez, sonra önbellekten dön.
// 🛡️ Başarısız olursa GÜVENSİZ bir fallback'e düşülmez: pasaportsuz presence
// gönderilir ve karşı taraflar bu durumda bizimle WebRTC bağlantısı KURMAZ.
async function _ensureIdentityPassport(){
  if(_myPassport) return _myPassport;
  if(_passportPromise) return _passportPromise;
  _passportPromise = (async () => {
    if(!ME) throw new Error('[SEC] Pasaport için önce giriş yapılmalı');
    const pub = await _exportEdPubB64();
    const r = await fetch('/api/identity?action=issue', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      // 🛡️ [FIX] 'alg' eklendi — sunucu bunu pasaportun içine geçirmeli
      // (passport objesine kopyalamalı) ki peer'lar doğrulama sırasında
      // hangi WebCrypto algoritmasını kullanacağını bilsin. Sunucu bu alanı
      // yok sayarsa eski davranışa (her zaman Ed25519) geri döner — bu da
      // ECDSA'ya düşmüş kullanıcılar için doğrulamanın sessizce başarısız
      // olmasına yol açar, bkz. _verifyPeerPassport.
      body: JSON.stringify({ username: ME.user_id, userId: ME.user_id, signingPublicKey: pub, alg: _sigAlgName }),
      signal: AbortSignal.timeout(6000)
    });
    if(!r.ok) throw new Error('[SEC] /api/identity?action=issue HTTP '+r.status);
    const data = await r.json();
    if(!data || !data.passport || typeof data.signature !== 'string' || !data.signature){
      throw new Error('[SEC] /api/identity?action=issue beklenmeyen yanıt biçimi');
    }
    _myPassport = data;
    return _myPassport;
  })();
  try{
    return await _passportPromise;
  }catch(e){
    _passportPromise = null; // sıradaki çağrı tekrar denesin
    console.error('[SEC] Kimlik pasaportu alınamadı:', e);
    throw e;
  }
}

// Presence mesajının KENDİSİNİ Ed25519 ile imzala. Tek seferlik bir nonce
// imzalanır — böylece çalıntı bir pasaportu kopyalayan biri, özel anahtara
// sahip olmadığı için kendi presence mesajını geçerli şekilde imzalayamaz.
async function _signPresenceNonce(nonce){
  const kp = await _ensureIdKeyPair();
  const enc = new TextEncoder().encode(ME.user_id + '|' + nonce);
  // 🛡️ [FIX] ECDSA, Ed25519'dan farklı olarak sign() çağrısında hash belirtilmesini ister.
  const signAlg = _sigAlgName === 'ECDSA-P256' ? {name:'ECDSA', hash:'SHA-256'} : 'Ed25519';
  const sig = await crypto.subtle.sign(signAlg, kp.privateKey, enc);
  return _b64(sig);
}

// Bir peer'ın pasaportunu (a) sunucuda doğrula, (b) presence imzasını
// pasaport içindeki genel anahtarla yerel olarak doğrula. İkisi de
// geçmezse peer DOĞRULANMAMIŞ sayılır ve onunla WebRTC kurulmaz.
async function _verifyPeerPassport(fromUserId, passport, passportSig, nonce, presenceSig){
  const cacheKey = fromUserId + '|' + passportSig + '|' + nonce;
  if(cacheKey in _verifyCache) return _verifyCache[cacheKey];
  try{
    // 🛡️ [FIX] "passport" sunucudan (identity.js) BASE64 STRING olarak gelir
    // (Buffer.from(identityPayload).toString('base64')) — obje DEĞİLDİR.
    // Eski kod doğrudan passport.username/.userId okuyordu; bu her zaman
    // undefined döndüğü için doğrulama sunucuya hiç gitmeden HERKES için
    // başarısız oluyordu. Önce decode + parse edilmesi gerekir.
    let decoded;
    try{ decoded = JSON.parse(atob(passport)); }
    catch(e){
      console.warn('[SEC][VERIFY-FAIL] pasaport decode/parse edilemedi:', fromUserId, e);
      _verifyCache[cacheKey] = false; return false;
    }
    if(!decoded || (decoded.username !== fromUserId && decoded.userId !== fromUserId)){
      console.warn('[SEC][VERIFY-FAIL] pasaporttaki kimlik fromUserId ile eşleşmiyor:', fromUserId, 'decoded=', decoded);
      _verifyCache[cacheKey] = false; return false;
    }
    const r = await fetch('/api/identity?action=verify', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ passport, signature: passportSig }),
      signal: AbortSignal.timeout(6000)
    });
    if(!r.ok){
      let body=''; try{ body = await r.text(); }catch(_){}
      console.warn('[SEC][VERIFY-FAIL] /api/identity?action=verify HTTP', r.status, fromUserId, body);
      _verifyCache[cacheKey] = false; return false;
    }
    const data = await r.json();
    if(!data || data.valid !== true || !data.identity){
      console.warn('[SEC][VERIFY-FAIL] sunucu pasaportu geçersiz/valid:false buldu:', fromUserId, data);
      _verifyCache[cacheKey] = false; return false;
    }

    // Sunucu pasaportu onayladı → şimdi presence imzasını pasaportun
    // genel anahtarıyla YEREL olarak doğrula (replay/çalıntı pasaport koruması).
    // 🛡️ [FIX] identity.js'de alan adı "pubKey" — "signingPublicKey" DEĞİL.
    // Kendi decode'umuz yerine sunucunun doğruladığı data.identity kullanılır.
    // 🛡️ [FIX] Peer'ın hangi algoritmayla imzaladığı pasaportun içindeki
    // "alg" alanından okunur (sunucu bunu geçirmiyorsa eski davranış olan
    // Ed25519'a düşülür — geriye dönük uyumluluk için). Bu olmadan, Ed25519
    // desteklemeyen bir tarayıcıda ECDSA'ya düşmüş bir peer'ın 65 byte'lık
    // P-256 anahtarı 32 byte bekleyen Ed25519 importKey'e verilir ve
    // doğrulama HER ZAMAN sessizce başarısız olurdu.
    const peerAlg = decoded.alg === 'ECDSA-P256'
      ? {name:'ECDSA', namedCurve:'P-256'}
      : {name:'Ed25519'};
    const verifyAlg = decoded.alg === 'ECDSA-P256'
      ? {name:'ECDSA', hash:'SHA-256'}
      : 'Ed25519';
    let pubKey;
    try{
      pubKey = await crypto.subtle.importKey(
        'raw', _u8(data.identity.pubKey), peerAlg, false, ['verify']
      );
    }catch(e){
      console.warn('[SEC][VERIFY-FAIL] genel anahtar import edilemedi (alg=%s, pubKey uzunluğu=%s):', decoded.alg, data.identity.pubKey?.length, fromUserId, e);
      _verifyCache[cacheKey] = false; return false;
    }
    const enc = new TextEncoder().encode(fromUserId + '|' + nonce);
    const sigOk = await crypto.subtle.verify(verifyAlg, pubKey, _u8(presenceSig), enc);
    if(!sigOk) console.warn('[SEC][VERIFY-FAIL] presence imzası pasaportun genel anahtarıyla eşleşmiyor:', fromUserId, 'alg=', decoded.alg);
    _verifyCache[cacheKey] = sigOk;
    return sigOk;
  }catch(e){
    console.warn('[SEC][VERIFY-FAIL] Pasaport doğrulama istisnası:', fromUserId, e);
    _verifyCache[cacheKey] = false;
    return false;
  }
}

// Bir peer için doğrulama durumunu garanti et — önbellekte varsa onu kullan,
// yoksa son alınan presence kimlik bilgileriyle (varsa) doğrulamayı dener.
async function _ensurePeerVerified(userId){
  if(_verifiedPeers.has(userId)) return true;
  const idf = _lastPresenceIdentity[userId];
  if(!idf){
    console.warn('[SEC][VERIFY-FAIL] bu peer için kimlikli presence hiç alınmadı (henüz gelmedi ya da kimliksiz geldi):', userId);
    return false;
  }
  const ok = await _verifyPeerPassport(userId, idf.passport, idf.passportSig, idf.nonce, idf.presenceSig);
  if(ok) _verifiedPeers.add(userId); else _verifiedPeers.delete(userId);
  return ok;
}

async function getMyECDHPubKeyJwk(){
  if(!_sessionKeyPair) return null;
  return crypto.subtle.exportKey('jwk', _sessionKeyPair.publicKey);
}

// 🛡️ [MED-02 / DÜZELTME] NOT: ECDH _sessionKeyPair her tarayıcı oturumunda
// KASITLI olarak yeniden üretiliyor (forward secrecy). Bu yüzden bu anahtara
// TOFU (kalıcı parmak izi pinleme) uygulamak YANLIŞ POZİTİF üretiyordu:
// bir peer normal şekilde sayfayı yenilediğinde/yeniden bağlandığında bile
// "anahtar değişti, MITM olabilir" uyarısı sürekli tetikleniyordu — gerçek
// kimlik doğrulaması zaten ayrı bir Ed25519 + sunucu pasaport sistemiyle
// yapılıyor (bkz. yukarısı). Bu yüzden burada sadece oturum-içi cache
// güncellenir, kalıcı pinleme/karşılaştırma YAPILMAZ.
const _peerPendingKeys = {}; // (artık kullanılmıyor — geriye dönük uyumluluk için bırakıldı)

async function storePeerPublicKey(userId, jwk){
  if(!jwk || typeof jwk !== 'object' || !jwk.x || !jwk.y) return;
  const jwkStr = JSON.stringify(jwk);
  if(_peerPublicKeyCache[userId] === jwkStr) return; // zaten işlendi

  // 🛡️ [MITM-FIX] Güvenlik kodu: her iki tarafta AYNI kod görünmeli.
  // Önceki: SHA-256(peerKey) — her cihaz farklı kod görüyordu.
  // Yeni: SHA-256(sort(myKeyJSON, peerKeyJSON).join('|'))
  // Her iki tarafın da aynı iki key'i sıralı birleştirmesi sayesinde
  // sonuç her iki cihazda da özdeş olur.
  let newFp;
  try{
    const myJwk = await getMyECDHPubKeyJwk();
    const myStr = JSON.stringify(myJwk);
    // Lexicographic sıralama → tarafsız, deterministik
    const parts = [myStr, jwkStr].sort();
    const combined = parts[0] + '|' + parts[1];
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
    newFp = [...new Uint8Array(raw)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
  }catch(e){ return; } // hash hesaplanamazsa anahtarı kabul etme

  // Oturum-içi (sadece bu sekme açıkken geçerli) — kalıcı pinleme yok
  _peerPublicKeyCache[userId] = jwkStr;
  delete _peerAESKeyCache[userId];
  delete _peerPendingKeys[userId];
  _peerKeyFingerprints[userId] = newFp.match(/.{4}/g).join(' ').toUpperCase();
  document.getElementById('fpWarn_'+userId)?.remove();
  if(typeof chatId !== 'undefined' && chatId === userId) _updateChatFpDisplay(userId);
}

// 🛡️ [MED-02] Parmak izi değişikliği uyarı banner'ı
// NOT: onclick="..." attribute KULLANILMAZ — sayfa CSP'si yalnızca derleme
// anında bilinen, önceden hash'lenmiş inline handler'lara izin veriyor.
// Dinamik olarak eklenen yeni bir onclick string'i CSP tarafından
// BLOKLANIR. Bunun yerine addEventListener kullanılır (her zaman güvenli).
function _showKeyChangeWarning(userId){
  if(document.getElementById('fpWarn_'+userId)) return; // zaten gösteriliyor
  const safeUid = escHtml(userId);
  const warn = document.createElement('div');
  warn.id = 'fpWarn_'+userId;
  warn.className = 'security-alert';
  warn.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px 14px;border-radius:10px;margin:8px 0;font-size:12.5px;line-height:1.5';
  warn.innerHTML = `⚠️ <strong>${safeUid}</strong> için güvenlik anahtarı değişti. Bu bir cihaz değişikliği olabilir <u>veya</u> bir MITM saldırısı işareti olabilir — emin olmadan mesajlaşmaya devam etmeyin.
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" data-fp-accept="${safeUid}" style="font-size:12px;padding:6px 12px;border-radius:8px;background:#991b1b;color:#fff;border:none;cursor:pointer">Yine de Kabul Et</button>
      <button type="button" data-fp-dismiss style="font-size:12px;padding:6px 12px;border-radius:8px;background:transparent;color:#991b1b;border:1px solid #991b1b;cursor:pointer">Kapat</button>
    </div>`;
  // 🛡️ addEventListener — CSP-güvenli (inline onclick attribute DEĞİL)
  warn.querySelector('[data-fp-accept]').addEventListener('click', () => window._acceptNewPeerKey(userId));
  warn.querySelector('[data-fp-dismiss]').addEventListener('click', () => warn.remove());

  if(typeof chatId !== 'undefined' && chatId === userId && $('chatMsgs')){
    $('chatMsgs').prepend(warn);
  } else if(typeof showToast==='function'){
    showToast('⚠️ Güvenlik Uyarısı', `${userId} için anahtar değişti.`);
  }
}

// 🛡️ [MED-02] Kullanıcı, fingerprint değişikliğini bilerek kabul ediyor — pin güncellenir
window._acceptNewPeerKey = async (userId) => {
  const jwkStr = _peerPendingKeys[userId];
  if(!jwkStr) return;
  try{
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwkStr));
    const newFp = [...new Uint8Array(raw)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    localStorage.setItem('sv_fp_' + userId.toLowerCase(), newFp);
    _peerPublicKeyCache[userId] = jwkStr;
    delete _peerAESKeyCache[userId];
    delete _peerPendingKeys[userId];
    _peerKeyFingerprints[userId] = newFp.match(/.{4}/g).join(' ').toUpperCase();
    document.getElementById('fpWarn_'+userId)?.remove();
    if(typeof chatId !== 'undefined' && chatId === userId) _updateChatFpDisplay(userId);
    if(typeof showToast==='function') showToast('Anahtar Güncellendi', userId+' için yeni anahtar kabul edildi.');
  }catch(e){}
};

// 🛡️ [YENİ-H2] Açık sohbette fingerprint göstergesini güncelle
// 🎨 [FIX] Varsayılan olarak 32 haneli kod yerine kısa bir rozet gösterilir
// ("🔒 Güvenlik kodu") — kullanıcı isterse tıklayıp açabilir. Kod kayboluyor
// gibi durmasın diye değil, sadece arayüzde daha az yer kaplasın ve karmaşık
// görünmesin diye. MITM tespiti için anlamı aynı kalıyor, sadece varsayılan
// görünüm sadeleşti.
let _fpExpanded = false;
function _renderChatFpEl(userId){
  const fpEl = $('chatKeyFp');
  if(!fpEl) return;
  const fp = userId ? _peerKeyFingerprints[userId] : null;
  if(!fp){ fpEl.style.display='none'; return; }
  fpEl.style.display = 'block';
  fpEl.textContent = _fpExpanded ? ('🔑 ' + fp) : '🔒 Güvenlik kodu (göster)';
  fpEl.dataset.fpUser = userId;
}
function _updateChatFpDisplay(userId){
  _renderChatFpEl(userId);
}
// Tek seferlik: koda tıklanınca aç/kapat (CSP-güvenli — inline onclick değil)
(function _initFpToggle(){
  const fpEl = $('chatKeyFp');
  if(fpEl) fpEl.addEventListener('click', () => {
    _fpExpanded = !_fpExpanded;
    _renderChatFpEl(fpEl.dataset.fpUser || null);
  });
})();

// 🛡️ Parmak izi deposu (bellek — UI gösterimi için)
const _peerKeyFingerprints = {};
function getKeyFingerprint(uid){ return _peerKeyFingerprints[uid] || null; }

async function _getPeerDerivedKey(userId){
  if(_peerAESKeyCache[userId]) return _peerAESKeyCache[userId];
  const jwkStr = _peerPublicKeyCache[userId];
  if(!jwkStr || !_sessionKeyPair) return null;
  try{
    const jwk = JSON.parse(jwkStr);
    const peerPub = await crypto.subtle.importKey(
      'jwk', jwk, {name:'ECDH', namedCurve:'P-256'}, false, []
    );
    const key = await crypto.subtle.deriveKey(
      {name:'ECDH', public: peerPub},
      _sessionKeyPair.privateKey,
      {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
    );
    _peerAESKeyCache[userId] = key;
    return key;
  }catch(e){ return null; }
}

// 🛡️ [YENİ-H1] BOOTSTRAP ANAHTARI — eski tarih/ROOM/versiyon bazlı
// deterministik getBootstrapKey() TAMAMEN İPTAL EDİLDİ. Kaynak kodu okuyan
// biri artık bu anahtarı asla yeniden üretemez: GET /api/bootstrap-key
// çağrılır, sunucu (Vercel Env: CHAT_SECRET_KEY) kriptografik olarak
// rastgele, günlük rotasyonlu bir Base64 anahtar döner:
//   { "bootstrapKey": "<base64, en az 32 bayt>" }
// Bu değer DOĞRUDAN AES-256-GCM anahtarı olarak import edilir — yerel
// bir tohumla (seed) birleştirilmez, çünkü artık buna gerek yok: anahtarın
// tamamı sunucudan gelir. Sunucuya erişilemezse GÜVENSİZ bir fallback'e
// SESSİZCE düşülmez; hata fırlatılır ve şifreleme/çözme o ana kadar
// kullanılamaz (fail-closed).
let _bootstrapKey = null;
let _bootstrapKeyPromise = null;
async function _getBootstrapKey(){
  if(_bootstrapKey) return _bootstrapKey;
  if(_bootstrapKeyPromise) return _bootstrapKeyPromise;
  _bootstrapKeyPromise = (async () => {
    const r = await fetch('/api/bootstrap-key', { signal: AbortSignal.timeout(6000) });
    if(!r.ok) throw new Error('[SEC] /api/bootstrap-key HTTP '+r.status);
    const data = await r.json();
    if(!data || typeof data.bootstrapKey !== 'string' || !data.bootstrapKey){
      throw new Error('[SEC] /api/bootstrap-key beklenmeyen yanıt biçimi (bootstrapKey alanı yok)');
    }
    const raw = _u8(data.bootstrapKey);
    const key = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
    _bootstrapKey = key;
    return key;
  })();
  try{
    return await _bootstrapKeyPromise;
  }catch(e){
    _bootstrapKeyPromise = null; // sıradaki çağrı tekrar denesin
    console.error('[SEC] Bootstrap anahtarı alınamadı, şifreleme devre dışı:', e);
    throw e;
  }
}

const _b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const _u8  = s => new Uint8Array([...atob(s)].map(c=>c.charCodeAt(0)));

// toUserId: private mesajlarda karşı tarafın user_id'si; yoksa null (broadcast)
async function aesEncrypt(obj, toUserId=null){
  let key=null, keyType='bs';
  if(toUserId){
    const peerKey=await _getPeerDerivedKey(toUserId);
    if(peerKey){ key=peerKey; keyType='e2e'; }
  }
  if(!key) key=await _getBootstrapKey();
  // 🛡️ [HIGH-07] catch bloğu YOK — hata fırlatılır, plaintext asla gönderilmez
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const pt=new TextEncoder().encode(JSON.stringify(obj));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, pt);
  return {e:_b64(ct), v:_b64(iv), k:keyType};
}

// 🛡️ [HIGH-07] plain/şifresiz paketler reddedilir
// 🛡️ [FIX] fromUserId artık ZORUNLU DEĞİL — MQTT paketlerinde gönderen artık
// düz metin gönderilmiyor (bkz. _mqttSend/broadcast). fromUserId verilmezse
// ve paket e2e ise, önbellekteki BİLİNEN tüm peer anahtarları sırayla denenir;
// doğru anahtar olmayanlar AES-GCM doğrulama hatasıyla sessizce elenir (oracle
// riski yok — sadece açılır/açılmaz bilgisi sızar, içerik asla sızmaz).
async function aesDecrypt(pkt, fromUserId=null){
  if(pkt.plain||!pkt.e||!pkt.v){
    console.warn('[SEC] Şifresiz veya hatalı paket reddedildi.');
    return null;
  }
  if(pkt.k==='e2e'){
    const candidates = fromUserId ? [fromUserId] : Object.keys(_peerPublicKeyCache);
    for(const uid_ of candidates){
      const peerKey = await _getPeerDerivedKey(uid_);
      if(!peerKey) continue;
      try{
        const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:_u8(pkt.v)},peerKey,_u8(pkt.e));
        return JSON.parse(new TextDecoder().decode(pt));
      }catch(e){ /* bu peer'ın anahtarı değil — sıradakini dene */ }
    }
  }
  // Bootstrap anahtarıyla çöz (presence, grup, discovery, gönderen ipucu olmayan paketler)
  try{
    const key=await _getBootstrapKey();
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:_u8(pkt.v)},key,_u8(pkt.e));
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){
    console.warn('[SEC] Şifre çözme başarısız, paket atıldı.');
    return null;
  }
}

// ── 3. SUNUCU YAPILANDIRMASI (MQTT broker + kimlik bilgileri + topic sırrı) ─
// 🛡️ [HIGH-02]/[MED-01] BROKER ve TOPIC_SECRET artık kaynak kodunda SABİT
// DEĞİL. MQTT bağlantısı kurulmadan hemen önce (connectNetwork içinde)
// GET /api/config çağrılır; Vercel Environment Variables'tan
// (örn. TOPIC_ROTATE_SECRET) okunan aşağıdaki gövde döner:
//   { mqttBroker, mqttUsername, mqttPassword, topicSecret }
let _serverConfig = null;
let _serverConfigPromise = null;
async function loadServerConfig(){
  if(_serverConfig) return _serverConfig;
  if(_serverConfigPromise) return _serverConfigPromise;
  _serverConfigPromise = (async () => {
    const r = await fetch('/api/config', { signal: AbortSignal.timeout(6000) });
    if(!r.ok) throw new Error('[SEC] /api/config HTTP '+r.status);
    const cfg = await r.json();
    if(!cfg || typeof cfg.mqttBroker !== 'string' || !cfg.mqttBroker){
      throw new Error('[SEC] /api/config: mqttBroker alanı eksik/hatalı');
    }
    if(typeof cfg.topicSecret !== 'string' || !cfg.topicSecret){
      throw new Error('[SEC] /api/config: topicSecret alanı eksik/hatalı');
    }
    _serverConfig = cfg;
    return cfg;
  })();
  try{
    return await _serverConfigPromise;
  }catch(e){
    _serverConfigPromise = null; // sıradaki çağrı tekrar denesin
    console.error('[SEC] Sunucu yapılandırması (/api/config) alınamadı:', e);
    throw e;
  }
}

// 🛡️ [YENİ-H3] Link URL sanitizer — javascript:/vbscript:/data: protokollerini reddeder
// onclick attribute'u yerine data-lp-url + event delegation pattern'ı kullanılır
function sanitizeLinkUrl(url){
  if(!url || typeof url !== 'string') return null;
  const trimmed = url.trim().toLowerCase().replace(/\s+/g,'');
  if(!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
  return escHtml(url.trim()); // Attribute injection'ı önle
}

// Gerçek ROOM topic'i sabit değil; günlük dönen, SUNUCUDAN ALINAN
// topicSecret ile HMAC-SHA256 türetilir. Aynı gün + aynı sır = aynı hash
// → birlikte çalışır. 🛡️ [MED-01] Sunucuya erişilemezse artık GÜVENSİZ
// sabit ROOM topic'ine SESSİZCE düşülmez — bağlantı kurulmaz (fail-closed),
// böylece topic kaynak kodundan tahmin edilemez kalır.
async function deriveObfuscatedTopic(){
  const cfg = await loadServerConfig();
  const enc = new TextEncoder();
  const dateSeed = new Date().toISOString().slice(0,10);
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(cfg.topicSecret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMat, enc.encode(ROOM + dateSeed));
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return 'sv/' + hex.slice(0, 32);   // "sv/a3f8…" — 35 karakter topic
}

let _obfTopic = null; // başlangıçta null, connectNetwork'te doldurulur

// ══════════════════════════════════════════════════════════════════

// ── DARK MODE ─────────────────────────────────────────────────────
function applyTheme(dark){
  if(dark){
    document.documentElement.classList.add('dark');
    $('themeIcon').textContent='☀️';
    $('themeLabel').textContent='Açık';
  } else {
    document.documentElement.classList.remove('dark');
    $('themeIcon').textContent='🌙';
    $('themeLabel').textContent='Koyu';
  }
}

window.toggleDarkMode=()=>{
  const isDark=document.documentElement.classList.contains('dark');
  applyTheme(!isDark);
  localStorage.setItem(THEME_KEY, (!isDark)?'dark':'light');
  const cb=$('toggleDark');
  if(cb) cb.checked=!isDark;
  // Nav rail tema ikonunu güncelle
  const dnrTI=$('dnrThemeIcon');
  if(dnrTI) dnrTI.textContent=(!isDark)?'☀️':'🌙';
  const thI=$('themeIcon');
  if(thI) thI.textContent=(!isDark)?'☀️':'🌙';
};

// ── NAV RAIL SWITCH ───────────────────────────────────────────────
window.dnrSwitch = function(section){
  if(!ME) return;
  // Tüm panelleri kapat
  ['panelChats','panelRequests','panelProfile'].forEach(id=>{
    const el=$(id); if(el) el.classList.remove('active');
  });
  // Nav item active sınıflarını temizle
  ['dnrChats','dnrRequests','dnrProfile'].forEach(id=>{
    const el=$(id); if(el) el.classList.remove('active');
  });
  // İlgili paneli aç
  const panelMap={chats:'panelChats',requests:'panelRequests',profile:'panelProfile'};
  const navMap={chats:'dnrChats',requests:'dnrRequests',profile:'dnrProfile'};
  const panelEl=$(panelMap[section]);
  const navEl=$(navMap[section]);
  if(panelEl) panelEl.classList.add('active');
  if(navEl) navEl.classList.add('active');
  // Profil panelini açınca içeriği güncelle
  if(section==='profile') svUpdateProfilePanel();
};

window.toggleSettings=()=>{
  $('settingsPanel').classList.toggle('open');
  const cb=$('toggleDark');
  if(cb) cb.checked=document.documentElement.classList.contains('dark');
};

// Apply saved theme on load
(()=>{
  const saved=localStorage.getItem(THEME_KEY);
  if(saved==='dark') applyTheme(true);
})();

// ── STATE ─────────────────────────────────────────────────────────
let mq=null, ME=null, chatId=null, chatType=null;
let pc=null, ls=null, iceQ=[], callIv=null, screenOwner=null;
const _typingUsers=new Set(); // tracks who is currently typing to ME
const _typingTimers={}; // per-user auto-clear timers for stuck "typing" indicator
let activeChatId=null, activeChatType=null; // Aramanın başladığı sohbet
let peers={}, avatars={}, blocked=[];
let peerVersions={}; // { user_id: '1.7' }
const seen=new Set();
let chkPending=false, nameTaken=false;

// ICE — Kendi /api/ice-servers köprümüz üzerinden TURN credential
let rtcCfg={
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun.cloudflare.com:3478'}
  ],
  iceCandidatePoolSize:10,
  iceTransportPolicy:'all'
};

// ══════════════════════════════════════════════════════════════════
//  🔐 TURN SUNUCU KONFİGÜRASYONU
//  Key client-side'da yoktur — /api/ice-servers serverless köprüsünde saklanır.
//  Metered domain kısıtlaması dashboard'da: sadece openchatt.metered.live
// ══════════════════════════════════════════════════════════════════

async function fetchIceServers(){
  // 1. Önce kendi serverless köprümüze sor (/api/ice-servers) - EN GÜVENLİ YOL
  try{
    const r=await fetch('/api/ice-servers',{signal:AbortSignal.timeout(5000)});
    if(r.ok){
      const servers=await r.json();
      if(Array.isArray(servers)&&servers.length>0){
        rtcCfg={iceServers:servers, iceCandidatePoolSize:10, iceTransportPolicy:'all'};
        setIceStatus('ok','TURN sunucusu hazır');
        return;
      }
    }
  }catch(e){
    console.error('[ICE] Serverless köprü başarısız, STUN fallback\'e geçiliyor',e);
  }
  // 2. Son çare — Sadece public STUN (köprü çökerse sistem tamamen patlamasın diye)
  rtcCfg={
    iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun.cloudflare.com:3478'},
      {urls:'stun:stun1.l.google.com:19302'},
      {urls:'stun:stun2.l.google.com:19302'},
    ],
    iceCandidatePoolSize:10,
    iceTransportPolicy:'all'
  };
  setIceStatus('warn','Sınırlı bağlantı (TURN yok — sunucu hatası)');
}

function setIceStatus(type, msg){
  const el=$('iceStatusBar');
  if(!el)return;
  const colors={ok:'var(--ok)',warn:'#f59e0b',err:'var(--danger)'};
  el.style.background=colors[type]||colors.warn;
  el.innerText='📡 '+msg;
  el.classList.remove('hidden');
  if(type==='ok') setTimeout(()=>el.classList.add('hidden'),3000);
}

// Arama başlamadan önce ICE durumunu konsola yaz
function debugIce(){
  // Güvenlik: ICE config credential'larını loga yazmıyoruz
  const hasTurn=rtcCfg.iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>u.startsWith('turn:')));
  if(!hasTurn){
    showToast('⚠️ TURN Yok','Uzak bağlantı çalışmayabilir.');
  }
  return hasTurn;
}

// ══════════════════════════════════════════════════════════════════
//  🔒 WEBRTC DATA CHANNEL MANAGER
//  Broker artık SADECE sinyal kanalı.
//  Gerçek mesajlar: WebRTC DataChannel (DTLS-SRTP + ECDH AES-256-GCM)
//  MQTT → presence, dc_offer/answer/ice, çevrimdışı fallback
// ══════════════════════════════════════════════════════════════════

// user_id → { pc, dc, state, queue, iceQueue }
const _dcPeers = {};

// Bu tipler her zaman MQTT üzerinden gider (DC kurulmadan önce gönderilmesi gereken sinyaller)
// 🛡️ [FIX] 'friend_accept' / 'friend_remove' BURAYA EKLENDİ:
// Bunlar belirli bir kullanıcıya (to: <user_id>) gönderildiği için broadcast()
// içinde "hedefli mesaj" yoluna giriyordu ve bu yol DataChannel'ın AÇIK olmasını
// gerektiriyor. Ama bir arkadaşlık isteği henüz kabul edilmeden DC bağlantısı
// hiç kurulmaz (DC, iki taraf da birbirini arkadaş bilince kurulur). Sonuç:
// kabul eden taraf friend_accept'i gönderiyor ama bu mesaj DC açılana kadar
// kendi yerel outbox'unda (localStorage) bekliyordu — DC ise asla açılmıyordu,
// çünkü onu açacak taraf (istek gönderen) bu mesajı ALAMADAN arkadaş olduğunu
// öğrenemiyordu. Klasik tavuk-yumurta kilitlenmesi. friend_req zaten 'global'
// hedefiyle MQTT üzerinden gittiği için bu sorunu yaşamıyordu; friend_accept/
// friend_remove'u da aynı şekilde MQTT'den göndermek bu kilitlenmeyi çözer.
const _MQTT_ONLY_TYPES = new Set([
  'presence','check_user_id','user_id_taken',
  'dc_offer','dc_answer','dc_ice',
  'friend_accept','friend_remove'
]);
// 🛡️ RTC sinyal tipleri: DC açıksa DC üzerinden, değilse MQTT fallback
// (küçük SDP/ICE paketleri — mesaj içeriği YOK, güvenli)
const _RTC_SIG_TYPES = new Set([
  'rtc_offer','rtc_answer','rtc_ice','rtc_end','rtc_reject','rtc_busy',
  'rtc_renego','rtc_renego_ans','rtc_call',
  'grp_offer','grp_answer','grp_ice','grp_end',
  'grp_call_active','grp_call_ended','call_state',
  'screen_offer','screen_started','screen_ended'
]);

function _isDcSignalForMe(d){
  return !!(ME && d && d.to === ME.user_id && d.from && d.from !== ME.user_id);
}

const _DC_CONNECT_TIMEOUT_MS = 30000;

function _dcPeerIsStale(peer){
  return !!(peer && peer.state === 'connecting' && peer.startedAt && Date.now() - peer.startedAt > _DC_CONNECT_TIMEOUT_MS);
}

function _dcRestartIfStale(userId){
  const peer = _dcPeers[userId];
  if(!_dcPeerIsStale(peer)) return false;
  console.warn('[DC] Connecting zaman asimi, baglanti temizleniyor:', userId);
  _dcClose(userId);
  if(ME && ME.user_id < userId && _verifiedPeers.has(userId)){
    setTimeout(()=>_dcConnect(userId), 0);
  }
  return true;
}

// ── DataChannel bağlantısı başlat (sadece initiator taraf çağırır) ──
async function _dcConnect(userId){
  if(!ME||!rtcCfg) return;
  // 🛡️ [HIGH-03]/[YENİ-H2]/[HIGH-04] Savunma derinliği: çağıran taraf zaten
  // doğrulama yapmış olsa da, burada da kontrol edilir — _dcConnect başka
  // bir yoldan (ileride eklenecek bir kod yolundan) çağrılırsa bile
  // doğrulanmamış bir peer ile bağlantı kurulamaz.
  if(!_verifiedPeers.has(userId)){
    console.warn('[SEC] Doğrulanmamış peer ile WebRTC bağlantısı reddedildi:', userId);
    return;
  }
  const existing = _dcPeers[userId];
  if(existing?.state==='connected') return;
  if(existing?.state==='connecting'){
    if(!_dcPeerIsStale(existing)) return;
    console.warn('[DC] Eski connecting baglantisi temizlenip yeniden deneniyor:', userId);
    _dcClose(userId);
  }

  console.log('[DC] Bağlantı başlatılıyor →', userId);
  _dcPeers[userId] = { pc:null, dc:null, state:'connecting', queue:[], iceQueue:[], startedAt:Date.now() };

  const pc = new RTCPeerConnection(rtcCfg);
  _dcPeers[userId].pc = pc;

  pc.onicecandidate = (e) => {
    if(e.candidate){
      // ICE adayları MQTT üzerinden karşı tarafa iletilir
      _mqttSend({type:'dc_ice', to:userId, from:ME.user_id, cand:e.candidate}, 1);
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if(s==='failed'||s==='closed'||s==='disconnected'){
      console.log('[DC] Bağlantı durumu:', s, '→', userId);
      if(s==='failed'||s==='closed') _dcClose(userId);
    }
  };

  // DataChannel oluştur (sıralı, güvenilir)
  const dc = pc.createDataChannel('msg', {ordered:true, maxRetransmits:3});
  _setupDC(userId, dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Offer MQTT üzerinden gönderilir
  _mqttSend({type:'dc_offer', to:userId, from:ME.user_id, sdp:pc.localDescription}, 1);
}

// ── DataChannel event'lerini kur ──
function _setupDC(userId, dc){
  _dcPeers[userId].dc = dc;

  dc.onopen = () => {
    console.log('[DC] ✅ DataChannel AÇIK →', userId);
    _dcPeers[userId].state = 'connected';
    // Bağlantı kurulurken biriken DC kuyruğunu gönder
    const q = _dcPeers[userId].queue.splice(0);
    q.forEach(raw => { try{ dc.send(raw); }catch(e){} });
    // 🛡️ [HIGH-02] Outbox'ta bekleyen mesajları DC üzerinden gönder
    _flushOutbox();
    updateFriends();
  };

  dc.onclose   = () => { console.log('[DC] Kapalı:', userId); _dcClose(userId); };
  dc.onerror   = (e) => { console.warn('[DC] Hata:', userId, e); _dcClose(userId); };

  dc.onmessage = async (e) => {
    try{
      const pkt = JSON.parse(e.data);
      // Güvenlik: from hint'i kontrol et
      const fromHint = (typeof pkt.f==='string' && isWhitelisted(pkt.f)) ? pkt.f : null;
      const d = await aesDecrypt(pkt, fromHint);
      if(!d){ console.warn('[DC][SEC] Çözülemeyen DC paketi, atlandı.'); return; }
      if(d.from && !isWhitelisted(d.from)){ console.warn('[DC][SEC] Whitelist dışı kaynak'); return; }
      // DC'den gelen mesajlar için de rate limit uygula
      if(d.from && ME && d.from !== ME.user_id){
        const key='dc_in_'+d.from;
        if(!_rateLimiter._incomingTimes) _rateLimiter._incomingTimes={};
        const t=Date.now();
        if(!_rateLimiter._incomingTimes[key]) _rateLimiter._incomingTimes[key]=[];
        _rateLimiter._incomingTimes[key]=_rateLimiter._incomingTimes[key].filter(x=>t-x<5000);
        if(_rateLimiter._incomingTimes[key].length>30){ console.warn('[DC][DDOS] Spam atlandı:',d.from); return; }
        _rateLimiter._incomingTimes[key].push(t);
      }
      handleSig(d);
    }catch(ex){ console.warn('[DC] Mesaj işleme hatası:', ex); }
  };
}

// ── Gelen dc_offer'a cevap ver (alıcı taraf) ──
async function _dcHandleOffer(d){
  if(!ME||!rtcCfg) return;
  if(!_isDcSignalForMe(d)){
    console.warn('[DC][SEC] Hedefi bu istemci olmayan dc_offer atlandi:', d?.from, '->', d?.to);
    return;
  }
  if(d.sdp?.type !== 'offer'){
    console.warn('[DC][SEC] Gecersiz dc_offer SDP atlandi:', d?.from);
    return;
  }
  const userId = d.from;

  // 🛡️ [HIGH-03]/[YENİ-H2]/[HIGH-04] Teklifi (offer) kabul etmeden ÖNCE
  // gönderenin sunucu onaylı kimlik pasaportunu doğrula (son presence'ından
  // önbelleğe alınan bilgiyle). Doğrulanamazsa — tahrif edilmiş/sahte
  // kimlik, olası MITM — bağlantı kurulmaz, RTCPeerConnection açılmaz.
  const verified = await _ensurePeerVerified(userId);
  if(!verified){
    console.warn('[SEC] Doğrulanamayan kimlikten gelen dc_offer reddedildi:', userId);
    if(typeof showToast==='function') showToast('⚠️ Güvenlik Uyarısı', '"'+userId+'" için kimlik doğrulanamadı, bağlantı reddedildi.');
    return;
  }

  console.log('[DC] Offer alındı ←', userId);

  // Önceki bağlantıyı temizle
  if(_dcPeers[userId]?.pc) _dcClose(userId);

  _dcPeers[userId] = { pc:null, dc:null, state:'connecting', queue:[], iceQueue:[], startedAt:Date.now() };
  const pc = new RTCPeerConnection(rtcCfg);
  _dcPeers[userId].pc = pc;

  pc.onicecandidate = (e) => {
    if(e.candidate) _mqttSend({type:'dc_ice', to:userId, from:ME.user_id, cand:e.candidate}, 1);
  };

  pc.ondatachannel = (e) => { _setupDC(userId, e.channel); };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if(s==='failed'||s==='closed') _dcClose(userId);
  };

  await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
  // Bekleyen ICE adaylarını uygula
  for(const cand of (_dcPeers[userId].iceQueue||[])){
    try{ await pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){}
  }
  _dcPeers[userId].iceQueue = [];

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  _mqttSend({type:'dc_answer', to:userId, from:ME.user_id, sdp:pc.localDescription}, 1);
}

// ── Gelen dc_answer'ı uygula ──
async function _dcHandleAnswer(d){
  if(!_isDcSignalForMe(d)){
    console.warn('[DC][SEC] Hedefi bu istemci olmayan dc_answer atlandi:', d?.from, '->', d?.to);
    return;
  }
  if(d.sdp?.type !== 'answer'){
    console.warn('[DC][SEC] Gecersiz dc_answer SDP atlandi:', d?.from);
    return;
  }
  const peer = _dcPeers[d.from];
  if(!peer?.pc){ console.warn('[DC] Answer için PC bulunamadı:', d.from); return; }
  if(peer.pc.signalingState !== 'have-local-offer'){
    console.warn('[DC] Beklenmeyen answer atlandi:', d.from, 'state=', peer.pc.signalingState);
    return;
  }
  try{
    await peer.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    for(const cand of (peer.iceQueue||[])){
      try{ await peer.pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){}
    }
    peer.iceQueue = [];
  }catch(e){ console.warn('[DC] Answer hatası:', e); }
}

// ── Gelen ICE adayını uygula ──
async function _dcHandleIce(d){
  if(!_isDcSignalForMe(d)){
    console.warn('[DC][SEC] Hedefi bu istemci olmayan dc_ice atlandi:', d?.from, '->', d?.to);
    return;
  }
  const peer = _dcPeers[d.from];
  if(!peer){ return; }
  if(!d.cand) return;
  if(peer.pc?.remoteDescription){
    try{ await peer.pc.addIceCandidate(new RTCIceCandidate(d.cand)); }catch(e){}
  } else {
    // Remote description henüz gelmedi — kuyruğa al
    if(!peer.iceQueue) peer.iceQueue=[];
    peer.iceQueue.push(d.cand);
  }
}

// ── DataChannel bağlantısını kapat ve temizle ──
function _dcClose(userId){
  const peer = _dcPeers[userId];
  if(!peer) return;
  try{ peer.dc?.close(); }catch(e){}
  try{ peer.pc?.close(); }catch(e){}
  delete _dcPeers[userId];
}

// ── Kaç peer ile DC bağlantısı var? (durum göstergesi için) ──
function _dcConnectedCount(){
  return Object.values(_dcPeers).filter(p=>p.state==='connected').length;
}

// ── Doğrudan MQTT'ye gönder (sinyal mesajları için — DC bypass) ──
async function _mqttSend(p, qos=0){
  if(!mq?.connected) return;
  const pkt = await aesEncrypt(p, p.to||null);
  // 🛡️ [FIX] "pkt.f = ME.user_id" KALDIRILDI — broker'a artık gönderenin
  // kimliği düz metin gitmiyor. Açık/herkese açık bir broker dinlenirse bile
  // kimin ne zaman mesaj attığı görünmesin diye; alıcı taraf gönderenin kimliğini
  // şifreyi açtıktan SONRA paketin içinden (d.from) öğrenir (bkz. aesDecrypt).
  mq.publish(_obfTopic||ROOM, JSON.stringify(pkt), {qos});
}

// Belirli aralıklarla kopuk DC bağlantılarını temizle
setInterval(()=>{
  if(!ME) return;
  for(const [uid_, peer] of Object.entries(_dcPeers)){
    if(_dcRestartIfStale(uid_)) continue;
    const s = peer.pc?.connectionState;
    if(s==='failed'||s==='closed'||s==='disconnected') _dcClose(uid_);
  }
}, 10000);


// ── VERİTABANI — Güvenli okuma/yazma ──────────────────────────────
const DB_BACKUP_KEY = DB_KEY+'_backup';

function getDB(){
  try{
    const raw=localStorage.getItem(DB_KEY);
    const db = raw ? JSON.parse(raw) : {};
    // Şema doğrulama
    if(!db.users) db.users={};
    if(!db.groups) db.groups={};
    // 🛡️ [KRİTİK-V3-H1] messages artık DB_KEY'de DEĞİL — şifreli bellek cache'inden gelir
    db.messages = _decryptedMsgCache || {};
    // Migration: eski 'username' alanını 'user_id'ye çevir
    let migrated=false;
    Object.values(db.users).forEach(u=>{
      if(u.username!==undefined&&u.user_id===undefined){
        u.user_id=u.username;
        delete u.username;
        migrated=true;
      }
    });
    if(migrated) saveDB(db);
    return db;
  }catch(e){
    console.error('getDB parse hatası, backup deneniyor:',e);
    // Backup'tan kurtar
    try{
      const backup=localStorage.getItem(DB_BACKUP_KEY);
      if(backup){
        const db=JSON.parse(backup);
        if(db.users&&Object.keys(db.users).length>0){
          console.log('Backup\'tan kurtarıldı:', Object.keys(db.users).length,'kullanıcı');
          Object.values(db.users).forEach(u=>{
            if(u.username!==undefined&&u.user_id===undefined){
              u.user_id=u.username;
              delete u.username;
            }
          });
          localStorage.setItem(DB_KEY,backup);
          db.messages = _decryptedMsgCache || {};
          return db;
        }
      }
    }catch(e2){}
    return {users:{},groups:{},messages:_decryptedMsgCache||{}};
  }
}

function saveDB(db){
  try{
    // 🛡️ [KRİTİK-V3-H1] messages ARTIK plaintext DB_KEY içine asla yazılmaz.
    // Bellek cache senkron güncellenir — bir sonraki getDB() çağrısı anında görür.
    const messagesToSave = db.messages || {};
    _decryptedMsgCache = messagesToSave;

    // users/groups — küçük, hassas değil (mesaj içeriği yok), pre-login hesap
    // listesi ekranı için plaintext kalmaya devam ediyor.
    const dbToSave = { users: db.users, groups: db.groups };
    const json = JSON.stringify(dbToSave);
    localStorage.setItem(DB_KEY, json);
    localStorage.setItem(DB_BACKUP_KEY, json);

    // ── Mesajları şifreli ayrı depoya yaz (büyük dosyaları fileCache'e taşı) ──
    const trimmedMessages = JSON.parse(JSON.stringify(messagesToSave));
    Object.keys(trimmedMessages).forEach(k=>{
      if(!Array.isArray(trimmedMessages[k])) return;
      if(trimmedMessages[k].length>300) trimmedMessages[k]=trimmedMessages[k].slice(-300);
      trimmedMessages[k]=trimmedMessages[k].map(m=>{
        if(m.fileData&&m.fileData.startsWith('data:')&&m.fileData.length>80000){
          const cacheKey='fc_'+m.id;
          try{ localStorage.setItem(cacheKey, m.fileData); }catch(e){}
          return {...m, fileData:'__cache__'+cacheKey};
        }
        return m;
      });
    });
    let msgJson = JSON.stringify(trimmedMessages);
    if(msgJson.length>4*1024*1024){
      Object.keys(trimmedMessages).forEach(k=>{
        if(Array.isArray(trimmedMessages[k])) trimmedMessages[k]=trimmedMessages[k].slice(-30);
      });
      msgJson = JSON.stringify(trimmedMessages);
    }

    if(_lsEncKey){
      // 🛡️ Anahtar hazır → mesajlar HER ZAMAN şifreli yazılır (plaintext fallback YOK)
      _lsSetEncrypted(MSG_KEY, msgJson).catch(e=>console.error('[SEC] Mesaj şifreleme hatası:',e));
    }
    // else: anahtar yok (kilit henüz açılmadı) → mesajlar SADECE bellekte kalır,
    // localStorage'daki önceki şifreli içerik korunur, üzerine yazılmaz.
  }catch(e){
    if(e.name==='QuotaExceededError'){
      try{
        _decryptedMsgCache = {};
        if(_lsEncKey) _lsSetEncrypted(MSG_KEY, '{}').catch(()=>{});
        if(typeof showToast==='function') showToast('⚠️ Depolama Dolu','Eski mesajlar temizlendi.');
      }catch(e2){console.error('saveDB emergency fail:',e2);}
    }else{console.error('saveDB:',e);}
  }
}

function getAccounts(){ 
  try{ return JSON.parse(localStorage.getItem(ACC_KEY)||'[]'); }
  catch(e){ return []; }
}
function saveAccount(name){
  try{
    const list=getAccounts();
    if(!list.includes(name.toLowerCase())) list.push(name.toLowerCase());
    localStorage.setItem(ACC_KEY,JSON.stringify(list));
  }catch(e){}
}

// ── MQTT ─────────────────────────────────────────────────────────
let reconnTmr=null;
async function connectNetwork(){
  if(mq){try{mq.end(true)}catch(e){} mq=null}
  clearTimeout(reconnTmr);
  setNet('connecting');

  // 🛡️ [HIGH-02]/[MED-01] Broker adresi, MQTT kimlik bilgileri ve topic
  // sırrı artık kaynak kodunda yok — bağlanmadan HEMEN ÖNCE /api/config'ten
  // asenkron olarak alınır. Sunucuya erişilemezse GÜVENSİZ bir sabit
  // broker/topic'e SESSİZCE düşülmez; bağlantı denemesi iptal edilip
  // yeniden denenir (fail-closed).
  let cfg;
  try{
    cfg = await loadServerConfig();
  }catch(e){
    setNet('offline');
    if(typeof showToast==='function') showToast('⚠️ Yapılandırma Hatası','Sunucu ayarları alınamadı, tekrar denenecek.');
    schedRec();
    return;
  }

  // Obfuscated topic'i hesapla (async, topicSecret /api/config'ten gelir)
  try{
    _obfTopic = await deriveObfuscatedTopic();
  }catch(e){
    setNet('offline');
    schedRec();
    return;
  }
  // Obfuscated topic hesaplandı — loga yazılmıyor (güvenlik)

  // 🛡️ [FIX] mqtt kütüphanesi yüklenemediyse (SRI hatası, ağ sorunu vb.)
  // satır 1289'da "mqtt is not defined" TypeError fırlatılıyordu.
  // Şimdi erken kontrol yapılıp kullanıcıya bilgi veriliyor.
  if(typeof mqtt === 'undefined'){
    console.error('[MQTT] mqtt kütüphanesi yüklenemedi — CDN erişimi veya SRI hash hatası olabilir.');
    setNet('offline');
    if(typeof showToast==='function') showToast('⚠️ Bağlantı Hatası','MQTT kütüphanesi yüklenemedi. Sayfa yenileyin.');
    schedRec();
    return;
  }

  // clientId: whitelist formatını taklit eden kısa ID
  const safeClientId = 'sv_' + uid().slice(0,8);

  const mqttOpts = {
    clientId: safeClientId,
    reconnectPeriod:0, keepalive:30, connectTimeout:6000, clean:true,
    // Bant genişliği optimizasyonu
    protocolVersion:5,
  };
  // mqttUsername/mqttPassword sadece broker kimlik doğrulaması gerektiriyorsa dolu gelir
  if(cfg.mqttUsername) mqttOpts.username = cfg.mqttUsername;
  if(cfg.mqttPassword) mqttOpts.password = cfg.mqttPassword;

  mq=mqtt.connect(cfg.mqttBroker, mqttOpts);
  mq.on('connect',()=>{
    setNet('online');
    mq.subscribe(_obfTopic,{qos:1}); // QoS 1 — sinyal paketleri kaybolmasın
    // MQTT artık SADECE sinyal kanalı — presence + DC offer/answer/ICE + offline fallback
    // Gerçek mesajlar: WebRTC DataChannel (P2P, broker görmez)
    if(ME) sendPresence(); // → ECDH public key + DC offer tetikler
    _flushOutbox(); // Çevrimdışıyken biriken mesajları gönder
  });
  mq.on('error',()=>{setNet('offline');schedRec();});
  mq.on('close',()=>{setNet('offline');schedRec();});
  mq.on('message',async(_,raw)=>{
    try{
      const pkt=JSON.parse(raw.toString());
      // 🛡️ [FIX] Artık "pkt.f" yok (gönderen düz metin gitmiyor) — bu satır
      // sadece eski/önbellekteki istemcilerden gelebilecek pkt.f için geriye
      // dönük uyumluluk amaçlı kalıyor. Normalde fromHint=null döner ve
      // aesDecrypt bilinen tüm peer anahtarlarını otomatik dener.
      const fromHint=(typeof pkt.f==='string'&&isWhitelisted(pkt.f))?pkt.f:null;
      const d=await aesDecrypt(pkt, fromHint);
      if(!d){console.warn('[SEC] Çözülemeyen paket, atlandı.');return;}
      // [DEBUG-FR] geçici loglama kaldırıldı — sorun çözüldü, console koruması yeniden aktif (bkz. SAST-8)
      // Whitelist kontrolü — from alanı formata uymuyorsa işleme
      if(d.from && !isWhitelisted(d.from)){
        console.warn('[SEC] Whitelist dışı kaynak, atlandı:',d.from);
        return;
      }
      // 🛡️ Gelen mesaj rate limit — kaynak başına spam koruması
      if(d.from && ME && d.from !== ME.user_id){
        const key = 'in_' + d.from;
        if(!_rateLimiter._incomingTimes) _rateLimiter._incomingTimes = {};
        const now2 = Date.now();
        if(!_rateLimiter._incomingTimes[key]) _rateLimiter._incomingTimes[key] = [];
        _rateLimiter._incomingTimes[key] = _rateLimiter._incomingTimes[key].filter(t => now2-t < 5000);
        if(_rateLimiter._incomingTimes[key].length > 30){ // 5 saniyede 30'dan fazla mesaj
          console.warn('[DDOS] Gelen mesaj spam:', d.from, '— atlandı');
          return;
        }
        _rateLimiter._incomingTimes[key].push(now2);
      }
      handleSig(d);
    }catch(e){}
  });
}
function schedRec(){
  clearTimeout(reconnTmr);
  if(mq&&mq.connected)return;
  // 🛡️ Reconnect rate limit — DDoS broker koruması
  if(!_reconnectLimiter.canReconnect()){
    // Fazla bağlantı denemesi → 30 saniye bekle
    reconnTmr=setTimeout(connectNetwork, 30000);
    return;
  }
  reconnTmr=setTimeout(connectNetwork,4000);
}
// ── Stabilite: bağlantı bekçisi ──
setInterval(()=>{
  if(mq&&mq.connected){
    if(_outbox.length) _flushOutbox();
  } else if(ME && !reconnTmr){
    schedRec();
  }
  // DC durum göstergesi — kaç peer ile P2P bağlantı var
  const dcCount = _dcConnectedCount();
  const dcEl = $('dcStatus');
  if(dcEl){
    if(dcCount>0){
      dcEl.textContent = `⚡ ${dcCount} P2P`;
      dcEl.style.color = 'var(--ok)';
      dcEl.style.display = 'inline';
    } else {
      dcEl.style.display = 'none';
    }
  }
},15000);
function setNet(s){
  const el=$('netStatus'); if(!el)return;
  const m={online:['● Ağa Bağlı','var(--ok)'],offline:['● Bağlantı Kesildi','var(--danger)'],connecting:['● Bağlanıyor...','#f59e0b']};
  const [t,c]=m[s]||m.connecting; el.textContent=t; el.style.color=c;
  // Nav rail dot güncelle
  const dot=$('dnrNetDot');
  if(dot) dot.style.background=c;
}
async function broadcast(p, qos=0){
  if(!_rateLimiter.canPublish()){ console.warn('[DDOS] Rate limit'); return; }
  p.msgId=p.msgId||uid();
  if(_RELIABLE_TYPES.includes(p.type)) qos=Math.max(qos,1);
  const targetUser = p.to;

  // ============================================================
  // 🛡️ [HIGH-02] MQTT SADECE SİNYAL KANALI — MESAJ İÇERİĞİ YOK
  // Sinyal tipleri (presence, dc_offer/answer/ice) → MQTT
  // Tüm mesaj içerikleri → WebRTC DataChannel (E2E şifreli)
  // ============================================================
  if(_MQTT_ONLY_TYPES.has(p.type)){
    return _mqttSend(p, qos);
  }

  // ── Belirli bir alıcı var (private / group per-member) ──
  if(targetUser && targetUser !== 'global'){
    const dcPeer = _dcPeers[targetUser];

    // ✅ DC açık → doğrudan gönder (broker görmez)
    if(dcPeer?.dc?.readyState === 'open'){
      try{
        const pkt = await aesEncrypt(p, targetUser);
        if(ME) pkt.f = ME.user_id;
        dcPeer.dc.send(JSON.stringify(pkt));
        console.log('[DC] Mesaj P2P olarak GERÇEKTEN gönderildi →', targetUser, p.type);
        return;
      }catch(e){ console.warn('[DC] Gönderim hatasi:', e.message); }
    }

    // DC baglaniyor -> kalici outbox'a al (DC acilinca gonderilir)
    if(_RELIABLE_TYPES.includes(p.type) && dcPeer?.state === 'connecting'){
      if(_dcPeerIsStale(dcPeer)) _dcRestartIfStale(targetUser);
      _outbox.push({p, qos, t: Date.now()});
      _saveOutbox();
      console.log('[OUTBOX] DC baglaniyor, mesaj kalici outboxa alindi ->', targetUser, p.type);
      return;
    }

    // 📦 Peer çevrimdışı → yerel outbox (DC kurulunca _flushOutbox dener)
    if(_RELIABLE_TYPES.includes(p.type)){
      console.warn('[OUTBOX] DC açık DEĞİL, mesaj outbox\'a kondu (henüz GİTMEDİ) →', targetUser, p.type, 'dcPeer=', dcPeer ? dcPeer.state : '(hiç bağlantı yok)', '_verifiedPeers içinde mi:', _verifiedPeers.has(targetUser));
      _outbox.push({p, qos, t: Date.now()});
      _saveOutbox();
      return;
    }

    // 📡 RTC sinyal tipleri: DC yoksa MQTT'ye fall back (sadece küçük SDP/ICE)
    if(_RTC_SIG_TYPES.has(p.type)){
      return _mqttSend(p, Math.max(qos, 1));
    }
    return;
  }

  // ── Hedefsiz mesaj (gelen sinyal dışı) → MQTT ──
  if(!mq?.connected){ return; }
  const pkt = await aesEncrypt(p, null);
  // 🛡️ [FIX] Gönderen artık düz metin eklenmiyor — bkz. _mqttSend üzerindeki not.
  mq.publish(_obfTopic || ROOM, JSON.stringify(pkt), {qos});
}

// ── Stabilite: gönderilemeyen önemli mesajlar burada bekler (localStorage ile kalıcı) ──
// 🛡️ [SAST-3 FIX] Önceden bu içerik (özel mesaj/grup davet/arkadaşlık metinleri
// dahil) localStorage'a JSON.stringify ile DÜZ METİN yazılıyordu — uygulamanın
// her yerde uyguladığı AES-256-GCM şifreleme garantisini delen bir arka kapıydı.
// Artık MSG_KEY için kullanılan aynı şifreli sarmalayıcı (_lsSetEncrypted/
// _lsGetDecrypted) kullanılıyor. Anahtar henüz hazır değilse (örn. henüz giriş
// yapılmadan) bu sarmalayıcılar otomatik olarak düz metne düşer — bu, önceki
// davranıştan daha kötü değildir, sadece anahtar geldiğinde şifreli hale gelir.
async function _loadOutbox(){
  try{
    const raw = await _lsGetDecrypted(_OUTBOX_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){ return []; }
}
async function _saveOutbox(){
  try{ await _lsSetEncrypted(_OUTBOX_KEY, JSON.stringify(_outbox)); }catch(e){}
}
// Anahtar (giriş/oturum geri yükleme) hazır olduğunda, daha önce düz metin ya
// da farklı bir anahtarla şifrelenmiş olabilecek outbox'ı yeniden okur ve
// bu sırada birikmiş olabilecek yeni öğelerle birleştirir.
async function _reloadOutboxAfterKeyReady(){
  try{
    const stored = await _loadOutbox();
    if(stored.length){
      const seenT = new Set(_outbox.map(it=>it.t+'|'+it.p?.type));
      for(const it of stored){ if(!seenT.has(it.t+'|'+it.p?.type)) _outbox.push(it); }
    }
  }catch(e){}
}
const _OUTBOX_KEY = 'shareview_outbox_v1';
let _outbox=[]; // Senkron erişim için boş başlar — gerçek içerik aşağıda asenkron yüklenir
_loadOutbox().then(arr=>{ _outbox.push(...arr); }).catch(()=>{});
const _RELIABLE_TYPES=['private_msg','group_msg','group_invite','friend_req','friend_accept','friend_remove','msg_read','group_read','msg_edit','msg_delete','reaction','msg_vanish'];
async function _flushOutbox(){
  if(!_outbox.length) return;
  // 🛡️ [HIGH-02] Outbox sadece DC üzerinden gönderilir — MQTT'ye mesaj içeriği gönderilmez
  const queue = _outbox.splice(0, _outbox.length);
  _saveOutbox();
  for(const item of queue){
    if(Date.now() - item.t > 24*60*60*1000) continue; // 24 saat → iptal
    const targetUser = item.p.to;
    if(!targetUser || targetUser === 'global'){
      _outbox.push(item); // Hedefsiz mesajlar outbox'ta kalsın
      continue;
    }
    const dcPeer = _dcPeers[targetUser];
    if(dcPeer?.dc?.readyState === 'open'){
      try{
        const pkt = await aesEncrypt(item.p, targetUser);
        if(ME) pkt.f = ME.user_id;
        dcPeer.dc.send(JSON.stringify(pkt));
        // ✅ DC ile gönderildi — outbox'a geri EKLEME
      }catch(e){
        _outbox.push(item); // Şifreleme hatası → tekrar dene
      }
    } else {
      // DC henüz açık değil → geri koy, bir sonraki flush'ta tekrar dene
      _outbox.push(item);
    }
  }
  _saveOutbox();
}


// RTC sinyalleri için guaranteed delivery
const broadcastRTC=(p)=>broadcast(p,1);
// 🛡️ [HIGH-01] ECDH public key presence'a eklendi — per-peer şifreleme için
const sendPresence=async()=>{
  if(!ME)return;
  const ecdhKey=await getMyECDHPubKeyJwk();
  // 🛡️ [HIGH-03]/[YENİ-H2]/[HIGH-04] Sunucu onaylı kimlik pasaportu +
  // bu presence'a özel tek seferlik Ed25519 imza eklenir. Pasaport
  // alınamazsa (sunucu erişilemez/WebCrypto desteklenmiyor) presence yine
  // de gönderilir ama kimliksiz kalır — karşı taraflar bu durumda bizimle
  // WebRTC bağlantısı KURMAZ (bkz. handleSig → presence, _dcHandleOffer).
  let idFields = {};
  try{
    const pp = await _ensureIdentityPassport();
    const nonce = Date.now().toString(36) + '.' + Math.random().toString(36).slice(2,10);
    const presenceSig = await _signPresenceNonce(nonce);
    idFields = { passport: pp.passport, passportSig: pp.signature, nonce, presenceSig };
  }catch(e){
    console.error('[SEC] Kimlik pasaportu olmadan presence gönderiliyor (peer\'lar bağlanmayacak):', e);
  }
  broadcast({type:'presence',from:ME.user_id,avatar:ME.avatar||null,v:APP_VERSION,
    status:myStatus||'available',
    customEmoji:(window.myCustomStatus&&myCustomStatus.emoji)||'',
    customText:(window.myCustomStatus&&myCustomStatus.text)||'',
    ecdhKey, // P-256 public key JWK — private key asla gönderilmez
    ...idFields
  });
};

// ── SİNYAL ────────────────────────────────────────────────────────
// 🛡️ [SAST-1 FIX] Bir grup üyesinin SADECE kendini üye listesinden çıkarması
// (gruptan ayrılma) admin yetkisi gerektirmeyen tek meşru group_update
// senaryosu — bunu her şeyden ayırt etmek için yardımcı fonksiyon.
function _isValidSelfLeave(oldMembers, newMembers, from){
  if(!Array.isArray(oldMembers)||!Array.isArray(newMembers)) return false;
  if(!oldMembers.includes(from)||newMembers.includes(from)) return false;
  const oldSet=new Set(oldMembers.filter(m=>m!==from));
  const newSet=new Set(newMembers);
  if(oldSet.size!==newSet.size) return false;
  for(const m of oldSet) if(!newSet.has(m)) return false;
  return true;
}

async function handleSig(d){
  // ── WebRTC DataChannel sinyalleri — DC kurulumu için MQTT üzerinden gelir ──
  if(d.type==='dc_offer'||d.type==='dc_answer'||d.type==='dc_ice'){
    if(!_isDcSignalForMe(d)){
      console.warn('[DC][SEC] Hedefi bu istemci olmayan DC sinyali atlandi:', d.type, d?.from, '->', d?.to);
      return;
    }
    if(d.type==='dc_offer'){ await _dcHandleOffer(d); return; }
    if(d.type==='dc_answer'){ await _dcHandleAnswer(d); return; }
    if(d.type==='dc_ice')  { await _dcHandleIce(d); return; }
  }

  if(d.type==='check_user_id'){
    if(ME&&ME.user_id.toLowerCase()===d.user_id.toLowerCase()) broadcast({type:'user_id_taken',to:d.reqId});
    return;
  }
  if(d.type==='user_id_taken'&&chkPending&&d.to===window._rqId){nameTaken=true;return;}
  if(!ME)return;
  if(d.from&&blocked.includes(d.from))return;
  const db=getDB(), mk=ME.user_id.toLowerCase();

  if(d.type==='presence'){
    const wasOffline = !isOn(d.from);
    peers[d.from]=now();
    if(d.avatar&&d.avatar!=='null'&&d.avatar!==null) avatars[d.from]=d.avatar;
    if(d.v) peerVersions[d.from]=d.v;
    if(d.status) peerStatuses[d.from]=d.status;
    // 🛡️ [HIGH-01] ECDH public key sakla — bu peer'a gönderilecek özel mesajlar şifreli olacak
    if(d.ecdhKey) storePeerPublicKey(d.from, d.ecdhKey);

    // ── WebRTC DataChannel: arkadaşlar ile P2P bağlantı kur ──
    // 🛡️ [HIGH-03]/[YENİ-H2]/[HIGH-04] Bu presence'taki kimlik pasaportu
    // önbelleğe alınır; _dcHandleOffer de gelen offer'ı kabul etmeden önce
    // aynı önbelleği kullanarak doğrulama yapar (initiator OLMAYAN taraf için).
    if(d.passport && d.passportSig && d.nonce && d.presenceSig){
      _lastPresenceIdentity[d.from] = {passport:d.passport, passportSig:d.passportSig, nonce:d.nonce, presenceSig:d.presenceSig};
    } else {
      delete _lastPresenceIdentity[d.from];
      _verifiedPeers.delete(d.from);
    }
    // Lexicographic sıra ile initiator taraf belirlenir (her iki taraf da aynı kararı verir)
    if(d.from !== ME.user_id){
      const myFriends = (db.users[mk]?.friends)||[];
      const isFriend  = myFriends.includes(d.from);
      if(isFriend){
        const peer = _dcPeers[d.from];
        const needsConnect = !peer || peer.state==='closed';
        if(needsConnect && ME.user_id < d.from){
          // Biz initiator'ız — ama ÖNCE kimlik pasaportunu doğrula.
          // Doğrulama başarısız/eksikse (sahte/tahrif edilmiş kimlik,
          // olası MITM) WebRTC bağlantısı ASLA kurulmaz.
          _ensurePeerVerified(d.from).then(ok=>{
            if(ok){
              const p2 = _dcPeers[d.from];
              if(!p2 || p2.state==='closed') _dcConnect(d.from);
            } else {
              console.warn('[SEC] Kimlik doğrulanamadı — WebRTC bağlantısı reddedildi:', d.from);
              if(typeof showToast==='function') showToast('⚠️ Güvenlik Uyarısı', '"'+d.from+'" için kimlik doğrulanamadı, bağlantı kurulmadı.');
            }
          });
        }
        // Eğer d.from < ME.user_id ise karşı taraf offer gönderecek, biz bekleriz
        // (kabul ânında _dcHandleOffer aynı doğrulamayı yapar)
      }
    }
    if(d.customEmoji!==undefined||d.customText!==undefined){
      if(!window.peerCustomStatuses) window.peerCustomStatuses={};
      peerCustomStatuses[d.from]={emoji:d.customEmoji||'',text:d.customText||''};
    }
    updateFriends();
    // Kişi yeni online olduysa — bildirim sistemi üstlenir
    if(chatId===d.from&&chatType==='private'){
      const sc=peerStatuses[d.from]||'available';
      $('chatDot').className=`sdot status-dot status-${sc}`;
      if($('chatSub').dataset.t!=='1'){
        const sLabel={available:'Çevrimiçi',busy:'Meşgul',dnd:'Rahatsız Etme',away:'Uzakta'}[sc]||'Çevrimiçi';
        const sColor={available:'var(--ok)',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b'}[sc]||'var(--ok)';
        let _sub=`<span style="color:${sColor}">${sLabel}</span>`;
        // Özel durum varsa altına ekle
        if(window.peerCustomStatuses?.[d.from]?.text){
          const _cs=peerCustomStatuses[d.from];
          // 🛡️ [MED-02] Emoji alanı da escape ediliyor
          const _safeEmoji=escHtml(_cs.emoji||'');
          _sub+=`<span style="display:block;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${_safeEmoji?_safeEmoji+' ':''}${escHtml(_cs.text)}</span>`;
        }
        $('chatSub').innerHTML=_sub;
      }
      // 🛡️ [HIGH-06] Avatar URL dogrulandı — innerHTML yerine setAvatarEl kullanılıyor
      if(avatars[d.from]) setAvatarEl($('chatAv'), avatars[d.from], d.from.charAt(0).toUpperCase());
    }
    return;
  }

  if(d.type==='typing'&&d.to===ME.user_id){
    // Track for search display
    clearTimeout(_typingTimers[d.from]);
    if(d.on){
      _typingUsers.add(d.from);
      // Karşı taraf "yazmayı durdurdu" sinyalini gönderemezse (bağlantı koptu vb.)
      // gösterge sonsuza dek takılı kalmasın — 6 sn sonra otomatik temizle.
      _typingTimers[d.from]=setTimeout(()=>{
        _typingUsers.delete(d.from);
        if(chatId===d.from&&chatType==='private'&&$('chatSub').dataset.t==='1'){
          $('chatSub').dataset.t='0';
          $('chatSub').innerHTML=isOn(d.from)?'<span style="color:var(--ok)">Çevrimiçi</span>':'Özel Mesaj';
        }
        updateFriends();
      },6000);
    } else {
      _typingUsers.delete(d.from);
    }
    if(chatId===d.from&&chatType==='private'){
      if(d.on){$('chatSub').dataset.t='1';$('chatSub').innerHTML='<span style="color:var(--ok);display:inline-flex;align-items:center;gap:5px">Yazıyor <span class="ta"><span></span><span></span><span></span></span></span>';}
      else{$('chatSub').dataset.t='0';$('chatSub').innerHTML=isOn(d.from)?'<span style="color:var(--ok)">Çevrimiçi</span>':'Özel Mesaj';}
    }
    updateFriends();
    return;
  }

  if(d.type==='friend_req'&&d.to==='global'){
    if(d.from===ME.user_id)return;
    if(d.target===mk||d.target===ME.token.toLowerCase()){
      if(!db.users[mk].friends.includes(d.from)&&!db.users[mk].requests.includes(d.from)&&!blocked.includes(d.from)){
        db.users[mk].requests.push(d.from);saveDB(db);updateUI();
        showToast('Yeni İstek',`${d.from} sizi eklemek istiyor.`);
      }
    }
    return;
  }
  if(d.type==='friend_accept'&&d.to===ME.user_id){
    if(!db.users[mk].friends.includes(d.from)){
      db.users[mk].friends.push(d.from);
    }
    // pending listesinden çıkar
    if(db.users[mk].pending)db.users[mk].pending=db.users[mk].pending.filter(p=>p!==d.from.toLowerCase());
    saveDB(db);updateUI();showToast('Kabul Edildi',`${d.from} arkadaşlık isteğini kabul etti.`);
    return;
  }
  if(d.type==='friend_remove'&&d.to===ME.user_id){
    db.users[mk].friends=db.users[mk].friends.filter(f=>f!==d.from);saveDB(db);
    if(chatId===d.from){chatId=null;chatType=null;$('emptyState').classList.remove('hidden');}
    updateUI();showToast('Arkadaşlık Bitti',`${d.from} sizi listeden çıkardı.`);
    return;
  }

  if(d.type==='private_msg'&&d.to===ME.user_id){
    if(d.from===ME.user_id)return;
    // Arkadaş değilse veya engellenmiş ise mesajı işleme
    const myFriends=db.users[mk]?.friends||[];
    if(!myFriends.includes(d.from)||blocked.includes(d.from))return;
    const k=[ME.user_id,d.from].sort().join('_');
    if(!db.messages[k])db.messages[k]=[];
    if(d.msg.id&&db.messages[k].some(m=>m.id===d.msg.id))return;
    // Gelen dosya/gif verisini oturum belleğine kaydet
    if(d.msg.fileData&&d.msg.fileData&&!d.msg.fileData.startsWith('__')){
      _sessionFiles.set(d.msg.id, d.msg.fileData);
      d.msg.fileData='__session__'+d.msg.id;
    }
    db.messages[k].push(d.msg);saveDB(db);
    if(chatId===d.from&&chatType==='private'){renderChat();markAsRead(d.from);}
    else if(!isSilentMode()){
      const _msgBody=d.msg.fileType?`📎 ${d.msg.fileName||'Dosya'}`:d.msg.text;
      if(document.visibilityState!=='visible') _playMsgSound();
      else playSound('msg');
      showToast(d.from, _msgBody);
      // 📱 Mobilede her durumda native bildirim gönder; masaüstünde sadece arka planda
      const _isMob=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const _msgAppVis=document.visibilityState==='visible'&&document.hasFocus();
      if(!_msgAppVis||_isMob) _sendNativeNotif(d.from, _msgBody, 'sv-msg');
    }
    return;
  }
  if(d.type==='group_invite'){
    const g=d.group;
    // 🛡️ [SAST-5 FIX] Önceden d.group bütünüyle güvenilip DB'ye yazılıyordu —
    // tip/uzunluk/içerik kontrolü yoktu. Tam bir sunucu-taraflı yetki kontrolü
    // bu istemci-güvenir-istemci mimarisinde mümkün değil (bkz. not), ama en
    // azından temel şekil doğrulaması ve groupId çakışma/ele geçirme koruması
    // eklenir.
    if(g && typeof g==='object' && typeof g.id==='string' && g.id.length<128 && g.id.startsWith('GRP_')
       && typeof g.name==='string' && g.name.length>0 && g.name.length<=64
       && Array.isArray(g.members) && g.members.length>0 && g.members.length<=500
       && g.members.includes(ME.user_id) && !db.groups[g.id]){
      if(!g.admins){
        // Eski format uyumluluğu: admin string ise diziye çevir
        g.admins=g.admin?[g.admin]:[d.from];
      }
      db.groups[g.id]=g;saveDB(db);updateUI();showToast('Yeni Grup',`${d.from} sizi '${g.name}' grubuna ekledi.`);
    }
    return;
  }
  if(d.type==='group_msg'){
    if(!db.groups[d.groupId]||d.from===ME.user_id)return;
    const k='g_'+d.groupId;
    if(!db.messages[k])db.messages[k]=[];
    if(d.msg.id&&db.messages[k].some(m=>m.id===d.msg.id))return;
    // Gelen dosya/gif verisini oturum belleğine kaydet
    if(d.msg.fileData&&!d.msg.fileData.startsWith('__')){
      _sessionFiles.set(d.msg.id, d.msg.fileData);
      d.msg.fileData='__session__'+d.msg.id;
    }
    db.messages[k].push(d.msg);saveDB(db);
    if(chatId===d.groupId&&chatType==='group'){
      renderChat();
      broadcastGroupRead(d.groupId, d.msg.id, d.from);
    } else if(!isSilentMode()){
      playSound('msg');
      showToast(db.groups[d.groupId].name,`${d.from}: ${d.msg.fileType?`📎 ${d.msg.fileName||'Dosya'}`:d.msg.text}`);
      // 📱 Mobilede her durumda native bildirim; masaüstünde sadece arka planda
      const _isMobG=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const _grpAppVis=document.visibilityState==='visible'&&document.hasFocus();
      if(!_grpAppVis||_isMobG) _sendNativeNotif(db.groups[d.groupId].name,`${d.from}: ${d.msg.fileType?'📎 Dosya':d.msg.text}`,'sv-grp');
    }
    return;
  }

  // Grup okundu bildirimi
  if(d.type==='group_read'&&d.to===ME.user_id){
    const db2=getDB();
    const k='g_'+d.groupId;
    if(db2.messages[k]){
      let ch=false;
      db2.messages[k].forEach(m=>{
        if(m.id===d.msgId||true){ // tüm önceki mesajları oku
          if(!m.readBy)m.readBy=[];
          if(!m.readBy.includes(d.from)){m.readBy.push(d.from);ch=true;}
        }
      });
      if(ch){saveDB(db2);if(chatId===d.groupId)renderChat();}
    }
    return;
  }

  if(d.to!==ME.user_id)return;
  if(d.type==='rtc_offer'){
    // ICE restart offer — aktif arama varken geliyorsa yeniden müzakere et
    if(d.iceRestart && pc && pc.signalingState !== 'closed'){
      try{
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        broadcastRTC({type:'rtc_answer',to:d.from,from:ME.user_id,sdp:pc.localDescription});
        // [FIX] Restart offer başarıyla işlendi — 10sn timeout'u iptal et
        if(pc._iceRestartTimer){ clearTimeout(pc._iceRestartTimer); pc._iceRestartTimer=null; }
      }catch(e){ console.warn('[ICE] restart answer hatası:', e); endCall('❌ ICE restart başarısız.'); }
      return;
    }
    // Zaten aktif bir 1-1 arama varsa yeni gelen offer'ı reddet
    if(pc&&pc.iceConnectionState!=='closed'&&pc.iceConnectionState!=='failed'){
      broadcastRTC({type:'rtc_busy',to:d.from,from:ME.user_id});
      return;
    }
    // Duplikat offer koruma — aynı from'dan 3 saniye içinde tekrar gelirse ignore
    const _offerKey='offerDedup_'+d.from;
    if(window[_offerKey]){return;} // Zaten işleniyor
    window[_offerKey]=true;
    setTimeout(()=>{window[_offerKey]=false;},3000);
    // Modal zaten açıksa tekrar açma
    if(!$('callModal').classList.contains('hidden')){return;}
    cleanCall();window._offer=d;$('callerName').innerText=d.from;$('callModal').classList.remove('hidden');if(!isSilentMode())_notifyIncomingCall(d.from);
  }
  else if(d.type==='rtc_answer'&&pc){
    _hideRinging(); _stopCallNotif();
    await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    for(const cand of iceQ){try{await pc.addIceCandidate(new RTCIceCandidate(cand));}catch(e){}}
    iceQ=[];
    pc._setupDone=true; // caller: answer alindi, renegotiation artik serbest
  }
  // Renegotiation — karşı taraf video açtı/kapattı
  else if(d.type==='rtc_renego'&&pc&&pc.signalingState!=='closed'){
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      const ans=await pc.createAnswer();
      await pc.setLocalDescription(ans);
      broadcastRTC({type:'rtc_renego_ans',to:d.from,from:ME.user_id,sdp:pc.localDescription});
    }catch(e){console.warn('renego err:',e);}
  }
  else if(d.type==='rtc_renego_ans'&&pc&&pc.signalingState!=='closed'){
    try{await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));}
    catch(e){console.warn('renego_ans err:',e);}
  }
  else if(d.type==='rtc_ice'){
    if(pc&&pc.remoteDescription){ try{await pc.addIceCandidate(new RTCIceCandidate(d.cand));}catch(e){console.warn('ICE add:',e);} }
    else iceQ.push(d.cand);
  }
  else if(d.type==='rtc_end')endCall(`Çağrı ${d.from} tarafından kapatıldı.`);
  else if(d.type==='rtc_reject')endCall(`${d.from} aramayı reddetti.`);
  else if(d.type==='rtc_busy'){_hideRinging();_stopCallNotif();showToast('Meşgul',`${d.from} şu anda başka bir aramada.`);endCall('');}
  else if(d.type==='screen_started'){
    screenOwner=d.from;
    $('screenInd').classList.remove('hidden');
    $('screenBtn').disabled=true;
    $('screenBtn').innerText='İzleniyor...';
    // remoteVideo zaten ontrack ile dolacak, sadece göster
    $('audioPh').classList.add('hidden');
    showToast('Ekran Paylaşımı',`${d.from} ekranını paylaşıyor.`);
  }
  else if(d.type==='screen_ended'){
    screenOwner=null;
    $('screenInd').classList.add('hidden');
    $('screenBtn').disabled=false;
    $('screenBtn').innerText='Ekran Paylaş';
    // Video dondurma sorununu çöz — srcObject'i null'a çek, sonra tekrar audio'ya dön
    const rv=$('remoteVideo');
    rv.pause();
    rv.srcObject=null;
    rv.classList.add('hidden');
    $('audioPh').classList.remove('hidden');
    // Aktif ses akışını geri yükle — aramadaysa audio stream'i yeniden bağla
    const audioConn = pc || Object.values(groupCallPeers||{})[0]?.pc;
    if(audioConn){
      audioConn.getReceivers().forEach(r=>{
        if(r.track&&r.track.kind==='audio'&&r.track.readyState==='live'){
          const a=new Audio();a.srcObject=new MediaStream([r.track]);a.play().catch(()=>{});
        }
      });
    }
  }
}

const isOn=u=>peers[u]&&(now()-peers[u]<20000);

// ICE gathering tamamlanana kadar bekle — max 4 saniye
function waitForIceGathering(pc){
  return new Promise(resolve=>{
    if(pc.iceGatheringState==='complete'){resolve();return;}
    const done=()=>{
      pc.removeEventListener('icegatheringstatechange',onchange);
      clearTimeout(timer);
      resolve();
    };
    const onchange=()=>{ if(pc.iceGatheringState==='complete') done(); };
    pc.addEventListener('icegatheringstatechange',onchange);
    const timer=setTimeout(done, 4000); // [FIX] 2000→4000ms — TURN sunucusu için yeterli süre
  });
}

// ── PARTICLE ENGINE ────────────────────────────────────────────────
const canvas=$('pCanvas'), ctx2=canvas.getContext('2d');
canvas.width=window.innerWidth; canvas.height=window.innerHeight;
window.addEventListener('resize',()=>{canvas.width=window.innerWidth;canvas.height=window.innerHeight;});

let particles=[];
function spawnParticles(x,y,count=18,colorBase='#6366f1'){
  if(!$('toggleParticles').checked)return;
  const colors=[colorBase,'#818cf8','#c7d2fe','#e0e7ff','#fff'];
  for(let i=0;i<count;i++){
    particles.push({
      x,y,
      vx:(Math.random()-.5)*6,
      vy:(Math.random()-1)*7-2,
      r:Math.random()*4+2,
      color:colors[Math.floor(Math.random()*colors.length)],
      life:1,
      decay:Math.random()*.02+.015
    });
  }
}
function animParticles(){
  ctx2.clearRect(0,0,canvas.width,canvas.height);
  particles=particles.filter(p=>p.life>0);
  for(const p of particles){
    p.x+=p.vx; p.y+=p.vy; p.vy+=.15; p.life-=p.decay;
    ctx2.save();
    ctx2.globalAlpha=Math.max(0,p.life);
    ctx2.beginPath();
    ctx2.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx2.fillStyle=p.color;
    ctx2.fill();
    ctx2.restore();
  }
  requestAnimationFrame(animParticles);
}
animParticles();

function msgParticles(){
  const btn=$('sendBtn');
  if(!btn)return;
  const r=btn.getBoundingClientRect();
  spawnParticles(r.left+r.width/2, r.top+r.height/2, 22, '#6366f1');
}

// ── LOGIN EKRANI ─────────────────────────────────────────────────
function renderLoginAccounts(){
  const list=getAccounts();
  const db=getDB();
  if(list.length===0)return;
  const el=$('savedAccountsList');
  el.classList.remove('hidden');
  $('orDivider').classList.remove('hidden');
  el.innerHTML='<p style="font-size:11px;color:var(--muted);margin:0;font-weight:700;padding:10px 14px 6px;text-transform:uppercase;letter-spacing:.5px">Kayıtlı Hesaplar</p>'+
    list.map(key=>{
      const u=db.users[key];
      if(!u)return'';
      // 🛡️ [HIGH-06] Kayıtlı hesap avatarı dogrulaması
      const safeAv=sanitizeAvatarUrl(u.avatar);
      const av=safeAv
        ?`<img src="${safeAv}" style="width:100%;height:100%;object-fit:cover;">`
        :escHtml(u.user_id.charAt(0).toUpperCase());
      return `<div class="acc-item" data-acc-key="${escHtml(key)}">
        <div class="acc-av">${av}</div>
        <div style="text-align:left;flex:1">
          <strong style="display:block;font-size:14px">${u.user_id}</strong>
          <span style="font-size:11px;color:var(--muted)">${u.token}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--primary);font-size:12px;font-weight:600">Giriş →</span>
          <button class="acc-del-btn" data-acc-key="${escHtml(key)}" title="Hesabı Kaldır"
            style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;padding:4px 6px;min-width:auto;border-radius:6px;transition:.15s;line-height:1">🗑️</button>
        </div>
      </div>`;
    }).join('');
}

// 🛡️ [CSP-FIX] Hesap satırları dinamik (her hesap için farklı key) olduğundan
// inline onclick="..." CSP hash listesiyle ASLA eşleşemez (her key farklı hash
// üretir). Bunun yerine data-acc-key + tek seferlik event delegation kullanılır.
(()=>{
  const container=$('savedAccountsList');
  if(!container) return;
  container.addEventListener('click',(e)=>{
    const delBtn=e.target.closest('.acc-del-btn');
    if(delBtn){
      e.stopPropagation();
      const key=delBtn.getAttribute('data-acc-key');
      if(key) confirmDeleteAccount(key);
      return;
    }
    const item=e.target.closest('.acc-item');
    if(item){
      const key=item.getAttribute('data-acc-key');
      if(key) loginAs(key);
    }
  });
})();

window.loginAs=async(key)=>{
  const db=getDB();
  if(!db.users[key])return;
  const user=db.users[key];
  const k=_sanitizeUsername(key).toLowerCase()||key;

  if(pwExists(k)){
    $('authUsername').value=user.user_id;
    $('authPassword').value='';
    $('authStatus').innerText='Şifrenizi girin.';
    $('firstLoginBanner').style.display='none';
    $('authBtn').innerText='Giriş Yap';
    setTimeout(()=>$('authPassword').focus(),80);
  } else {
    $('authUsername').value=user.user_id;
    $('authPassword').value='';
    $('authStatus').innerText='';
    $('firstLoginBanner').style.display='block';
    $('authBtn').innerText='Şifre Belirle ve Giriş Yap';
    setTimeout(()=>$('authPassword').focus(),80);
  }
};

// ── HESAP SİLME ───────────────────────────────────────────────────
window.confirmDeleteAccount=(key)=>{
  const db=getDB();
  const u=db.users[key];
  if(!u) return;

  // Modal oluştur
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)';
  overlay.innerHTML=`
    <div style="background:var(--panel);border-radius:20px;padding:32px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);border:1px solid var(--border);animation:modalIn .25s cubic-bezier(.34,1.56,.64,1) both">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <h3 style="margin:0 0 8px;color:var(--text);font-size:18px;font-weight:700">Hesabı Kaldır</h3>
      <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 8px">
        <strong style="color:var(--text)">${u.user_id}</strong> hesabını bu cihazdan kaldırmak istiyor musun?
      </p>
      <p style="color:var(--danger);font-size:12px;margin:0 0 24px;padding:10px 14px;background:rgba(237,66,69,.08);border-radius:10px;border:1px solid rgba(237,66,69,.2)">
        Bu işlem geri alınamaz. Tüm mesajlar ve veriler kalıcı olarak silinir.
      </p>
      <div style="display:flex;gap:10px">
        <button id="_delCancelBtn" style="flex:1;padding:13px;border-radius:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);font-weight:600;font-size:14px;cursor:pointer">Vazgeç</button>
        <button id="_delConfirmBtn" style="flex:1;padding:13px;border-radius:12px;background:var(--danger);color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer">Sil 🗑️</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#_delCancelBtn').onclick=()=>overlay.remove();
  overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove();};
  overlay.querySelector('#_delConfirmBtn').onclick=()=>{
    // Tüm localStorage key'lerini temizle
    const db2=getDB();
    delete db2.users[key];
    // Bu kullanıcıya ait mesajları temizle
    Object.keys(db2.messages||{}).forEach(k2=>{
      if(k2===key||k2.startsWith(key+'_')||k2.endsWith('_'+key)){
        delete db2.messages[k2];
      }
    });
    saveDB(db2);
    // Şifreyi sil
    try{localStorage.removeItem('sv_pw_'+key);}catch(e){}
    // Hesap listesinden çıkar
    try{
      const list=getAccounts().filter(a=>a!==key);
      localStorage.setItem(ACC_KEY,JSON.stringify(list));
    }catch(e){}
    overlay.remove();
    renderLoginAccounts();
    showDeletedToast(u.user_id);
  };
};

function showDeletedToast(name){
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#1e293b;color:#e2e8f0;padding:14px 22px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:10001;font-size:14px;font-weight:600;border:1px solid #334155;animation:si .3s ease-out both';
  t.textContent=`✅ "${name}" hesabı kaldırıldı`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// ══════════════════════════════════════════════════════════════════
//  🛡️ BRUTE FORCE KORUMA SİSTEMİ v1.0
//  — Her kullanıcı adı için başarısız deneme sayısı tutulur
//  — 5 yanlış deneme → 30 saniye kilit
//  — 10 yanlış deneme → 5 dakika kilit
//  — 20 yanlış deneme → 30 dakika kilit (kalıcı değil)
//  — Kilit süresi dolunca otomatik açılır
// ══════════════════════════════════════════════════════════════════
const BF_KEY = 'sv_bf_store_v1';
const BF_THRESHOLDS = [
  { attempts: 5,  lockMs: 30_000,      label: '30 saniye' },
  { attempts: 10, lockMs: 5*60_000,    label: '5 dakika'  },
  { attempts: 20, lockMs: 30*60_000,   label: '30 dakika' },
];

function _getBFStore(){ try{ return JSON.parse(localStorage.getItem(BF_KEY)||'{}'); }catch(e){ return {}; } }
function _setBFStore(s){ try{ localStorage.setItem(BF_KEY, JSON.stringify(s)); }catch(e){} }

// ══════════════════════════════════════════════════════════════════
// 🛡️ [LOW-01] IndexedDB Yedek Deposu
// localStorage.removeItem('sv_bf_store_v1') ile kilidi açmak artık tek başına
// yetmiyor — IndexedDB'deki kopya, bir sonraki giriş denemesinde localStorage'ı
// geri doldurur. NOT: Bu nihai bir çözüm değildir (DevTools tam erişimiyle
// IndexedDB de temizlenebilir) — amaç sadece en yaygın/yüzeysel bypass
// yöntemini (sadece localStorage temizleme) etkisiz kılmaktır. Gerçek koruma
// için sunucu taraflı rate limiting şarttır.
// ══════════════════════════════════════════════════════════════════
let _bfIdbPromise = null;
function _bfOpenIdb(){
  if(_bfIdbPromise) return _bfIdbPromise;
  _bfIdbPromise = new Promise((resolve)=>{
    try{
      const req = indexedDB.open('sv_bf_shadow_v1', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('bf'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
  return _bfIdbPromise;
}
async function _bfIdbGet(user_id){
  try{
    const db = await _bfOpenIdb();
    if(!db) return null;
    return await new Promise(res=>{
      const tx = db.transaction('bf','readonly').objectStore('bf').get(user_id.toLowerCase());
      tx.onsuccess = () => res(tx.result || null);
      tx.onerror = () => res(null);
    });
  }catch(e){ return null; }
}
async function _bfIdbSet(user_id, entry){
  try{
    const db = await _bfOpenIdb();
    if(!db) return;
    db.transaction('bf','readwrite').objectStore('bf').put(entry, user_id.toLowerCase());
  }catch(e){}
}
async function _bfIdbDelete(user_id){
  try{
    const db = await _bfOpenIdb();
    if(!db) return;
    db.transaction('bf','readwrite').objectStore('bf').delete(user_id.toLowerCase());
  }catch(e){}
}
// Giriş denemesinden HEMEN ÖNCE çağrılır: localStorage temizlenmiş ama
// IndexedDB'de daha kısıtlayıcı bir kayıt varsa, localStorage'ı onunla geri doldurur.
async function _bfReconcile(user_id){
  try{
    const idbEntry = await _bfIdbGet(user_id);
    if(!idbEntry) return;
    const store = _getBFStore();
    const key = user_id.toLowerCase();
    const lsEntry = store[key] || { attempts:0, lockedUntil:0 };
    if(idbEntry.attempts > lsEntry.attempts || idbEntry.lockedUntil > lsEntry.lockedUntil){
      store[key] = { ...lsEntry, ...idbEntry, attempts: Math.max(idbEntry.attempts, lsEntry.attempts), lockedUntil: Math.max(idbEntry.lockedUntil, lsEntry.lockedUntil) };
      _setBFStore(store);
    }
  }catch(e){}
}

function bfGetEntry(user_id){
  const store = _getBFStore();
  return store[user_id.toLowerCase()] || { attempts: 0, lockedUntil: 0 };
}

function bfFail(user_id){
  const store = _getBFStore();
  const key   = user_id.toLowerCase();
  const entry = store[key] || { attempts: 0, lockedUntil: 0 };
  entry.attempts++;
  entry.lastFail = Date.now();
  // Eşik kontrol
  for(let i = BF_THRESHOLDS.length - 1; i >= 0; i--){
    if(entry.attempts >= BF_THRESHOLDS[i].attempts){
      entry.lockedUntil = Date.now() + BF_THRESHOLDS[i].lockMs;
      entry.lockLabel   = BF_THRESHOLDS[i].label;
      break;
    }
  }
  store[key] = entry;
  _setBFStore(store);
  // 🛡️ [LOW-01] IndexedDB'ye de yaz — localStorage tek başına temizlenirse kurtarılabilsin
  _bfIdbSet(user_id, entry).catch(()=>{});
  return entry;
}

function bfSuccess(user_id){
  const store = _getBFStore();
  delete store[user_id.toLowerCase()];
  _setBFStore(store);
  _bfIdbDelete(user_id).catch(()=>{});
}

function bfCheck(user_id){
  // Kilit durumunu döndür: null = serbest, { remaining, label } = kilitli
  const entry = bfGetEntry(user_id);
  if(!entry.lockedUntil || Date.now() > entry.lockedUntil) return null;
  const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = mins > 0 ? `${mins}dk ${secs}sn` : `${secs}sn`;
  return { remaining, timeStr, attempts: entry.attempts };
}

// Brute force kilit sayacı — giriş ekranında geri sayım gösterir
let _bfCountdownTimer = null;
function bfShowLock(user_id){
  clearInterval(_bfCountdownTimer);
  const statusEl = $('authStatus');
  const btn      = $('authBtn');

  function update(){
    const lock = bfCheck(user_id);
    if(!lock){
      clearInterval(_bfCountdownTimer);
      if(btn){ btn.disabled=false; btn.innerText='Giriş Yap'; }
      if(statusEl) statusEl.innerHTML='';
      return;
    }
    if(statusEl) statusEl.innerHTML=`🔒 Çok fazla yanlış deneme! <strong>${lock.timeStr}</strong> sonra tekrar dene. (${lock.attempts} deneme)`;
    if(btn){ btn.disabled=true; btn.innerText=`Kilitli (${lock.timeStr})`; }
  }
  update();
  _bfCountdownTimer = setInterval(update, 1000);
}

// ══════════════════════════════════════════════════════════════════
//  🛡️ DDOS / RATE LIMIT KORUMA SİSTEMİ v1.0
//  — MQTT publish'leri rate limit altında tutar
//  — Kısa sürede çok fazla mesaj → geçici throttle
//  — Bağlantı sayısı sınırlandırılır
//  — Uygulama içi spam koruması (mesaj gönderme hızı)
// ══════════════════════════════════════════════════════════════════
const _rateLimiter = {
  // Genel publish rate limiter
  _publishTimes: [],
  MAX_PER_SECOND: 5,     // saniyede max 5 mesaj
  MAX_PER_MINUTE: 60,    // dakikada max 60 mesaj
  BURST_WINDOW: 1000,    // 1 saniye penceresi
  MINUTE_WINDOW: 60000,  // 1 dakika penceresi
  _throttled: false,
  _throttleUntil: 0,

  canPublish(){
    if(this._throttled){
      if(Date.now() < this._throttleUntil) return false;
      this._throttled = false;
      this._publishTimes = [];
    }
    const now = Date.now();
    // Eski kayıtları temizle
    this._publishTimes = this._publishTimes.filter(t => now - t < this.MINUTE_WINDOW);
    const lastSecond   = this._publishTimes.filter(t => now - t < this.BURST_WINDOW);

    if(lastSecond.length >= this.MAX_PER_SECOND){
      // Burst — 3 saniye throttle
      this._throttled    = true;
      this._throttleUntil= now + 3000;
      console.warn('[DDOS] Burst rate limit aşıldı, 3 sn throttle');
      return false;
    }
    if(this._publishTimes.length >= this.MAX_PER_MINUTE){
      // Dakika limiti — 15 saniye throttle
      this._throttled    = true;
      this._throttleUntil= now + 15000;
      console.warn('[DDOS] Dakika rate limit aşıldı, 15 sn throttle');
      return false;
    }
    this._publishTimes.push(now);
    return true;
  }
};

// Bağlantı yeniden bağlanma rate limiter (DDoS broker koruması)
const _reconnectLimiter = {
  _times: [],
  MAX_RECONNECTS: 5,
  WINDOW: 60000, // 1 dakika

  canReconnect(){
    const now = Date.now();
    this._times = this._times.filter(t => now - t < this.WINDOW);
    if(this._times.length >= this.MAX_RECONNECTS){
      console.warn('[DDOS] Reconnect limit aşıldı, bağlantı beklemede');
      return false;
    }
    this._times.push(now);
    return true;
  }
};

$('authBtn').onclick=async()=>{
  // 🔔 Bildirim iznini USER GESTURE içinde hemen iste (mobilede şart)
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission().then(r=>{
      window._notifGranted=(r==='granted');
      _updateMobilBildirimUI();
    }).catch(()=>{});
  }

  const rawName=$('authUsername').value.trim();
  const rawPw=$('authPassword').value;

  // ── Injection koruması: sanitize ve validate ──────────────────
  const name=_sanitizeUsername(rawName);
  const pw=_sanitizePassword(rawPw);

  if(!_validateUsername(name)){$('authStatus').innerText='Kullanıcı adı: 3-16 karakter, harf/rakam/_ kullanın.';return;}
  if(!_validatePassword(pw)){$('authStatus').innerText='Şifre en az 6 karakter olmalı.';return;}

  // ── 🛡️ BRUTE FORCE KONTROLÜ ──────────────────────────────────
  // [LOW-01] localStorage temizlenmiş olabilir — IndexedDB'den geri doldur
  await _bfReconcile(name);
  const bfLock = bfCheck(name);
  if(bfLock){
    bfShowLock(name);
    return;
  }

  const k=name.toLowerCase();
  $('authBtn').disabled=true;
  $('authBtn').innerText='Kontrol ediliyor...';
  $('authStatus').innerText='';

  // Sanitize edilmiş değeri input'a geri yaz
  $('authUsername').value=name;

  const dbCheck=getDB();

  // ── Mevcut kullanıcı ──────────────────────────────────────────
  if(dbCheck.users[k]){
    if(pwExists(k)){
      $('authBtn').innerText='Doğrulanıyor...';
      const ok=await pwVerify(k, pw);
      if(!ok){
        // 🛡️ Başarısız denemeyi kaydet
        bfFail(name);
        bfShowLock(name);
        $('authPassword').value='';
        $('authPassword').focus();
        return;
      }
    } else {
      // Şifresi yok → belirle
      $('authBtn').innerText='Şifre oluşturuluyor...';
      await pwSave(k, pw);
    }
    $('firstLoginBanner').style.display='none';
    ME=dbCheck.users[k]; blocked=ME.blocked||[];
    saveAccount(k);
    localStorage.setItem(SES_KEY,k);
    sessionMark(k); // ← Sayfa yenilenince şifre sormaz
    bfSuccess(name); // 🛡️ Başarılı giriş → brute force sayacı sıfırla
    clearInterval(_bfCountdownTimer);
    $('authScreen').style.display='none';$('mainApp').classList.remove('hidden');document.body.classList.add('sv-logged-in');
    $('authBtn').disabled=false;$('authBtn').innerText='Giriş Yap';
    updateUI(); setTimeout(sendPresence,500);
    // ME.username tanımlandıktan hemen sonra bu fonksiyonu çağır:
    initPushNotifications();
    // 🎤📷 Giriş sonrası medya izni iste (arama hazırlığı)
    setTimeout(()=>_requestMediaPermissionsOnLogin(), 1800);
    return;
  }

  // ── Yeni kullanıcı ───────────────────────────────────────────
  const doCreate=async()=>{
    const db=getDB();
    if(!db.users[k]){
      db.users[k]={user_id:name,token:'T-'+uid().toUpperCase(),friends:[],requests:[],blocked:[]};
      saveDB(db);
    }
    $('authBtn').innerText='Şifre oluşturuluyor...';
    await pwSave(k, pw);
    $('firstLoginBanner').style.display='none';
    ME=db.users[k]; blocked=ME.blocked||[];
    saveAccount(k);
    localStorage.setItem(SES_KEY,k);
    sessionMark(k); // ← Sayfa yenilenince şifre sormaz
    bfSuccess(name); // 🛡️ Brute force sıfırla
    clearInterval(_bfCountdownTimer);
    $('authScreen').style.display='none';$('mainApp').classList.remove('hidden');document.body.classList.add('sv-logged-in');
    $('authBtn').disabled=false;$('authBtn').innerText='Giriş Yap';
    updateUI(); setTimeout(sendPresence,500);
    // ME.username tanımlandıktan hemen sonra bu fonksiyonu çağır:
    initPushNotifications();
    // 🎤📷 Giriş sonrası medya izni iste
    setTimeout(()=>_requestMediaPermissionsOnLogin(), 1800);
  };

  if(mq&&mq.connected){
    window._rqId=uid(); chkPending=true; nameTaken=false;
    broadcast({type:'check_user_id',user_id:name,reqId:window._rqId});
    setTimeout(async()=>{
      chkPending=false;
      if(nameTaken){
        $('authStatus').innerText='Bu isim şu an başka biri tarafından kullanılıyor!';
        $('authBtn').disabled=false;$('authBtn').innerText='Giriş Yap';
        return;
      }
      await doCreate();
    },1800);
  } else {
    $('authStatus').innerText='Ağa bağlanılıyor...';
    setTimeout(doCreate, 500);
  }
};
$('authUsername').addEventListener('keypress',e=>{if(e.key==='Enter')$('authPassword').focus();});
$('authPassword').addEventListener('keypress',e=>{if(e.key==='Enter')$('authBtn').click();});

// ── UI ────────────────────────────────────────────────────────────
function updateUI(){
  if(!ME)return;
  const db=getDB(),me=db.users[ME.user_id.toLowerCase()];
  // Legacy myName (sidebar status row'da gösterilir)
  const myNameEl=$('myName');
  if(myNameEl) myNameEl.innerText=ME.user_id;
  const dot=document.createElement('span');dot.className='online-dot';
  // Artık myName sadece text, dot eklemiyoruz (sidebar'da ayrı gösteriliyor)
  $('myToken').innerText=`Totem: ${ME.token}`;
  $('spToken').innerText=ME.token;
  // Kendi durum noktasını ayarla
  const myDot=$('myStatusDot');
  if(myDot){ myDot.style.background=STATUS_COLORS[myStatus]||'#10b981'; }
  // Status select'i mevcut duruma getir
  const sel=$('statusSelect');
  if(sel) sel.value=myStatus;

  const av=me.avatar;
  // Ana avatar (myAv — legacy, artık sidebar'da yok ama kodda referans var)
  const myAvEl=$('myAv');
  if(myAvEl){
    // 🛡️ [HIGH-06] Kendi avatar — setAvatarEl ile güvenli render
    if(av&&av.startsWith('data:')){
      setAvatarEl(myAvEl, av, ME.user_id.charAt(0).toUpperCase());
    } else {
      myAvEl.innerText=ME.user_id.charAt(0).toUpperCase();
    }
  }
  // Nav Rail avatar güncelle
  const dnrAvEl=$('dnrAv');
  if(dnrAvEl){
    // 🛡️ [HIGH-06] Nav rail avatar — setAvatarEl ile güvenli render
    if(av&&av.startsWith('data:')){
      setAvatarEl(dnrAvEl, av, ME.user_id.charAt(0).toUpperCase());
    } else {
      dnrAvEl.textContent=ME.user_id.charAt(0).toUpperCase();
    }
  }
  // Mobil bottom nav profil ikonu güncelle
  _updateBnavProfileIcon();

  const rl=me.requests.length;
  $('reqBadge').innerText=rl;
  rl?$('reqBadge').classList.remove('hidden'):$('reqBadge').classList.add('hidden');
  // Bottom nav badge sync
  const bnavBadge=$('bnavReqBadge');
  if(bnavBadge){bnavBadge.innerText=rl;rl?bnavBadge.classList.remove('hidden'):bnavBadge.classList.add('hidden');}
  // Nav rail badge sync
  const dnrBadge=$('dnrReqBadge');
  if(dnrBadge){dnrBadge.innerText=rl;rl?dnrBadge.classList.remove('hidden'):dnrBadge.classList.add('hidden');}
  updateFriends();

  const gs=Object.values(db.groups).filter(g=>g.members.includes(ME.user_id));
  $('groupsArea').innerHTML=gs.length?gs.map(g=>{
    const isAdmin=(g.admins||[g.admin]).includes(ME.user_id);
    // 🛡️ [LOW-04] Grup avatar dogrulaması — javascript: URL XSS önlendi
    const safeGrpAv=sanitizeAvatarUrl(g.avatar);
    const avHTML=safeGrpAv?`<img src="${safeGrpAv}" style="width:100%;height:100%;object-fit:cover;">`:'G';
    return `
    <div class="li ${chatId===g.id?'on':''}" data-act="selChat" data-a="${escHtml(g.id)}" data-a2="group">
      <div style="display:flex;align-items:center">
        <div class="av2" style="background:var(--ok);overflow:hidden">${avHTML}</div>
        <div class="fi">
          <strong>${escHtml(g.name)}</strong>
          <span class="sub">${g.members.length} üye${isAdmin?' · Yönetici':''}</span>
        </div>
      </div>
      <button data-act="openGroupDetail" data-a="${escHtml(g.id)}" data-stop="1"
        style="background:none;border:none;color:var(--muted);padding:4px 8px;font-size:18px;min-width:auto;cursor:pointer">⋮</button>
    </div>`}).join(''):`<div style="padding:15px;color:var(--muted);font-size:13px;text-align:center">Hiç grup yok.</div>`;

  $('lstR').innerHTML=me.requests.length?me.requests.map(r=>`
    <div class="li" style="cursor:default">
      <div style="display:flex;align-items:center;flex:1;min-width:0">
        <div class="av2">${r.charAt(0).toUpperCase()}</div>
        <span style="margin-left:10px;font-weight:600;font-size:13px">${r}</span>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-ok req-acc-btn" data-req-user="${escHtml(r)}" style="padding:5px 10px;font-size:12px;border-radius:8px">✓ Kabul</button>
        <button class="btn-d req-rej-btn" data-req-user="${escHtml(r)}" style="padding:5px 10px;font-size:12px;border-radius:8px">✗</button>
      </div>
    </div>`).join(''):`<div style="padding:20px 16px;text-align:center;color:var(--muted);font-size:13px;opacity:.7">Bekleyen istek yok.</div>`;

  updateBlockedList();
  // Profil paneli açıksa güncelle
  if($('panelProfile')&&$('panelProfile').classList.contains('active')) svUpdateProfilePanel();
}

// Versiyon badge sistemi kaldırıldı — Beta 3.5
function verBadge(user_id){ return ''; }

function updateFriends(){
  if(!ME)return;
  const db=getDB(),me=db.users[ME.user_id.toLowerCase()];
  if(!me)return;

  // ── Birleşik sohbet listesi: arkadaşlar + gruplar ─────────────
  const lstChats=$('lstChats');
  if(lstChats){
    const friendItems = me.friends.map(f=>{
      const on=isOn(f),ts=peers[f];
      const st=on?(peerStatuses[f]||'available'):'offline';
      const stColor={available:'var(--ok)',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b',offline:'#6b7280'};
      const stLabel={available:'Çevrimiçi',busy:'Meşgul',dnd:'Rahatsız Etme',away:'Uzakta'};
      let sub='Çevrimdışı';
      if(on) sub=`<span style="color:${stColor[st]}">${stLabel[st]||'Çevrimiçi'}</span>`;
      else if(ts){const d=Math.floor((now()-ts)/60000);sub=d<1?'Az önce':''+d+' dk önce';}
      // Özel durum göster (çevrimiçiyse)
      if(on && window.peerCustomStatuses?.[f]?.text){
        const cs=peerCustomStatuses[f];
        const csStr=`${cs.emoji?cs.emoji+' ':''}${cs.text}`;
        sub+=`<span style="display:block;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">${escHtml(csStr)}</span>`;
      }
      const rawAv=avatars[f];
      // 🛡️ [HIGH-06] Arkadaş avatarı dogrulaması
      const safeRawAv=sanitizeAvatarUrl(rawAv);
      const av=safeRawAv?`<img src="${safeRawAv}" style="width:100%;height:100%;object-fit:cover;">`:escHtml(f.charAt(0).toUpperCase());
      const isTypingToMe=_typingUsers.has(f);
      const typingBubble=isTypingToMe?`<span style="display:inline-flex;align-items:center;gap:2px;background:var(--sec);border-radius:8px;padding:1px 5px;font-size:10px;color:var(--primary);margin-left:4px"><span class="ta"><span></span><span></span><span></span></span></span>`:'';
      return `<div class="li ${chatId===f?'on':''}" data-act="selChat" data-a="${escHtml(f)}" data-a2="private" data-ctx-act="showCtx" data-ctx-a="${escHtml(f)}">
        <div style="display:flex;align-items:center;flex:1;min-width:0">
          <div class="av2" style="position:relative">${av}<span class="sdot status-dot" style="background:${stColor[st]}"></span></div>
          <div class="fi"><strong>${f}</strong>${verBadge(f)}<span class="sub">${sub}${typingBubble}</span></div>
        </div>
        <button data-act="showCtx" data-a="${escHtml(f)}" data-stop="1" data-pass-event="1" style="background:none;border:none;color:var(--muted);padding:4px 6px;font-size:16px;min-width:auto;cursor:pointer;flex-shrink:0">⋮</button>
      </div>`;
    });

    const gs=Object.values(db.groups).filter(g=>g.members.includes(ME.user_id));
    const groupItems = gs.map(g=>{
      const isAdmin=(g.admins||[g.admin]).includes(ME.user_id);
      // 🛡️ [HIGH-06] Grup avatarı dogrulaması
      const safeGrpAvF=sanitizeAvatarUrl(g.avatar);
      const avHTML=safeGrpAvF?`<img src="${safeGrpAvF}" style="width:100%;height:100%;object-fit:cover;">`:'G';
      // Aktif arama göstergesi — Discord tarzı
      const callInfo=activeGroupCalls[g.id];
      const callBadge=callInfo
        ? `<span style="display:inline-flex;align-items:center;gap:3px;background:#22c55e;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:4px;animation:glow 2s infinite">📞 ${callInfo.members.length} kişi</span>`
        : '';
      const subText=callInfo
        ? `<span style="color:#22c55e;font-size:11px">🔊 Aktif Arama — Katıl</span>`
        : `${g.members.length} üye${isAdmin?' · Yönetici':''}`;
      return `<div class="li ${chatId===g.id?'on':''}" data-act="selChat" data-a="${escHtml(g.id)}" data-a2="group">
        <div style="display:flex;align-items:center;flex:1;min-width:0">
          <div class="av2" style="background:${callInfo?'#22c55e':'var(--ok)'};overflow:hidden;${callInfo?'box-shadow:0 0 0 2px #22c55e':''}">${avHTML}</div>
          <div class="fi"><strong>${g.name}</strong>${callBadge}<span class="sub">${subText}</span></div>
        </div>
        <button data-act="openGroupDetail" data-a="${escHtml(g.id)}" data-stop="1" style="background:none;border:none;color:var(--muted);padding:4px 6px;font-size:16px;min-width:auto;cursor:pointer;flex-shrink:0">⋮</button>
      </div>`;
    });

    // Arkadaşlar bölümü
    let html = '';
    if(friendItems.length){
      html += `<div class="sv-list-section"><span>Arkadaşlar</span></div>`;
      html += friendItems.join('');
    }
    // Gruplar bölümü
    if(groupItems.length){
      html += `<div class="sv-list-section"><span>Gruplar</span>
        <button data-act="_uiNewGroup" style="background:var(--primary);color:#fff;border:none;padding:4px 12px;border-radius:14px;font-size:10px;font-weight:700;cursor:pointer;min-height:auto">+ Yeni</button>
      </div>`;
      html += groupItems.join('');
    } else {
      html += `<div class="sv-list-section"><span>Gruplar</span>
        <button data-act="_uiNewGroup" style="background:var(--primary);color:#fff;border:none;padding:4px 12px;border-radius:14px;font-size:10px;font-weight:700;cursor:pointer;min-height:auto">+ Yeni</button>
      </div>
      <div style="padding:20px 14px;color:var(--muted);font-size:13px;text-align:center;opacity:.7">
        <svg width="48" height="48" viewBox="0 0 48 48" style="margin-bottom:6px;opacity:.6" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="18" r="9" fill="none" stroke="var(--primary)" stroke-width="2"/>
          <path d="M8 40c0-8 7-13 16-13s16 5 16 13" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div>Henüz grup yok.</div>
      </div>`;
    }
    if(!html){
      html = `<div style="padding:30px 16px;text-align:center;color:var(--muted);font-size:13px">
        <div style="font-size:36px;margin-bottom:8px;opacity:.4">💬</div>
        Henüz kimse yok.<br>İstekler sekmesinden arkadaş ekle!
      </div>`;
    }
    lstChats.innerHTML = html;
  }

  // Legacy lstF de güncelle (JS kodun bazı kısımları bunu referans alıyor)
  const lstF=$('lstF');
  if(lstF) lstF.innerHTML='';

  // Global search açıksa güncelle
  const srchModal=$('globalSearchModal');
  const srchInp=$('globalSearchInput');
  if(srchModal&&srchModal.classList.contains('open')&&srchInp&&!srchInp.value.trim()){
    showActiveUsersInSearch();
  }
}

// ── PROFİL PANELİ GÜNCELLE ───────────────────────────────────────
function svUpdateProfilePanel(){
  if(!ME) return;
  const db=getDB(),me=db.users[ME.user_id.toLowerCase()];
  // Avatar
  const av=me.avatar;
  const profAv=$('svProfAv');
  if(profAv){
    profAv.innerHTML = av&&av.startsWith('data:')
      ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : ME.user_id.charAt(0).toUpperCase();
  }
  // İsim + token
  const pn=$('svProfName'); if(pn) pn.textContent=ME.user_id;
  const pt=$('svProfToken'); if(pt) pt.textContent=`Totem: ${ME.token}`;
  // İsim input
  const ni=$('svNameInput'); if(ni) ni.value=ME.user_id;
  // Status butonlarını güncelle
  svUpdateStatusBtns(myStatus||'available');
  // Custom status yükle
  try{
    const saved=JSON.parse(localStorage.getItem('sv_custom_status')||'{}');
    if(saved.emoji||saved.text){ myCustomStatus=saved; _csSelectedEmoji=saved.emoji||''; }
  }catch(e){}
  const csBtn=$('csEmojiToggleBtn'); if(csBtn) csBtn.textContent=myCustomStatus.emoji||'😊';
  const csInp=$('csStatusText'); if(csInp) csInp.value=myCustomStatus.text||'';
  _renderCurrentCustomStatus();
}

// Durum butonlarını aktif/pasif yap
window.svUpdateStatusBtns = function(status){
  ['available','busy','dnd','away'].forEach(s=>{
    const btn=$('svSt-'+s);
    if(btn) btn.classList.toggle('active', s===status);
  });
};

// İsim değiştir (sadece local — sunucu yok, ama presence günceller)
window.svChangeName = function(){
  const inp=$('svNameInput');
  if(!inp||!ME) return;
  const raw=inp.value.trim();
  if(!raw||raw.length<3||raw.length>16){
    showToast('Hata','İsim 3-16 karakter olmalı');return;
  }
  // İsim değiştirme bu sistemde mümkün değil (user_id = kimlik)
  showToast('Bilgi','Kullanıcı adı değiştirilemez — bu senin kalıcı kimliğin.','⚠️');
  inp.value=ME.user_id;
};

function updateBlockedList(){
  const bl=blocked;
  if(!bl.length){$('blockedList').innerHTML='<div style="padding:12px 20px;font-size:13px;color:var(--muted)">Engellenmiş kullanıcı yok.</div>';return;}
  $('blockedList').innerHTML=bl.map(u=>`
    <div class="sp-bl-item">
      <span>🚫 ${u}</span>
      <button data-act="unblock" data-a="${escHtml(u)}" style="background:none;border:none;color:var(--ok);font-size:12px;font-weight:600;cursor:pointer;padding:0">Engeli Kaldır</button>
    </div>`).join('');
}

window.unblock=name=>{
  const db=getDB(),k=ME.user_id.toLowerCase();
  if(!db.users[k].blocked)db.users[k].blocked=[];
  db.users[k].blocked=db.users[k].blocked.filter(u=>u!==name);
  blocked=blocked.filter(u=>u!==name);
  ME.blocked=blocked;
  saveDB(db);updateUI();showToast('Engel Kaldırıldı',`${name} artık engelli değil.`);
};

// ── CTX MENU ─────────────────────────────────────────────────────
window.showCtx=(e,name)=>{
  e.preventDefault();e.stopPropagation();closeCtx();
  const m=$('ctxMenu');
  m.innerHTML=`
    <div class="cxi" data-act="_uiSelChatClose" data-a="${escHtml(name)}" data-a2="private">💬 Mesaj Gönder</div>
    <div class="cxi d" data-act="rmFriend" data-a="${escHtml(name)}">🗑️ Arkadaşlıktan Çıkar</div>
    <div class="cxi d" data-act="blkUser" data-a="${escHtml(name)}">🚫 Engelle</div>`;
  let x=e.clientX,y=e.clientY;
  if(x+185>window.innerWidth)x=window.innerWidth-195;
  if(y+135>window.innerHeight)y=window.innerHeight-145;
  m.style.left=x+'px';m.style.top=y+'px';m.classList.remove('hidden');
  setTimeout(()=>document.addEventListener('click',closeCtx,{once:true}),10);
};
const closeCtx=()=>$('ctxMenu').classList.add('hidden');

window.rmFriend=name=>{
  closeCtx();
  if(!confirm(`${name} kişisini çıkarmak istiyor musun?`))return;
  const db=getDB(),k=ME.user_id.toLowerCase();
  db.users[k].friends=db.users[k].friends.filter(f=>f!==name);saveDB(db);
  broadcast({type:'friend_remove',to:name,from:ME.user_id});
  if(chatId===name){chatId=null;chatType=null;$('emptyState').classList.remove('hidden');}
  updateUI();showToast('Çıkarıldı',`${name} listeden çıkarıldı.`);
};
window.blkUser=name=>{
  closeCtx();
  if(!confirm(`${name} kişisini engellemek istiyor musun?`))return;
  const db=getDB(),k=ME.user_id.toLowerCase();
  db.users[k].friends=db.users[k].friends.filter(f=>f!==name);
  if(!db.users[k].blocked)db.users[k].blocked=[];
  if(!db.users[k].blocked.includes(name))db.users[k].blocked.push(name);
  saveDB(db);if(!blocked.includes(name))blocked.push(name);ME.blocked=blocked;
  broadcast({type:'friend_remove',to:name,from:ME.user_id});
  if(chatId===name){chatId=null;chatType=null;$('emptyState').classList.remove('hidden');}
  updateUI();showToast('Engellendi',`${name} engellendi.`);
};

// ── ARKADAŞ EKLEME ────────────────────────────────────────────────
$('addBtn').onclick=()=>{
  const t=$('addInput').value.trim().toLowerCase();
  if(!t||t===ME.user_id.toLowerCase()){setAS('Geçersiz.','d');return;}
  // Kendi pending listesine ekle (karşı taraf kabul edince friends'e taşınacak)
  const db=getDB(),k=ME.user_id.toLowerCase();
  if(!db.users[k].pending)db.users[k].pending=[];
  if(!db.users[k].pending.includes(t))db.users[k].pending.push(t);
  saveDB(db);
  broadcast({type:'friend_req',to:'global',target:t,from:ME.user_id,token:ME.token});
  setAS('İstek gönderildi.','ok');$('addInput').value='';
  setTimeout(()=>setAS('',''),3000);
};
$('addInput').addEventListener('keypress',e=>{if(e.key==='Enter')$('addBtn').click();});
const setAS=(m,t)=>{const el=$('addStatus');el.innerText=m;el.style.color=t==='d'?'var(--danger)':'var(--ok)';};

// 🛡️ [CSP-FIX] Kabul/Reddet butonları da dinamik (her istek için farklı
// kullanıcı adı) — inline onclick yerine data-attribute + delegation.
$('lstR').addEventListener('click',(e)=>{
  const accBtn=e.target.closest('.req-acc-btn');
  if(accBtn){ accReq(accBtn.getAttribute('data-req-user')); return; }
  const rejBtn=e.target.closest('.req-rej-btn');
  if(rejBtn){ rejReq(rejBtn.getAttribute('data-req-user')); return; }
});

window.accReq=s=>{
  const db=getDB(),k=ME.user_id.toLowerCase();
  // Kabul eden: isteği atanı ekle
  if(!db.users[k].friends.includes(s))db.users[k].friends.push(s);
  db.users[k].requests=db.users[k].requests.filter(r=>r!==s);
  saveDB(db);
  // Karşı tarafa bildir — friend_accept aldığında o da bizi ekleyecek
  broadcast({type:'friend_accept',to:s,from:ME.user_id});
  updateUI();
};
window.rejReq=s=>{
  const db=getDB(),k=ME.user_id.toLowerCase();
  db.users[k].requests=db.users[k].requests.filter(r=>r!==s);saveDB(db);updateUI();
};

// ── TABS (legacy — artık panel sistemi kullanılıyor ama eski kodlar hâlâ çağırıyor) ─
if($('tabF')) $('tabF').onclick=()=>showTab('F');
if($('tabG')) $('tabG').onclick=()=>showTab('G');
if($('tabR')) $('tabR').onclick=()=>showTab('R');
window.showTab=function(n){
  // Yeni panel sisteminde showTab çağrısını karşılık gelen panele yönlendir
  const map={F:'chats',G:'chats',R:'requests'};
  if(map[n] && typeof dnrSwitch==='function') dnrSwitch(map[n]);
  // Legacy tab highlight (varsa)
  ['F','G','R'].forEach(t=>{
    const tab=$(`tab${t}`);
    const lst=$(`lst${t}`);
    if(tab) tab.classList.remove('on');
    if(lst){ lst.classList.add('hidden'); lst.style.animation=''; }
  });
  const activeTab=$(`tab${n}`);
  const activeLst=$(`lst${n}`);
  if(activeTab) activeTab.classList.add('on');
  if(activeLst){
    activeLst.classList.remove('hidden');
    activeLst.style.animation='tabSlideIn .2s cubic-bezier(.34,1.1,.64,1) both';
  }
};

// Bottom nav switcher
window.bnavSwitch=function(tab){
  document.querySelectorAll('.bnav-item').forEach(b=>b.classList.remove('active'));
  const mapping={chats:'bnavChats',requests:'bnavRequests',profile:'bnavProfile'};
  if(mapping[tab]){ const el=$(mapping[tab]); if(el) el.classList.add('active'); }
  // Sidebar panelini aç
  if(tab==='chats')     dnrSwitch('chats');
  else if(tab==='requests') dnrSwitch('requests');
  else if(tab==='profile')  dnrSwitch('profile');
  // Chat aktifken sidebar açılınca chat-active'i kaldır (sohbet listesine dönüyoruz)
  if(tab==='chats'||tab==='requests'){
    document.body.classList.remove('chat-active');
  }
};

// Mobilde profil panelini aç — sidebar drawer içinde
window.mobileOpenProfile=function(){
  if(!ME) return;
  // Bottom nav'ı güncelle
  document.querySelectorAll('.bnav-item').forEach(b=>b.classList.remove('active'));
  const pb=$('bnavProfile'); if(pb) pb.classList.add('active');
  // Sidebar drawer'ı aç + profil panelini göster
  openMobileSidebar();
  dnrSwitch('profile');
  // Profil ikonunu kullanıcı avatarıyla güncelle
  _updateBnavProfileIcon();
};

// Bottom nav profil ikonunu avatarla güncelle
function _updateBnavProfileIcon(){
  if(!ME) return;
  const db=getDB(), me=db.users[ME.user_id.toLowerCase()];
  const iconEl=$('bnavProfileIcon');
  if(!iconEl) return;
  if(me&&me.avatar&&me.avatar.startsWith('data:')){
    // 🛡️ [HIGH-06] Bottom nav profil ikonu — setAvatarEl ile güvenli render
    setAvatarEl(iconEl, me.avatar, ME.user_id.charAt(0).toUpperCase());
    iconEl.style.fontSize='0';
  } else {
    iconEl.textContent='👤';
    iconEl.style.fontSize='';
  }
}

// ── SOHBET ────────────────────────────────────────────────────────
window.selChat=(id,type)=>{
  chatId=id;chatType=type;$('emptyState').classList.add('hidden');$('inpWrap').classList.remove('hidden');closeCtx();

  // Aktif arama varsa buton "Aramaya Dön" olsun
  const callUIHidden=$('callUI').classList.contains('hidden');
  const callOngoing=!callUIHidden||callIv!==null||Object.keys(groupCallPeers||{}).length>0||pc;

  if(type==='private'){
    $('chatName').innerText=id;$('chatSub').dataset.t='0';
    const _st=isOn(id)?(peerStatuses[id]||'available'):'offline';
    const _stColor={available:'var(--ok)',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b',offline:'#6b7280'};
    const _stLabel={available:'Çevrimiçi',busy:'Meşgul',dnd:'Rahatsız Etme',away:'Uzakta'};
    $('chatDot').className='sdot status-dot';
    $('chatDot').style.background=_stColor[_st];
    let _subHTML=isOn(id)?`<span style="color:${_stColor[_st]}">${_stLabel[_st]||'Çevrimiçi'}</span>`:'Özel Mesaj';
    // Özel durum varsa ekle
    if(isOn(id)&&window.peerCustomStatuses?.[id]?.text){
      const _cs=peerCustomStatuses[id];
      // 🛡️ [MED-02] chatSub emoji de escape ediliyor
      const _safeEmojiSub=escHtml(_cs.emoji||'');
      _subHTML+=`<span style="display:block;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${_safeEmojiSub?_safeEmojiSub+' ':''}${escHtml(_cs.text)}</span>`;
    }
    $('chatSub').innerHTML=_subHTML;
    const rawAv=avatars[id];
    // 🛡️ [HIGH-06] setAvatarEl ile güvenli render
    setAvatarEl($('chatAv'), rawAv, id.charAt(0).toUpperCase());
    $('chatAv').style.background='var(--primary)';
    $('callBtn').classList.remove('hidden');
    if(callOngoing&&(activeChatId===id||activeChatId===chatId)){
      $('callBtn').textContent='🔙 Aramaya Dön';
      $('callBtn').style.background='#22c55e';
    } else if(callOngoing){
      $('callBtn').textContent='📞 Sesli Ara';
      $('callBtn').style.background='';
    } else {
      $('callBtn').textContent='📞 Sesli Ara';
      $('callBtn').style.background='';
    }
    $('groupDetailBtn').classList.add('hidden');
    $('videoCallBtn').style.display='inline-flex';
    // 🛡️ [YENİ-H2] ECDH parmak izi göster (varsayılan kapalı/kısa rozet)
    _fpExpanded = false;
    _renderChatFpEl(id);
  }else{
    const g=getDB().groups[id];
    $('chatName').innerText=g.name;$('chatSub').innerText=`${g.members.length} Üye`;
    if(g.avatar){ setAvatarEl($('chatAv'), g.avatar, 'G'); }
    else{ $('chatAv').innerText='G'; }
    $('chatAv').style.background='var(--ok)';
    $('chatDot').className='sdot';
    $('callBtn').classList.remove('hidden');
    const grpCallActive=activeGroupCalls[id];
    if(callOngoing&&activeChatId===id){
      $('callBtn').textContent='🔙 Aramaya Dön';
      $('callBtn').style.background='#22c55e';
    } else if(callOngoing){
      $('callBtn').textContent='📞 Sesli Ara';
      $('callBtn').style.background='';
    } else if(grpCallActive){
      $('callBtn').textContent=`📞 Aramaya Katıl (${grpCallActive.members.length} kişi)`;
      $('callBtn').style.background='#22c55e';
    } else {
      $('callBtn').textContent='📞 Sesli Ara';
      $('callBtn').style.background='';
    }
    $('groupDetailBtn').classList.remove('hidden');
    $('videoCallBtn').style.display='none';
    const _fpEl2 = $('chatKeyFp'); if(_fpEl2) _fpEl2.style.display='none';
  }
  // Aktif grup araması varsa banner'ı güncelle
  if(type==='group') updateChatCallBanner(id);
  else updateChatCallBanner(null);
  if(window.innerWidth<=768){
    document.body.classList.add('chat-active');
  }
  updateFriends();renderChat();
};

function renderChat(){
  if(!chatId)return;
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msgs=db.messages[k]||[];
  const c=$('chatMsgs');
  c.innerHTML=msgs.map((m,idx)=>{
    if(m.sys){
      if(m.missedCall){
        const canCall=chatType==='private';
        return`<div style="display:flex;justify-content:center;margin:6px 0">
          <div class="missed-call-card">
            <span class="mcc-icon">📵</span>
            <div class="mcc-body">
              <div class="mcc-title">Cevapsız Arama</div>
              <div class="mcc-sub">${escHtml(m.from||'')} · ${m.time||''}</div>
            </div>
            ${canCall?`<button class="mcc-btn" data-act="_uiCallBack" data-a="${escHtml(m.from||'')}">Geri Ara</button>`:''}
          </div>
        </div>`;
      }
      // 🛡️ [HIGH-05] Sistem mesaj metni escape ediliyor — Stored XSS önlendi
      return`<div class="msg sys">${escHtml(m.text||'')}</div>`;
    }
    if(m.deleted)return`<div class="msg ${m.from===ME.user_id?'me':'ot'}" style="opacity:.5;font-style:italic">🗑️ Bu mesaj silindi</div>`;
    const me=m.from===ME.user_id;

    // Düzenlendi etiketi — contentHTML'den önce tanımlanmalı
    const editedHTML=m.edited?`<span class="edited-lbl"> (düzenlendi)</span>`:'';

    // İçerik türüne göre render
    // fileData cache'den çöz
    let fileData=m.fileData||'';
    if(fileData.startsWith('__session__')){
      fileData=_sessionFiles.get(fileData.slice(11))||'';
    } else if(fileData.startsWith('__cache__')){
      try{fileData=localStorage.getItem(fileData.slice(9))||'';}catch(e){fileData='';}
    }

    let contentHTML='';
    if(m.fileType==='voice'){
      const dur=m.voiceDur||0;
      const mins=Math.floor(dur/60), secs=dur%60;
      const durStr=`${mins}:${secs.toString().padStart(2,'0')}`;
      const sid=`vm_${m.id}`;
      const bars=Array.from({length:30},(_,i)=>{
        const seed=(m.id.charCodeAt(i%m.id.length)+i*7)%100;
        return 12+seed*0.65;
      });
      const barsSVG=bars.map((h,i)=>`<rect x="${i*6+1}" y="${(40-h)/2}" width="4" height="${h}" rx="2" fill="currentColor" opacity="${0.35+i/55}"/>`).join('');
      // fileData'yı şimdi çöz ve _vmAudios'a önceden kaydet (onclick'te büyük string geçme)
      if(fileData&&!_vmAudios[m.id]){
        const audio=new Audio(fileData);
        _vmAudios[m.id]=audio;
      }
      contentHTML=`<div class="voice-msg" id="${sid}">
        <button class="vm-play" data-act="playVoiceMsg" data-a="${m.id}" data-self="2" data-playing="0">▶</button>
        <div class="vm-wave" data-act="_uiPlayVoiceFromWave" data-a="${m.id}" data-a2="${sid}">
          <svg viewBox="0 0 181 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;color:${me?'rgba(255,255,255,.8)':'var(--primary)'}">${barsSVG}</svg>
        </div>
        <span class="vm-time" id="${sid}_t">${durStr}</span>
      </div>`;
    } else if(m.fileType==='image'){
      if(fileData) contentHTML=`<img class="msg-img" src="${fileData}" alt="${escHtml(m.fileName||'resim')}" data-act="openImageViewer" data-a="${escHtml(fileData)}" data-a2="${escHtml(m.fileName||'')}">`;
      else contentHTML=`<div class="file-msg"><span class="file-icon">🖼️</span><div class="file-info"><span class="file-name">${escHtml(m.fileName||'Resim')}</span><span class="file-size" style="color:var(--danger)">Yüklenemedi</span></div></div>`;
    } else if(m.fileType==='gif'){
      if(fileData) contentHTML=`<img class="msg-gif" src="${fileData}" alt="GIF">`;
      else contentHTML=`<span class="msg-text">🎬 GIF</span>`;
    } else if(m.fileType==='file'){
      const ext=(m.fileName||'').split('.').pop().toLowerCase();
      const icon={'pdf':'📄','doc':'📝','docx':'📝','txt':'📄','zip':'🗜️','mp3':'🎵','mp4':'🎬','mov':'🎬'}[ext]||'📎';
      const sizeStr=m.fileSize?`${(m.fileSize/1024).toFixed(0)} KB`:'';
      contentHTML=`<div class="file-msg">
        <span class="file-icon">${icon}</span>
        <div class="file-info">
          <span class="file-name">${escHtml(m.fileName||'Dosya')}</span>
          <span class="file-size">${sizeStr}</span>
          ${fileData?`<a class="file-dl" href="${fileData}" download="${escHtml(m.fileName||'dosya')}">⬇ İndir</a>`:'<span style="color:var(--danger);font-size:11px">Yüklenemedi</span>'}
        </div>
      </div>`;
    } else if(m.type==='poll'){
      contentHTML = renderPollHTML(m, me);
    } else {
      // Normal metin + link önizleme
      let txt = escHtml(m.text||'');
      // URL'leri tıklanabilir yap
      txt = txt.replace(/(https?:\/\/[^\s<>"]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;opacity:.85" data-act="_uiNoop" data-stop="1">$1</a>');
      contentHTML=`<span class="msg-text">${txt}${editedHTML}</span>`;
      // Link önizleme kartı
      if(m.linkPreview){
        const lp = m.linkPreview;
        // 🛡️ [YENİ-H3] sanitizeLinkUrl: sadece http/https geçer
        const safeUrl = sanitizeLinkUrl(lp.url||'');
        if(safeUrl && (lp.type === 'youtube' || lp.ytId)){
          const thumb = escHtml(lp.thumb || `https://img.youtube.com/vi/${escHtml(lp.ytId||'')}/hqdefault.jpg`);
          contentHTML += `<div class="link-preview yt" data-lp-url="${safeUrl}">
            <div class="link-preview-yt-wrap">
              <img class="link-preview-thumb" src="${thumb}" alt="${escHtml(lp.title||'')}" loading="lazy" data-onerror="ytfallback" data-ytid="${escHtml(lp.ytId||'')}">
              <div class="link-preview-yt-play"><div class="link-preview-yt-play-btn"></div></div>
            </div>
            <div class="link-preview-body">
              <div class="link-preview-domain">
                <img class="link-preview-favicon" src="https://www.youtube.com/favicon.ico" data-onerror="hide">
                YouTube${lp.author?` · ${escHtml(lp.author)}`:''}
              </div>
              <div class="link-preview-title">${escHtml(lp.title||'YouTube Video')}</div>
            </div>
          </div>`;
        } else if(safeUrl && lp.title){
          contentHTML += `<div class="link-preview" data-lp-url="${safeUrl}">
            ${lp.image?`<img class="link-preview-thumb" src="${escHtml(lp.image)}" alt="" loading="lazy" data-onerror="hide">`:''}
            <div class="link-preview-body">
              <div class="link-preview-domain">
                ${lp.favicon?`<img class="link-preview-favicon" src="${escHtml(lp.favicon)}" data-onerror="hide">`:''}
                ${escHtml(lp.domain||'')}
              </div>
              <div class="link-preview-title">${escHtml(lp.title)}</div>
              ${lp.desc?`<div class="link-preview-desc">${escHtml(lp.desc)}</div>`:''}
            </div>
          </div>`;
        }
      }
    }
    // Kaybolucak mesaj — geri sayım rozeti
    const vanishBadge = m.expiresAt
      ? `<span class="vanish-badge">⏱️ <span class="msg-timer" data-exp="${m.expiresAt}">...</span></span>`
      : '';

    // Reply önizleme
    let replyHTML='';
    if(m.replyTo){
      const rt=m.replyTo;
      replyHTML=`<span class="reply-preview ${me?'':'ot-reply'}">↩ ${escHtml(rt.from||'')}: ${escHtml((rt.text||'').substring(0,60))}${(rt.text||'').length>60?'…':''}</span>`;
    }

    // Reaksiyonlar
    let reactHTML='';
    if(m.reactions&&Object.keys(m.reactions).length){
      const grouped={};
      Object.entries(m.reactions).forEach(([user,emoji])=>{
        if(!grouped[emoji])grouped[emoji]=[];
        grouped[emoji].push(user);
      });
      reactHTML=`<div class="reactions">${Object.entries(grouped).map(([emoji,users])=>
        `<div class="reaction-chip ${users.includes(ME.user_id)?'mine':''}" data-act="toggleReaction" data-a="${m.id}" data-a2="${escHtml(emoji)}">${emoji}<span>${users.length}</span></div>`
      ).join('')}</div>`;
    }

    // Okundu bilgisi — sadece kendi mesajlarında göster
    let ticksHTML='';
    if(me){
      if(chatType==='private'){
        const isRead=!!(m.readBy&&m.readBy.includes(chatId));
        ticksHTML=`<span class="ticks ${isRead?'read':''}">${isRead?'✓✓':'✓'}</span>`;
      } else if(chatType==='group'){
        const readers=(m.readBy||[]).filter(u=>u!==ME.user_id);
        if(readers.length>0) ticksHTML=`<span class="ticks read" title="${readers.join(', ')} okudu">✓✓ ${readers.length}</span>`;
        else ticksHTML=`<span class="ticks">✓</span>`;
      }
    }

    // Action butonları
    const actionsHTML=`<div class="msg-actions">
      <button class="ma-btn" data-act="startReply" data-a="${m.id}" title="Yanıtla">↩</button>
      <button class="ma-btn" data-act="openReactPicker" data-a="${m.id}" data-self="2" title="Reaksiyon">😊</button>
      ${me?`<button class="ma-btn" data-act="editMsg" data-a="${m.id}" title="Düzenle">✏️</button>
      <button class="ma-btn" data-act="deleteMsg" data-a="${m.id}" title="Sil" style="color:var(--danger)">🗑️</button>`:''}
    </div>`;

    return`<div class="msg-wrap ${me?'me-wrap':''}" data-id="${m.id}" data-ctx-act="showMsgCtx" data-ctx-a="${escHtml(m.id)}" data-ctx-a2="${escHtml(m.from||'')}">
      ${actionsHTML}
      <div class="msg ${me?'me':'ot'}">
        ${chatType==='group'&&!me?`<div class="ms">${escHtml(m.from||'')}</div>`:''}
        ${replyHTML}
        ${contentHTML}
        ${reactHTML}
        <span class="mi">${m.time||''}${vanishBadge}${ticksHTML}</span>
      </div>
    </div>`;
  }).join('');
  c.scrollTop=c.scrollHeight;
  // Sadece son mesaja animasyon
  const last=c.lastElementChild;
  if(last&&last.classList.contains('msg-wrap')){
    last.classList.add('new-msg');
    setTimeout(()=>last.classList.remove('new-msg'),300);
  }
}

function escHtml(t){
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 🛡️ [HIGH-06] Avatar URL dogrulaması — javascript:, data:text, vbscript: reddedilir
function sanitizeAvatarUrl(url){
  if(!url||typeof url!=='string') return null;
  if(url.startsWith('data:image/')&&url.length<2_000_000) return url;
  if(/^https:\/\//.test(url)) return url;
  return null;
}

// 🛡️ [HIGH-06] Avatar elementini guvenli sek. set et — innerHTML KULLANILMAZ
function setAvatarEl(el, url, fallbackChar){
  if(!el) return;
  const safe=sanitizeAvatarUrl(url);
  if(safe){
    const img=document.createElement('img');
    img.src=safe;
    img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit;';
    img.alt='';
    el.textContent='';
    el.appendChild(img);
  } else {
    el.textContent=fallbackChar||'?';
  }
}

$('sendBtn').onclick=()=>{
  const text=$('msgInput').value.trim();
  if(!text||!chatId)return;

  if(chatType==='private'){
    const db=getDB();
    const myFriends=db.users[ME.user_id.toLowerCase()]?.friends||[];
    if(!myFriends.includes(chatId)){showToast('Mesaj Gönderilemedi',`${chatId} artık arkadaşın değil.`);$('msgInput').value='';return;}
    if(blocked.includes(chatId)){showToast('Mesaj Gönderilemedi',`${chatId} engellenmiş.`);$('msgInput').value='';return;}
  }

  const msg={id:uid(),from:ME.user_id,text,time:gt()};
  if(window._replyTo){msg.replyTo=window._replyTo;cancelReply();}

  const db=getDB();
  if(chatType==='private'){
    const k=[ME.user_id,chatId].sort().join('_');
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push(msg);saveDB(db);
    broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg});
  }else{
    const k='g_'+chatId;
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push(msg);saveDB(db);
    const g=db.groups[chatId];
    g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg});});
  }
  $('msgInput').value='';$('msgInput').focus();
  // İlk gönderimde bildirim izni iste
  if(window._askNotifOnce) _ensureNotifPerm();
  renderChat();
  msgParticles();
};
$('msgInput').addEventListener('keypress',e=>{if(e.key==='Enter')$('sendBtn').click();});

let tTmr;
$('msgInput').addEventListener('input',()=>{
  if(chatId&&chatType==='private'){
    broadcast({type:'typing',to:chatId,from:ME.user_id,on:true});
    clearTimeout(tTmr);
    tTmr=setTimeout(()=>broadcast({type:'typing',to:chatId,from:ME.user_id,on:false}),2000);
  }
});

// ── GRUP ─────────────────────────────────────────────────────────
window.openGroupModal=function(){
  if(!ME)return;
  const db=getDB(),fr=db.users[ME.user_id.toLowerCase()].friends;
  if(!fr.length){showToast('Hata','Önce arkadaş ekleyin.');return;}
  // Tüm arkadaşları göster — online/offline fark etmez, offline olanlar işaretli
  $('groupFriendCbs').innerHTML=fr.map(f=>{
    const online=isOn(f);
    const statusDot=online
      ?`<span style="width:8px;height:8px;border-radius:50%;background:#3ba55c;display:inline-block;flex-shrink:0"></span>`
      :`<span style="width:8px;height:8px;border-radius:50%;background:#6b7280;display:inline-block;flex-shrink:0"></span>`;
    const offlineNote=online?'':` <span style="font-size:10px;color:#6b7280">(Çevrimdışı)</span>`;
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text)">
      <input type="checkbox" value="${f}" class="gcb"> ${statusDot} ${f}${offlineNote}</label>`;
  }).join('');
  $('groupModal').classList.remove('hidden');
};
if($('newGroupBtn')) $('newGroupBtn').onclick=openGroupModal;
if($('cancelGroupBtn')) $('cancelGroupBtn').onclick=()=>$('groupModal').classList.add('hidden');
if($('confirmGroupBtn')) $('confirmGroupBtn').onclick=()=>{
  const name=$('groupNameInput').value.trim();
  if(!name){showToast('Hata','Grup adı boş olamaz.');return;}
  const members=[...document.querySelectorAll('.gcb:checked')].map(c=>c.value);
  if(!members.length){showToast('Hata','En az 1 arkadaş seç.');return;}
  members.push(ME.user_id);
  const gid='GRP_'+uid(),g={id:gid,name,members,admins:[ME.user_id]};
  const db=getDB();db.groups[gid]=g;saveDB(db);
  members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_invite',to:m,from:ME.user_id,group:g});});
  $('groupModal').classList.add('hidden');$('groupNameInput').value='';updateUI();dnrSwitch('chats');
};

// ── WEBRTC ────────────────────────────────────────────────────────
function cleanCall(){
  if(pc){try{pc.close()}catch(e){}pc=null;}
  if(ls){
    ls.getTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    ls=null;
  }
  // Mikrofonu tamamen kapat — arama dışında asla açık kalmasın
  if(_persistentRawStream){
    _persistentRawStream.getTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    _persistentRawStream=null;
    console.log('🎤 Mikrofon kapatıldı (arama bitti)');
  }
  // Kamerayı tamamen kapat — güven sorunu yaşanmasın
  if(_localVideoStream){
    _localVideoStream.getTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    _localVideoStream=null;
    console.log('📷 Kamera kapatıldı (arama bitti)');
  }
  // Tüm RTCPeerConnection sender'larındaki video track'leri de durdur
  try{
    if(pc) pc.getSenders().forEach(s=>{ if(s.track&&s.track.kind==='video'){ try{s.track.stop();}catch(e){} } });
  }catch(e){}
  // localVideo elementini DOM'dan kaldır — thumbnail arayüzden kaybolsun
  const lv=$('localVideo'); if(lv){ try{lv.srcObject=null;}catch(e){} lv.remove(); }
  // audioCtx artık yok — ses zinciri sadece native track
  if(window._remoteAudio){
    try{window._remoteAudio.pause();window._remoteAudio.srcObject=null;}catch(e){}
    window._remoteAudio=null;
  }
  // 3.1: Speaking detection temizle
  _stopSpeakLoop();
  iceQ=[];
}
function onTrack(e){
  const s=e.streams[0];
  if(!s)return;
  const remoteUser=activeChatId||chatId;
  if(s.getVideoTracks().length>0){
    // Video track geldi — karşı tarafın avatar kartını bul ve video ile değiştir
    const setRemoteVideo=(user_id)=>{
      const card=document.getElementById(`pcard_${user_id}`);
      const av=card?.querySelector('.part-av');
      if(!av) return;
      av.classList.add('has-video');
      let vid=av.querySelector('video.remote-feed');
      if(!vid){
        vid=document.createElement('video');
        vid.className='remote-feed';
        vid.autoplay=true;vid.playsInline=true;vid.muted=false;
        vid.ondblclick=toggleVideoFullscreen;
        av.innerHTML='';
        av.appendChild(vid);
      }
      vid.srcObject=s;
      // Track bitince (karşı taraf kamerayı kapattı) avatarı geri getir
      s.getVideoTracks().forEach(t=>{
        t.onended=()=>{ vid.srcObject=null; _restoreAvatar(av,user_id,false); };
      });
      const rv=$('remoteVideo');
      if(rv){rv.srcObject=s;}
    };
    if(remoteUser) setRemoteVideo(remoteUser);
    $('audioPh').classList.add('hidden');
  } else {
    // Önceki audio varsa önce durdur
    if(window._remoteAudio){try{window._remoteAudio.pause();window._remoteAudio.srcObject=null;}catch(e){}}
    const a=new Audio();
    a.volume=0; // sesi GainNode üstünden yönet
    a.srcObject=s;a.play().catch(()=>{});
    window._remoteAudio=a;
    // GainNode — ses kontrolü için (private call)
    try{
      const _gac=new(window.AudioContext||window.webkitAudioContext)();
      const _src=_gac.createMediaStreamSource(s);
      const _gn=_gac.createGain();
      const _vol=remoteUser&&peerVolumes[remoteUser]!==undefined?peerVolumes[remoteUser]:100;
      _gn.gain.value=isDeafened?0:(_vol/100);
      _src.connect(_gn);_gn.connect(_gac.destination);
      window._remoteGainNode=_gn;
      window._remoteGac=_gac;
    }catch(e){ a.volume=1; } // fallback
    // Private call için karşı tarafı participantsGrid'e ekle
    if(remoteUser){
      callParticipants.add(remoteUser);
      // groupCallPeers'e stub ekle — volume control için
      if(!groupCallPeers[remoteUser]){
        groupCallPeers[remoteUser]={
          pc:pc,stream:s,_audio:a,
          _gainNode:window._remoteGainNode,
          _gac:window._remoteGac,
          _isPrivate:true
        };
      }
      updateParticipantsGrid();
      // Speaking detection
      setTimeout(()=>_startSpeakDetect(remoteUser, a, false), 500);
    }
  }
}

// ── 5. DİNAMİK BİTRATE KONTROLÜ ─────────────────────────────────
// RTCPeerConnection.getStats() ile RTT ve paket kaybını ölçer.
// Ağ kötüleşince video kalitesini otomatik düşürür, iyileşince geri alır.

const BITRATE_PROFILES = {
  high:   { video: 2_500_000, audio: 64_000, label: '720p+' },
  medium: { video:   600_000, audio: 48_000, label: '360p'  },
  low:    { video:   150_000, audio: 24_000, label: '180p'  },
};
let _brProfile = 'high';
let _brStats   = { prevBytes: 0, prevTs: 0, lostPrev: 0, sentPrev: 0 };

async function _applyBitrate(conn, profile){
  if(!conn) return;
  const p = BITRATE_PROFILES[profile];
  for(const sender of conn.getSenders()){
    if(!sender.track) continue;
    try{
      const params = sender.getParameters();
      if(!params.encodings || !params.encodings.length) params.encodings=[{}];
      if(sender.track.kind === 'video'){
        params.encodings[0].maxBitrate = p.video;
        params.encodings[0].degradationPreference = 'maintain-framerate';
      } else if(sender.track.kind === 'audio'){
        params.encodings[0].maxBitrate = p.audio;
      }
      await sender.setParameters(params);
    }catch(e){}
  }
}

async function _checkBitrate(){
  // Tüm aktif peer bağlantılarını tara
  const conns = [pc, ...Object.values(groupCallPeers||{}).map(g=>g.pc)].filter(Boolean);
  if(!conns.length){ _brStats={prevBytes:0,prevTs:0,lostPrev:0,sentPrev:0}; return; }

  const conn = conns[0]; // ana bağlantıyı esas al
  let rtt=0, lossRate=0;

  try{
    const stats = await conn.getStats();
    stats.forEach(r=>{
      // Round-trip time (ms)
      if(r.type==='candidate-pair' && r.state==='succeeded' && r.currentRoundTripTime){
        rtt = Math.max(rtt, r.currentRoundTripTime * 1000);
      }
      // Paket kaybı
      if(r.type==='outbound-rtp' && r.kind==='video'){
        const sent  = (r.packetsSent||0) - _brStats.sentPrev;
        const lost  = (r.packetsLost||0) - _brStats.lostPrev;
        if(sent > 0) lossRate = Math.max(0, lost / (sent + lost));
        _brStats.sentPrev = r.packetsSent||0;
        _brStats.lostPrev = r.packetsLost||0;
      }
    });
  }catch(e){ return; }

  // Profil kararı
  let newProfile = 'high';
  if(rtt > 400 || lossRate > 0.12)      newProfile = 'low';
  else if(rtt > 180 || lossRate > 0.05) newProfile = 'medium';

  if(newProfile !== _brProfile){
    _brProfile = newProfile;
    const label = BITRATE_PROFILES[newProfile].label;
    console.log(`[BITRATE] Profil değişti → ${newProfile} (${label}) | RTT:${rtt.toFixed(0)}ms Kayıp:${(lossRate*100).toFixed(1)}%`);
    showToast('📶 Ağ Kalitesi', `Video kalitesi ayarlandı: ${label} (RTT ${rtt.toFixed(0)}ms)`);
    for(const c of conns) await _applyBitrate(c, newProfile);
  }
}

// Her 6 saniyede bir ölç
let _brInterval = null;
function startBitrateMonitor(){ _brInterval = setInterval(_checkBitrate, 6000); }
function stopBitrateMonitor(){  clearInterval(_brInterval); _brInterval=null; _brProfile='high'; }
$('screenBtn').onclick=async()=>{
  if(screenOwner&&screenOwner!==ME.user_id){showToast('Ekran Paylaşımı',`${screenOwner} zaten paylaşıyor.`);return;}

  // Durdur
  if($('screenBtn').innerText.includes('Durdur')){
    screenOwner=null;
    $('screenBtn').innerText='Ekran Paylaş';
    // Tüm bağlantılarda video track'i kapat
    const allConns2=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);
    for(const conn of allConns2){
      try{
        const vSnd=conn.getSenders().find(s=>s.track&&s.track.kind==='video');
        if(vSnd) await vSnd.replaceTrack(null);
        // Sistem ses sender'ı varsa kapat
        const aSnd=conn.getSenders().find(s=>s.track&&s.track.kind==='audio'&&s.track.label&&s.track.label.includes('System'));
        if(aSnd) try{conn.removeTrack(aSnd);}catch(e){}
      }catch(e){}
    }
    if(chatType==='group'){
      const g=getDB().groups[activeChatId||chatId];
      g&&g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'screen_ended',to:m,from:ME.user_id});});
    } else {
      broadcast({type:'screen_ended',to:activeChatId||chatId,from:ME.user_id});
    }
    $('remoteVideo').classList.add('hidden');
    $('audioPh').classList.remove('hidden');
    return;
  }

  try{
    const sc=await navigator.mediaDevices.getDisplayMedia({
      video:{
        frameRate:{ideal:30,max:60},
        width:{ideal:1280,max:1920},
        height:{ideal:720,max:1080},
        cursor:'always',
        resizeMode:'crop-and-scale',
        displaySurface:'monitor'
      },
      audio:{
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false,
        sampleRate:48000,
        channelCount:2
      },
      preferCurrentTab:false,
      selfBrowserSurface:'exclude',
      systemAudio:'include'
    });
    const vt=sc.getVideoTracks()[0];
    const at=sc.getAudioTracks()[0]; // Sistem sesi (opsiyonel)
    if(!vt){sc.getTracks().forEach(t=>t.stop());return;}

    screenOwner=ME.user_id;
    $('screenBtn').innerText='⏹ Paylaşımı Durdur';

    const allConns=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);

    for(const conn of allConns){
      try{
        // Video track
        const vSender=conn.getSenders().find(s=>s.track&&s.track.kind==='video');
        if(vSender){
          await vSender.replaceTrack(vt);
          // Content hint: metin/sunum için 'text', video için 'motion'
          try{ vt.contentHint='motion'; }catch(e){}
          try{
            const p=vSender.getParameters();
            if(!p.encodings||!p.encodings.length)p.encodings=[{}];
            p.encodings[0].maxBitrate=4000000;        // 4Mbps
            p.encodings[0].maxFramerate=30;
            p.encodings[0].priority='high';
            p.encodings[0].networkPriority='high';
            p.encodings[0].degradationPreference='maintain-framerate';
            p.encodings[0].scaleResolutionDownBy=1.0; // Tam çözünürlük
            await vSender.setParameters(p);
          }catch(pe){}
        } else {
          conn.addTrack(vt,sc);
          // Sistem sesini de ekle
          if(at) conn.addTrack(at,sc);
          const offer=await conn.createOffer({offerToReceiveVideo:true});
          await conn.setLocalDescription(offer);
          await waitForIceGathering(conn);
          let target=null;
          if(conn===pc) target=activeChatId||chatId;
          else for(const[u,peer] of Object.entries(groupCallPeers)){if(peer.pc===conn){target=u;break;}}
          if(target) broadcastRTC({type:'screen_offer',to:target,from:ME.user_id,sdp:conn.localDescription,hasAudio:!!at});
        }
      }catch(e){console.warn('Ekran track hatası:',e);}
    }

    // screen_started bildir
    if(chatType==='group'){
      const g=getDB().groups[activeChatId||chatId];
      g&&g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'screen_started',to:m,from:ME.user_id});});
    } else {
      broadcast({type:'screen_started',to:activeChatId||chatId,from:ME.user_id});
    }

    vt.onended=async()=>{
      // Paylaşan kişi tarayıcıdan durdurdu — tüm karşı taraflara bildir
      screenOwner=null;
      $('screenBtn').innerText='Ekran Paylaş';
      // Tüm video sender'ları temizle
      const conns=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);
      for(const conn of conns){
        try{
          const vs=conn.getSenders().find(s=>s.track&&s.track.kind==='video');
          if(vs) await vs.replaceTrack(null);
        }catch(e){}
      }
      // Karşı taraflara screen_ended gönder
      if(chatType==='group'){
        const g=getDB().groups[activeChatId||chatId];
        g&&g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'screen_ended',to:m,from:ME.user_id});});
      } else {
        broadcast({type:'screen_ended',to:activeChatId||chatId,from:ME.user_id});
      }
    };
  }catch(e){
    if(e.name!=='NotAllowedError') showToast('Ekran Paylaşımı','Ekran paylaşımı başlatılamadı: '+e.message);
  }
};
$('endCallBtn').onclick=()=>{broadcast({type:'rtc_end',to:$('callName').innerText,from:ME.user_id});endCall('Çağrıyı sonlandırdınız.');};
// ══════════════════════════════════════════════════════════════════
//  🎙️ SPEAKING DETECTION & BİREYSEL SES KONTROLÜ — Beta 3.5
// ══════════════════════════════════════════════════════════════════

// Her peer için ses seviyesi (0-200, default 100 = %100)
const peerVolumes={};
// Her peer için analyser + interval
const _speakAnalysers={};
let _speakInterval=null;
// Kendi mikrofon analyser'ı
let _selfAnalyser=null;

// Belirli bir audio stream için konuşma algılama başlat
let _speakAudioCtx=null; // speaking detection için ayrı AudioContext
function _getSpeakCtx(){
  if(!_speakAudioCtx||_speakAudioCtx.state==='closed'){
    _speakAudioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:48000,latencyHint:'playback'});
  }
  if(_speakAudioCtx.state==='suspended') _speakAudioCtx.resume().catch(()=>{});
  return _speakAudioCtx;
}

function _startSpeakDetect(user_id, audioEl, isSelf){
  if(isSelf){
    // ls hazır olana kadar retry — startCallUI timeout'u ile race condition olabilir
    const _tryConnect=()=>{
      const stream=ls||_persistentRawStream;
      if(!stream){ setTimeout(_tryConnect, 300); return; }
      try{
        const ac=_getSpeakCtx();
        const analyser=ac.createAnalyser();
        analyser.fftSize=1024;
        analyser.smoothingTimeConstant=0.6;
        const src=ac.createMediaStreamSource(stream);
        src.connect(analyser);
        _selfAnalyser=analyser;
      }catch(e){ setTimeout(_tryConnect, 500); }
    };
    _tryConnect();
    return;
  }
  // Karşı taraf — peer'ın kendi _gac'ını kullan (robot ses önlemi: aynı stream'e iki ctx bağlama)
  try{
    const peer=groupCallPeers[user_id];
    const stream=audioEl?.srcObject || peer?.stream;
    if(!stream) return;
    // Private call için window._remoteGac, grup için peer._gac
    const ac=peer?._gac || window._remoteGac || _getSpeakCtx();
    const analyser=ac.createAnalyser();
    analyser.fftSize=1024;
    analyser.smoothingTimeConstant=0.6;
    const src=ac.createMediaStreamSource(stream);
    src.connect(analyser);
    _speakAnalysers[user_id]=analyser;
  }catch(e){}
}

// Her 80ms'de bir ses seviyelerini ölç
function _startSpeakLoop(){
  _stopSpeakLoop();
  const buf=new Uint8Array(512);
  _speakInterval=setInterval(()=>{
    // Kendi mic
    if(_selfAnalyser){
      if(!isMuted){
        _selfAnalyser.getByteFrequencyData(buf);
        // Konuşma bandı (300-3500Hz) ağırlıklı
        const lo=Math.floor(buf.length*0.06);
        const hi=Math.floor(buf.length*0.45);
        let sum=0;
        for(let i=lo;i<hi;i++) sum+=buf[i];
        _applySpeakUI(ME.user_id, sum/(hi-lo));
      } else {
        _applySpeakUI(ME.user_id, 0);
      }
    }
    // Diğer peer'lar
    for(const [u, an] of Object.entries(_speakAnalysers)){
      an.getByteFrequencyData(buf);
      const lo=Math.floor(buf.length*0.06);
      const hi=Math.floor(buf.length*0.45);
      let sum=0;
      for(let i=lo;i<hi;i++) sum+=buf[i];
      _applySpeakUI(u, sum/(hi-lo));
    }
  }, 80);
}

function _stopSpeakLoop(){
  if(_speakInterval){ clearInterval(_speakInterval); _speakInterval=null; }
  // Tüm analyser'ları temizle
  for(const k of Object.keys(_speakAnalysers)) delete _speakAnalysers[k];
  _selfAnalyser=null;
}

const _SPEAK_THRESHOLD=10; // Daha yüksek eşik = sadece gerçek konuşmada yanıyor
function _applySpeakUI(user_id, level){
  const card=$(`pcard_${user_id}`);
  if(!card) return;
  card.classList.toggle('speaking', level > _SPEAK_THRESHOLD);
  const fill=$(`pvf_${user_id}`);
  if(fill) fill.style.width=Math.min(100, Math.round(level*3))+'%';
}

// Mute/Deafen değişince kendi kartını DOM'da anlık güncelle
function _updateSelfBadges(){
  const card=$(`pcard_${ME?.user_id}`);
  if(!card) return;
  let mb=card.querySelector('.part-mute-badge');
  if(isMuted){ if(!mb){mb=document.createElement('span');mb.className='part-mute-badge';mb.textContent='🔇';card.appendChild(mb);} }
  else { if(mb) mb.remove(); }
  let db=card.querySelector('.deafen-badge');
  if(isDeafened){ if(!db){db=document.createElement('span');db.className='deafen-badge';db.textContent='🔕';card.appendChild(db);} }
  else { if(db) db.remove(); }
}

// ── BİREYSEL SES KONTROLÜ CONTEXT MENU ─────────────────────────
let _peerVolMenuUser=null;

window.openPeerVolMenu=function(e, user_id){
  e.preventDefault();
  _peerVolMenuUser=user_id;
  const vol=peerVolumes[user_id]!==undefined?peerVolumes[user_id]:100;
  const old=$('peerVolMenu'); if(old) old.remove();
  const menu=document.createElement('div');
  menu.id='peerVolMenu';
  const volIcon=vol===0?'🔇':vol<40?'🔈':vol<80?'🔉':'🔊';
  menu.innerHTML=`
    <div class="pvm-title">
      <span id="pvm-icon">${volIcon}</span>
      <span>${user_id}</span>
    </div>
    <div class="pvm-row">
      <button class="pvm-stepper" data-act="_uiPvmStepDown" data-a="${escHtml(user_id)}">−</button>
      <input type="range" class="pvm-slider" id="pvm-vol"
        min="0" max="150" step="5" value="${vol}"
        data-oninput="_pvmUpdate" data-oninput-a="${escHtml(user_id)}">
      <button class="pvm-stepper" data-act="_uiPvmStepUp" data-a="${escHtml(user_id)}">+</button>
    </div>
    <div style="text-align:center;margin-bottom:10px">
      <span class="pvm-val" id="pvm-vol-val">${vol}%</span>
    </div>
    <div class="pvm-btns">
      <button class="pvm-btn" data-act="_uiPvmFull" data-a="${escHtml(user_id)}">↺ %100</button>
      <button class="pvm-btn danger" data-act="_uiPvmMute" data-a="${escHtml(user_id)}">🔇 Sustur</button>
      <button class="pvm-btn" data-act="closePeerVolMenu">✕</button>
    </div>`;
  document.body.appendChild(menu);
  const mx=Math.min(e.clientX, window.innerWidth-240);
  const my=Math.min(e.clientY, window.innerHeight-170);
  menu.style.left=mx+'px'; menu.style.top=my+'px';
  _pvmUpdateSliderBg(vol);
  setTimeout(()=>document.addEventListener('click', closePeerVolMenu, {once:true}), 10);
};

function _pvmUpdateSliderBg(vol){
  const s=$('pvm-vol'); if(!s) return;
  const pct=(vol/150*100).toFixed(1);
  s.style.background=`linear-gradient(90deg,var(--primary) 0%,var(--primary) ${pct}%,#334155 ${pct}%,#334155 100%)`;
}

window._pvmUpdate=function(user_id, vol){
  setPeerVol(user_id, vol);
  const valEl=$('pvm-vol-val'); if(valEl) valEl.textContent=vol+'%';
  const icon=$('pvm-icon');
  if(icon) icon.textContent=vol===0?'🔇':vol<40?'🔈':vol<80?'🔉':'🔊';
  _pvmUpdateSliderBg(vol);
};

window.closePeerVolMenu=function(){
  const m=$('peerVolMenu'); if(m) m.remove();
};

// Ses 0-150% arası. HTML audio.volume sadece 0-1 destekler.
// 100% üstü için Web Audio GainNode kullanıyoruz.
// Her peer'a ait _gainNode broadcastGroupCallOffer / _joinGroupPeer'da oluşturulur.
window.setPeerVol=function(user_id, vol){
  peerVolumes[user_id]=vol;
  const peer=groupCallPeers[user_id];
  if(peer){
    const fraction=vol/100; // 0..1.5
    if(peer._gainNode){
      // GainNode tek ses yolu — audio.volume=0 kalsın (double routing fix)
      peer._gainNode.gain.value = isDeafened ? 0 : (vol===0 ? 0 : fraction);
      // _audio volume=0 kalacak — double routing önlemi
    } else if(peer._audio){
      // GainNode yoksa (fallback) audio kullan
      peer._audio.muted=(vol===0||isDeafened);
      peer._audio.volume=vol===0?0:Math.min(1.0, fraction);
    }
  }
  // UI badge
  const ind=document.querySelector(`#pcard_${user_id} .part-vol-indicator`);
  if(ind) ind.textContent=vol===0?'🔇':vol===100?'':vol+'%';
  const card=$(`pcard_${user_id}`);
  if(card) card.title=`${user_id} — Ses: ${vol}% (Sağ tık: ayarla)`;
};

function startCallUI(name){
  activeChatId=chatId;
  activeChatType=chatType;
  $('callName').innerText=name;
  $('callTime').innerText='Hazırlanıyor...';
  $('callUI').classList.remove('hidden');
  $('screenInd').classList.add('hidden');
  $('remoteVideo').classList.add('hidden');
  // Katılımcı gridini göster (kendi kartımız için)
  $('participantsGrid').classList.remove('hidden');
  // Kendi kartımızı ekle (yoksa)
  _ensureMyCard();
  const cb=$('callBtn');
  if(cb){ cb.textContent='🔙 Aramaya Dön'; cb.style.background='#22c55e'; }
  loadDevices();
  // 📱 Mobil arka plan ses fix — keep-alive başlat
  _startAudioKeepAlive();
  // 📱 WakeLock — ekran kapanmasın, arka planda ses çalışsın
  _acquireWakeLock();
}

// Kendi kartımızı participants grid'e ekle/güncelle
function _ensureMyCard(){
  const grid=$('participantsGrid');
  if(!grid||!ME) return;
  let myCard=grid.querySelector('[data-mycard]');
  if(!myCard){
    myCard=document.createElement('div');
    myCard.className='part-card';
    myCard.id=`pcard_${ME.user_id}`;
    myCard.setAttribute('data-mycard','1');
    myCard.setAttribute('data-user',ME.user_id);
    // Avatar
    const av=document.createElement('div');
    av.className='part-av';
    av.id='myCallAv';
    // 🛡️ [HIGH-06] Arama avatarı — setAvatarEl ile güvenli render
    setAvatarEl(av, ME.avatar, ME.user_id.charAt(0).toUpperCase());
    // Name
    const nm=document.createElement('div');
    nm.className='part-name';
    const nmTxt=document.createTextNode(ME.displayName||ME.user_id);
    const spkIco=document.createElement('span');
    spkIco.className='part-speak-icon';
    spkIco.textContent='🎙️';
    nm.appendChild(nmTxt);
    nm.appendChild(spkIco);
    // Vol bar
    const vb=document.createElement('div');
    vb.className='part-vol-bar';
    const vf=document.createElement('div');
    vf.className='part-vol-fill';
    vf.id=`pvf_${ME.user_id}`;
    vb.appendChild(vf);
    // Mute badge (başlangıçta yok)
    const mb=document.createElement('span');
    mb.className='part-mute-badge';
    mb.id='myMuteBadge';
    mb.style.display='none';
    mb.textContent='🔇';
    myCard.appendChild(av);myCard.appendChild(nm);myCard.appendChild(vb);myCard.appendChild(mb);
    grid.insertBefore(myCard,grid.firstChild);
  }
}
// Kendi mute rozeti güncelle
function _updateMyMuteBadge(muted){
  const mb=$('myMuteBadge');
  if(mb) mb.style.display=muted?'':'none';
  const mc=$('participantsGrid')?.querySelector('[data-mycard]');
  if(mc){
    if(muted) mc.style.opacity='.65';
    else mc.style.opacity='1';
  }
}
// Kendi ses seviyesini güncelle
function _updateMyVolFill(vol){
  const vf=$('myVolFill');
  if(vf) vf.style.width=(vol||0)+'%';
}
// ── AKTİF ARAMA BANNER YARDIMCI FONKSİYONLARI ──────────────────
function _showCallBanner(){
  const banner=$('activeCallBanner');
  if(!banner) return;
  // Kaç kişi var?
  const peerCount=Object.keys(groupCallPeers||{}).length;
  const total=peerCount+1; // +1 kendisi
  const info=$('acb-info');
  if(info){
    const name=activeChatId||chatId||'';
    const typeStr=activeChatType==='group'?`👥 Grup Araması · ${total} kişi`:`📞 ${name} ile arama`;
    info.innerText=typeStr;
  }
  banner.classList.add('visible');
  // Mobilde mainContent'e class ekle — chat alanı kaymasın
  const mc=$('mainContent');
  if(mc) mc.classList.add('call-banner-visible');
}
function _hideCallBanner(){
  const banner=$('activeCallBanner');
  if(banner) banner.classList.remove('visible');
  // Mobilde class kaldır
  const mc=$('mainContent');
  if(mc) mc.classList.remove('call-banner-visible');
}
window.goToActiveCall=()=>{
  // Arama ekranına git
  const cid=activeChatId||chatId;
  const ctype=activeChatType||chatType;
  if(cid&&ctype) selChat(cid,ctype);
  $('callUI')?.classList.remove('hidden');
};

function startCallTimer(){
  clearInterval(callIv);
  let s=0;
  $('callTime').innerText='00:00';
  callIv=setInterval(()=>{
    s++;
    const h=Math.floor(s/3600);
    const m=Math.floor((s%3600)/60);
    const sc=s%60;
    const timeStr= h>0
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
    $('callTime').innerText=timeStr;
    // Banner güncelle
    const bt=$('acb-timer'); if(bt) bt.innerText=timeStr;
  },1000);
  startBitrateMonitor();
  // Banner göster
  _showCallBanner();
}
function endCall(reason){
  // [FIX] ICE restart timer ve disconnect timer varsa temizle
  if(pc){
    if(pc._iceRestartTimer){ clearTimeout(pc._iceRestartTimer); pc._iceRestartTimer=null; }
    if(pc._disconnectTimer){ clearTimeout(pc._disconnectTimer); pc._disconnectTimer=null; }
  }
  // Bitrate izleyiciyi durdur
  stopBitrateMonitor();
  // Donmuş video temizle — her zaman
  const rv=$('remoteVideo');
  rv.pause(); rv.srcObject=null; rv.classList.add('hidden');
  $('audioPh').classList.remove('hidden');
  const dur=$('callTime').innerText;
  const durOk=dur&&dur!=='Hazırlanıyor...'&&dur!=='ICE hazırlanıyor...'&&dur!=='Bağlanıyor...'&&dur!=='00:00'&&!dur.startsWith('⚠️')&&!dur.startsWith('❌');
  let msg=reason;
  if(durOk&&!msg.includes('Süre:')) msg+=` · Süre: ${dur}`;
  // Sadece gerçekten bağlantı kurulmuşsa (süre varsa veya bilinçli kapatıldıysa) mesaj yaz
  const wasConnected=durOk||reason.includes('sonlandırdınız')||reason.includes('kapatıldı')||reason.includes('sona erdi');
  const targetId=activeChatId||chatId;
  const targetType=activeChatType||chatType;
  if(targetId&&targetType&&wasConnected&&msg){
    const db=getDB();
    const k=targetType==='private'?[ME.user_id,targetId].sort().join('_'):'g_'+targetId;
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push({sys:true,text:msg,time:gt()});saveDB(db);
    if(chatId===targetId)renderChat();
  }
  _stopCallNotif(); // Arama bitti — zil durdur
  clearInterval(callIv);callIv=null;
  _hideCallBanner();
  // Tüm grup peer bağlantılarındaki video track'leri kapat
  for(const peer of Object.values(groupCallPeers||{})){
    try{
      peer.pc&&peer.pc.getSenders().forEach(s=>{
        if(s.track&&s.track.kind==='video'){ try{s.track.stop();}catch(e){} }
      });
      peer.pc&&peer.pc.close();
    }catch(e){}
  }
  groupCallPeers={};
  // Private call remote GainNode temizle
  if(window._remoteGainNode){try{window._remoteGainNode.disconnect();}catch(e){} window._remoteGainNode=null;}
  if(window._remoteGac){try{window._remoteGac.close();}catch(e){} window._remoteGac=null;}
  // Private call peer stub temizle
  if(targetId&&groupCallPeers[targetId]?._isPrivate) delete groupCallPeers[targetId];
  cleanCall();$('callUI').classList.add('hidden');$('remoteVideo').srcObject=null;
  screenOwner=null;$('screenBtn').disabled=false;$('screenBtn').innerText='Ekran Paylaş';
  // 📱 Mobil arka plan ses fix — keep-alive durdur
  _stopAudioKeepAlive();
  // 📱 WakeLock bırak
  _releaseWakeLock();
  // Görüntülü arama temizle
  if(_localVideoStream){ _localVideoStream.getVideoTracks().forEach(t=>t.stop()); _localVideoStream=null; }
  _videoEnabled=false;
  const lv=$('localVideo'); if(lv) lv.remove();
  _restoreAllAvatars(); // Video bitince tüm avatarları geri getir
  const vb=$('videoBtn'); if(vb){vb.textContent='📷';vb.style.background='rgba(59,130,246,.35)!important';}
  // 3.2: Speaking detection durdur, volume'ları sıfırla
  _stopSpeakLoop();
  for(const k of Object.keys(peerVolumes)) delete peerVolumes[k];
  closePeerVolMenu();
  // Aktif arama bitti — sidebar güncelle
  _stopGroupCallBroadcast();
}

// ── GÖRÜNTÜLÜ ARAMA (Kamera) ──────────────────────────────────────
let _localVideoStream=null;
let _videoEnabled=false;

// Avatar'ı video öncesi haline döndür
function _restoreAvatar(av, user_id, isLocal){
  if(!av) return;
  av.classList.remove('has-video','is-local');
  av.innerHTML='';
  // Kullanıcı avatar verisini bul
  const db=getDB();
  let user=null;
  if(user_id===ME?.user_id) user=ME;
  else if(db.friends) user=Object.values(db.friends||{}).find(u=>u.user_id===user_id)||null;
  if(user?.avatar){
    const img=document.createElement('img');
    img.src=user.avatar;img.alt='';
    av.appendChild(img);
  } else {
    av.textContent=(user_id||'?').charAt(0).toUpperCase();
  }
}

// Tüm kartlardaki video feed'leri kaldır, avatarları geri getir
function _restoreAllAvatars(){
  const grid=$('participantsGrid');
  if(!grid) return;
  grid.querySelectorAll('.part-av.has-video').forEach(av=>{
    const card=av.closest('.part-card');
    const user_id=card?.dataset?.user;
    const isLocal=!!card?.dataset?.mycard;
    _restoreAvatar(av, user_id, isLocal);
  });
}

async function toggleVideo(){
  const btn=$('videoBtn');
  if(!_videoEnabled){
    try{
      _localVideoStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});

      // Aktif ses akışı yoksa mikrofon iznini de şimdi iste
      if(!ls){
        try{
          ls=await getMicStream();
          const audioConns=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);
          for(const conn of audioConns){
            ls.getAudioTracks().forEach(t=>{
              try{
                const exists=conn.getSenders().find(s=>s.track&&s.track.kind==='audio');
                if(!exists) conn.addTrack(t,ls);
              }catch(e){}
            });
          }
          _startSpeakDetect(ME.user_id,null,true);
          if(!_speakInterval) _startSpeakLoop();
        }catch(e){
          showToast('Mikrofon','Mikrofon izni alınamadı, yalnızca görüntü gönderilecek.');
        }
      }
      _videoEnabled=true;
      if(btn){btn.textContent='📷';btn.style.background='rgba(34,197,94,.5)!important';btn.title='Kamerayı Kapat';}
      // Kendi avatarını video ile değiştir
      const myAv=document.getElementById('myCallAv');
      if(myAv){
        myAv.classList.add('has-video','is-local');
        let localVid=myAv.querySelector('video.local-feed');
        if(!localVid){
          localVid=document.createElement('video');
          localVid.className='local-feed';
          localVid.autoplay=true;localVid.muted=true;localVid.playsInline=true;
          myAv.innerHTML='';
          myAv.appendChild(localVid);
        }
        localVid.srcObject=_localVideoStream;
      }
      // Video track'i tüm peer'lara ekle — null-track sender varsa replaceTrack kullan
      const videoTrack=_localVideoStream.getVideoTracks()[0];
      const conns=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);
      for(const conn of conns){
        try{
          // Null-track (önceden kaldırılmış) veya aktif video sender varsa replaceTrack
          const existSender=conn.getSenders().find(s=>s.track===null?s.track===null:s.track?.kind==='video');
          if(existSender) await existSender.replaceTrack(videoTrack);
          else conn.addTrack(videoTrack, _localVideoStream);
        }catch(e){}
      }
      showToast('Kamera','Görüntülü arama başladı 📷');
    }catch(e){
      showToast('Kamera Hatası','Kamera izni alınamadı veya cihaz bulunamadı.');
    }
  } else {
    // Kamerayı kapat
    _videoEnabled=false;
    if(_localVideoStream){
      _localVideoStream.getVideoTracks().forEach(t=>t.stop());
      _localVideoStream=null;
    }
    const lv=$('localVideo'); if(lv) lv.remove();
    // Kendi avatarını geri döndür — önce video srcObject'i temizle
    const myAv=document.getElementById('myCallAv');
    if(myAv){
      const localFeed=myAv.querySelector('video.local-feed');
      if(localFeed) localFeed.srcObject=null;
      _restoreAvatar(myAv, ME?.user_id, true);
    }
    if(btn){btn.textContent='📷';btn.style.background='rgba(59,130,246,.35)!important';btn.title='Kamera Aç';}
    // Video track'i null yap (sender'ı koru — replaceTrack ile yeniden açılabilsin)
    const conns=[pc,...Object.values(groupCallPeers).map(p=>p.pc)].filter(Boolean);
    for(const conn of conns){
      const sender=conn.getSenders().find(s=>s.track&&s.track.kind==='video');
      if(sender) try{await sender.replaceTrack(null);}catch(e){}
    }
    showToast('Kamera','Kamera kapatıldı.');
  }
}

// ══════════════════════════════════════════════════════════════════
//  🎤📷 MEDYA İZİN YÖNETİMİ
//  Giriş sonrası izin iste, arama öncesi durum kontrol et.
// ══════════════════════════════════════════════════════════════════

// Mevcut mikrofon + kamera izin durumunu Permission API ile sorgula
async function _queryMediaPermStates(){
  let mic='prompt', cam='prompt';
  try{ const p=await navigator.permissions.query({name:'microphone'}); mic=p.state; p.onchange=()=>{mic=p.state;}; }catch(e){}
  try{ const p=await navigator.permissions.query({name:'camera'});     cam=p.state; p.onchange=()=>{cam=p.state;}; }catch(e){}
  return {mic, cam};
}

// Giriş sonrası çağrılır — modal ile açıkla, sonra izin iste
async function _requestMediaPermissionsOnLogin(){
  if(!navigator.mediaDevices?.getUserMedia) return;

  const {mic, cam} = await _queryMediaPermStates();

  // İkisi de zaten verilmişse atla
  if(mic==='granted' && cam==='granted') return;

  const overlay=document.createElement('div');
  overlay.id='_mediaPermModal';
  overlay.style.cssText='position:fixed;inset:0;z-index:10001;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px)';

  const bothDenied = mic==='denied' && cam==='denied';
  const micDenied  = mic==='denied';
  const camDenied  = cam==='denied';

  if(bothDenied){
    overlay.innerHTML=`
      <div style="background:var(--panel);border-radius:20px;padding:28px 24px;max-width:360px;width:92%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid var(--border);animation:modalIn .25s cubic-bezier(.34,1.56,.64,1) both">
        <div style="font-size:48px;margin-bottom:12px">🎤📷</div>
        <h3 style="margin:0 0 8px;color:var(--text);font-size:18px;font-weight:700">İzinler Engelli</h3>
        <p style="color:var(--muted);font-size:13px;line-height:1.6;margin:0 0 12px">
          Mikrofon ve kamera izni daha önce reddedildi. Aramaları kullanmak için tarayıcı ayarlarından izin ver.
        </p>
        <div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--text);margin:0 0 20px;text-align:left;line-height:1.7">
          🔒 Adres çubuğuna dokun / kilit ikonuna tıkla<br>→ <strong>Site Ayarları</strong> veya <strong>İzinler</strong><br>→ Mikrofon ve Kamera → <strong>İzin Ver</strong>
        </div>
        <button id="_mpClose" style="width:100%;padding:13px;border-radius:12px;background:var(--primary);color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer">Tamam, Anlıyorum</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_mpClose').onclick=()=>overlay.remove();
    return;
  }

  const denied = micDenied ? '🎤 Mikrofon' : (camDenied ? '📷 Kamera' : '');
  const deniedNote = denied ? `<p style="background:rgba(237,66,69,.08);border:1px solid rgba(237,66,69,.2);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--danger);margin:0 0 12px;text-align:left">
    ⚠️ ${denied} izni daha önce reddedildi — tarayıcı ayarlarından açman gerekebilir.
  </p>` : '';

  overlay.innerHTML=`
    <div style="background:var(--panel);border-radius:20px;padding:28px 24px;max-width:360px;width:92%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid var(--border);animation:modalIn .25s cubic-bezier(.34,1.56,.64,1) both">
      <div style="font-size:48px;margin-bottom:12px">🎤📷</div>
      <h3 style="margin:0 0 8px;color:var(--text);font-size:18px;font-weight:700">Arama İzinleri</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.6;margin:0 0 10px">
        Sesli ve görüntülü aramaları kullanmak için <strong style="color:var(--text)">mikrofon ve kamera</strong> iznine ihtiyaç var.
      </p>
      ${deniedNote}
      <p style="color:var(--muted);font-size:12px;margin:0 0 20px">İzin verdiğinde mikrofon ve kamera sadece <strong style="color:var(--text)">arama sırasında</strong> açılır.</p>
      <div style="display:flex;gap:10px">
        <button id="_mpSkip" style="flex:1;padding:12px;border-radius:12px;background:var(--input-bg);color:var(--muted);border:1px solid var(--border);font-size:13px;cursor:pointer">Şimdi Değil</button>
        <button id="_mpAllow" style="flex:1;padding:12px;border-radius:12px;background:var(--primary);color:#fff;border:none;font-weight:700;font-size:13px;cursor:pointer">İzin Ver</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  await new Promise(resolve=>{
    overlay.querySelector('#_mpSkip').onclick=()=>{ overlay.remove(); resolve(); };
    overlay.querySelector('#_mpAllow').onclick=async()=>{
      overlay.remove();
      try{
        // Mikrofon
        if(mic!=='denied'){
          const ms=await navigator.mediaDevices.getUserMedia({audio:true, video:(cam!=='denied')});
          ms.getTracks().forEach(t=>t.stop());
          showToast('İzinler Verildi','✅ Mikrofon ve kamera hazır. Artık arayabilirsin.');
        }
      }catch(e){
        if(e.name==='NotAllowedError') showToast('İzin Reddedildi','Aramalar için tarayıcı ayarlarından izin verebilirsin.');
      }
      resolve();
    };
  });
}

// Arama başlamadan önce mikrofon iznini kontrol et.
// Reddedilmişse kullanıcıya kılavuz modal göster, false döner → arama iptal.
// 'prompt' veya 'granted' ise true döner → arama devam eder.
async function _ensureMicPermForCall(){
  let micState='prompt';
  try{
    const p=await navigator.permissions.query({name:'microphone'});
    micState=p.state;
  }catch(e){ return true; } // Permissions API yok — getUserMedia'ya bırak

  if(micState==='granted') return true;

  if(micState==='denied'){
    await new Promise(resolve=>{
      const overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;z-index:10001;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px)';
      overlay.innerHTML=`
        <div style="background:var(--panel);border-radius:20px;padding:28px 24px;max-width:360px;width:92%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid var(--border);animation:modalIn .25s cubic-bezier(.34,1.56,.64,1) both">
          <div style="font-size:48px;margin-bottom:12px">🎤🚫</div>
          <h3 style="margin:0 0 8px;color:var(--text);font-size:18px;font-weight:700">Mikrofon İzni Gerekli</h3>
          <p style="color:var(--muted);font-size:13px;line-height:1.6;margin:0 0 12px">
            Arama yapabilmek için mikrofon iznini tarayıcı ayarlarından açman gerekiyor.
          </p>
          <div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--text);margin:0 0 20px;text-align:left;line-height:1.8">
            🔒 Adres çubuğuna dokun / kilit ikonuna tıkla<br>
            → <strong>Site Ayarları</strong> / <strong>İzinler</strong><br>
            → Mikrofon → <strong>İzin Ver</strong><br>
            → Sayfayı yenile
          </div>
          <button id="_mdOk" style="width:100%;padding:13px;border-radius:12px;background:var(--primary);color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer">Tamam</button>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#_mdOk').onclick=()=>{ overlay.remove(); resolve(); };
    });
    return false;
  }

  // 'prompt' — izin henüz sorulmadı; getUserMedia sorguya gönderir, devam et
  return true;
}


let _wakeLock=null;
async function _acquireWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{
    _wakeLock=await navigator.wakeLock.request('screen');
    // Sayfa görünür olunca yenile
    document.addEventListener('visibilitychange',async()=>{
      if(_wakeLock!==null&&document.visibilityState==='visible'){
        try{_wakeLock=await navigator.wakeLock.request('screen');}catch(e){}
      }
    },{once:false});
  }catch(e){}
}
async function _releaseWakeLock(){
  if(_wakeLock){try{await _wakeLock.release();}catch(e){} _wakeLock=null;}
}

let audioCtx=null;
let noiseGateNode=null;
let vadInstance=null;
let vadGainNode=null;
let muteGainNode=null;
let processedStream=null;

// Dosya/GIF verilerini oturum boyunca bellekte tut (localStorage'a güvenme)
const _sessionFiles = new Map(); // msgId → dataURL / URL

// ══════════════════════════════════════════════════════════════════
//  🎙️ SES İŞLEME — Temiz Yaklaşım
//  AudioContext re-encoding zinciri tamamen kaldırıldı.
//  Mute: track.enabled ile direkt kontrol (AudioContext gerekmez).
//  Gürültü engelleme: Browser native constraints ile (re-encode yok = cızırtı yok).
// ══════════════════════════════════════════════════════════════════

let _rnnoiseWorkletLoaded = false; // referans bütünlüğü için

// AudioContext KALDIRILDI — muteGainNode yerine track.enabled kullanılıyor.
// buildAudioChain artık sadece stream'i olduğu gibi döndürür.
async function buildAudioChain(rawStream){
  // AudioContext zinciri KALDIRILDI — re-encoding yok, cızırtı yok
  // muteGainNode stub — geriye dönük kod için
  muteGainNode = { gain:{ value:1, setValueAtTime:()=>{} } };
  processedStream = rawStream;
  return rawStream;
}

// Ham mikrofon stream'i al — native NS açık, re-encoding YOK
async function getRawMicStream(){
  const micId = $('micSelect')?.value;
  const audioConstraints = {
    echoCancellation:    true,
    noiseSuppression:    noiseEnabled,
    autoGainControl:     true,
    sampleRate:          {ideal: 48000},
    channelCount:        1,
    googNoiseSuppression:  noiseEnabled,
    googNoiseSuppression2: noiseEnabled,
    googHighpassFilter:    noiseEnabled,
    googEchoCancellation:  true,
    googAutoGainControl:   true,
    googAutoGainControl2:  false,
    googAudioMirroring:    false,
  };
  // deviceId — ideal kullan, exact değil (bulunamazsa başarısız olmaz)
  if(micId && micId !== '') audioConstraints.deviceId = {ideal: micId};

  try{
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
  }catch(e){
    // Kısıtlar reddedildiyse sade izinle tekrar dene
    console.warn('[MIC] Gelişmiş kısıtlar başarısız, sade istekle tekrar deneniyor:', e.name);
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}

// WebRTC'ye gidecek işlenmiş stream'i döndür
// Kalıcı ham stream — bir kez izin, hep kullan
let _persistentRawStream=null;

async function getMicStream(){
  // Zaten canlı bir stream varsa yeniden kullan — gereksiz izin isteme
  if(_persistentRawStream && _persistentRawStream.getAudioTracks().some(t=>t.readyState==='live')){
    return await buildAudioChain(_persistentRawStream);
  }
  // Eskiyi temizle
  if(_persistentRawStream){
    _persistentRawStream.getAudioTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    _persistentRawStream=null;
  }
  _persistentRawStream=await getRawMicStream();
  return await buildAudioChain(_persistentRawStream);
}

// Mikrofonu tamamen kapat — arama bitince çağrılır
function _stopMicStream(){
  if(_persistentRawStream){
    _persistentRawStream.getAudioTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    _persistentRawStream=null;
    console.log('🔒 Mikrofon KAPATILDI (arama bitti)');
  }
}

// prewarmMic artık kullanılmıyor — mikrofon önceden açılmaz
function prewarmMic(){ /* 🔒 Devre dışı — güvenlik */ }

// ── MİKROFON / CİHAZ YÖNETİMİ ───────────────────────────────────
async function loadDevices(){
  try{
    // Cihaz listesi — sadece enumerate et, stream açma
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d=>d.kind==='audioinput');
    const spks = devices.filter(d=>d.kind==='audiooutput');

    const micSel=$('micSelect');
    const spkSel=$('spkSelect');
    if(micSel) micSel.innerHTML=mics.map((d,i)=>`<option value="${d.deviceId}">🎤 ${d.label||'Mikrofon '+(i+1)}</option>`).join('');
    if(spkSel) spkSel.innerHTML=spks.length
      ? spks.map((d,i)=>`<option value="${d.deviceId}">🔊 ${d.label||'Hoparlör '+(i+1)}</option>`).join('')
      : '<option value="">🔊 Varsayılan Hoparlör</option>';

    if(micSel) micSel.onchange=()=>{ if(ls) restartMicWithSettings(); };
    if(spkSel) spkSel.onchange=()=>{
      document.querySelectorAll('audio').forEach(a=>{ if(a.setSinkId) a.setSinkId(spkSel.value).catch(()=>{}); });
      const vid=$('remoteVideo');
      if(vid&&vid.setSinkId) vid.setSinkId(spkSel.value).catch(()=>{});
    };
    // ProNoise her zaman aktif — toggle yok
  }catch(e){ console.warn('Cihaz listesi alınamadı:',e); }
}

// Mikrofon restart — cihaz veya NS ayarı değişince
async function restartMicWithSettings(){
  if(!ls||!_persistentRawStream) return;
  try{
    // Önce applyConstraints ile mevcut track'i güncellemeyi dene (kesintisiz)
    const track=_persistentRawStream?.getAudioTracks()[0];
    if(track&&track.readyState==='live'){
      try{
        await track.applyConstraints({
          noiseSuppression:    noiseEnabled,
          echoCancellation:    true,
          autoGainControl:     true,
          googNoiseSuppression:  noiseEnabled,
          googNoiseSuppression2: noiseEnabled,
          googHighpassFilter:    noiseEnabled,
          googEchoCancellation:  true,
          googAutoGainControl:   true,
        });
        // Track güncel — sender'ları güncelle
        if(pc){ const s=pc.getSenders().find(s=>s.track?.kind==='audio'); if(s) await s.replaceTrack(track); }
        for(const {pc:gpc} of Object.values(groupCallPeers)){
          const s=gpc.getSenders().find(s=>s.track?.kind==='audio');
          if(s) await s.replaceTrack(track.clone());
        }
        track.enabled=!isMuted;
        return;
      }catch(e){ /* applyConstraints başarısız — yeni stream al */ }
    }
    // Fallback: yeni stream
    const rawStream=await getRawMicStream();
    _persistentRawStream=rawStream;
    const newTrack=rawStream.getAudioTracks()[0];
    if(!newTrack) return;
    newTrack.enabled=!isMuted;
    if(pc){ const s=pc.getSenders().find(s=>s.track?.kind==='audio'); if(s) await s.replaceTrack(newTrack); }
    for(const {pc:gpc} of Object.values(groupCallPeers)){
      const s=gpc.getSenders().find(s=>s.track?.kind==='audio');
      if(s) await s.replaceTrack(newTrack.clone());
    }
    ls=rawStream;
    processedStream=rawStream;
  }catch(e){ console.warn('restartMicWithSettings:', e); }
}

// ProNoise [Beta] — her zaman aktif, toggle kaldırıldı
const noiseEnabled = true;

// Ham mikrofon stream'i al — kademeli fallback zinciri
async function getRawMicStream(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    throw new Error('Bu tarayıcı/bağlantı mikrofonu desteklemiyor (HTTPS gerekli olabilir).');
  }
  const micId = $('micSelect')?.value;

  // 1. Deneme: tam kısıtlar
  try{
    const constraints = {
      audio: {
        echoCancellation:   true,
        noiseSuppression:   noiseEnabled,
        autoGainControl:    true,
        sampleRate:         {ideal: 48000},
        channelCount:       1,
      },
      video: false
    };
    if(micId && micId !== '') constraints.audio.deviceId = {ideal: micId};
    return await navigator.mediaDevices.getUserMedia(constraints);
  }catch(e1){
    // 2. Deneme: sadece temel kısıtlar
    try{
      return await navigator.mediaDevices.getUserMedia({ audio: {echoCancellation:true, noiseSuppression:true, autoGainControl:true}, video: false });
    }catch(e2){
      // 3. Deneme: kısıtsız — sadece izin iste
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }
}

// ── AKTİF GRUP ARAMASI TAKİBİ — Discord tarzı sidebar göstergesi ──
const activeGroupCalls={}; // groupId → {members:[]}

// "grp_call_ended" sinyali kaçırılırsa (offline/kopuk bağlantı), gösterge
// sonsuza dek takılı kalmasın — periyodik olarak bayat (>20s güncellenmemiş)
// kayıtları temizle. Aktif aramalarda ts her 8s'de yenilenir.
setInterval(()=>{
  let changed=false;
  for(const gid in activeGroupCalls){
    if(Date.now()-(activeGroupCalls[gid].ts||0) > 20000){
      delete activeGroupCalls[gid];
      changed=true;
      if(chatId===gid) updateChatCallBanner(null);
    }
  }
  if(changed) updateFriends();
}, 10000);

function _broadcastGroupCallActive(){
  if(!ME||chatType!=='group') return;
  const members=[ME.user_id,...callParticipants];
  broadcast({type:'grp_call_active',groupId:chatId,from:ME.user_id,members});
  updateChatCallBanner(chatId);
}

function _stopGroupCallBroadcast(){
  if(!ME||chatType!=='group') return;
  if(window._grpCallBcastIv){clearInterval(window._grpCallBcastIv);window._grpCallBcastIv=null;}
  broadcast({type:'grp_call_ended',groupId:chatId,from:ME.user_id});
  updateChatCallBanner(null);
  // Kendi grubunu temizle
  delete activeGroupCalls[chatId||activeChatId];
  updateFriends();
}

// Presence döngüsünde aktif arama durumunu da yayınla

// AudioContext olmadığı için sadece track durumunu izle
let _audioResumeInterval=null;
function _startAudioKeepAlive(){
  _stopAudioKeepAlive();
  _audioResumeInterval=setInterval(()=>{
    if(_persistentRawStream&&!isMuted){
      _persistentRawStream.getAudioTracks().forEach(t=>{ if(t.readyState==='live') t.enabled=true; });
    }
    // Mobil arka plan: AudioContext'leri resume et
    if(window._speakAudioCtx&&window._speakAudioCtx.state==='suspended'){
      window._speakAudioCtx.resume().catch(()=>{});
    }
    // Peer GainNode AudioContext'leri resume et
    Object.values(groupCallPeers||{}).forEach(p=>{
      if(p._gac&&p._gac.state==='suspended') p._gac.resume().catch(()=>{});
    });
    if(window._remoteGac&&window._remoteGac.state==='suspended') window._remoteGac.resume().catch(()=>{});
  },2000);
}
function _stopAudioKeepAlive(){
  if(_audioResumeInterval){clearInterval(_audioResumeInterval);_audioResumeInterval=null;}
}

// ── MUTE / DEAFEN ────────────────────────────────────────────────
let isMuted=false, isDeafened=false;
let groupCallPeers={};
let callParticipants=new Set();
// 3.1: Kişisel ses seviyeleri (0-200, default 100)
// Not: peerVolumes yukarıda speaking detection sisteminde tanımlandı

function toggleMute(){
  isMuted=!isMuted;

  // Track.enabled ile doğrudan mute — AudioContext yok artık
  const muteTrack=trk=>{if(trk&&trk.kind==='audio') trk.enabled=!isMuted;};

  // WebRTC sender track'leri
  if(pc) pc.getSenders().forEach(s=>s.track&&muteTrack(s.track));
  Object.values(groupCallPeers).forEach(({pc:gpc})=>{
    if(gpc) gpc.getSenders().forEach(s=>s.track&&muteTrack(s.track));
  });

  // Ham stream track'leri (çift güvence)
  if(ls) ls.getAudioTracks().forEach(t=>t.enabled=!isMuted);
  if(_persistentRawStream) _persistentRawStream.getAudioTracks().forEach(t=>t.enabled=!isMuted);

  const btn=$('muteBtn');
  btn.classList.toggle('active-mute',isMuted);
  btn.textContent=isMuted?'🔇':'🎤';
  _updateMyMuteBadge(isMuted);

  if(chatType==='private'){
    broadcast({type:'call_state',to:chatId,from:ME.user_id,muted:isMuted,deafened:isDeafened});
  } else if(chatType==='group'){
    const g=getDB().groups[chatId];
    g&&g.members.forEach(m=>{
      if(m!==ME.user_id) broadcast({type:'call_state',to:m,from:ME.user_id,groupId:chatId,muted:isMuted,deafened:isDeafened});
    });
  }
  _updateSelfBadges();
}

function toggleDeafen(){
  isDeafened=!isDeafened;
  if(pc){ pc.getReceivers().forEach(r=>{ if(r.track&&r.track.kind==='audio') r.track.enabled=!isDeafened; }); }
  Object.values(groupCallPeers).forEach(p=>{
    if(p.pc) p.pc.getReceivers().forEach(r=>{ if(r.track&&r.track.kind==='audio') r.track.enabled=!isDeafened; });
    if(p._audio) p._audio.muted=isDeafened;
    if(p.stream) p.stream.getAudioTracks().forEach(t=>{t.enabled=!isDeafened;});
    // GainNode sesi de kapat/aç — audio.volume=0 olduğu için GainNode tek ses yolu
    if(p._gainNode){
      try{
        const targetVol=isDeafened?0:(peerVolumes[Object.keys(groupCallPeers).find(k=>groupCallPeers[k]===p)]??100)/100;
        p._gainNode.gain.setTargetAtTime(isDeafened?0:targetVol, p._gac?.currentTime||0, 0.01);
      }catch(e){}
    }
  });
  const btn=$('deafenBtn');
  btn.classList.toggle('active-deafen',isDeafened);
  btn.textContent=isDeafened?'🔕':'🔊';
  if(chatType==='private'){
    broadcast({type:'call_state',to:chatId,from:ME.user_id,muted:isMuted,deafened:isDeafened});
  } else if(chatType==='group'){
    const g=getDB().groups[chatId];
    g&&g.members.forEach(m=>{
      if(m!==ME.user_id) broadcast({type:'call_state',to:m,from:ME.user_id,groupId:chatId,muted:isMuted,deafened:isDeafened});
    });
  }
  _updateSelfBadges();
}

let peerCallStates={};

function updateParticipantsGrid(){
  const grid=$('participantsGrid');
  if(!callParticipants.size&&chatType!=='group') return;
  grid.classList.remove('hidden');
  $('audioPh').classList.add('hidden');

  const allParts=[ME.user_id,...callParticipants];
  const count=allParts.length;
  // Responsive sınıflar
  grid.classList.remove('solo','few','many','crowded');
  if(count<=2) grid.classList.add('solo');
  else if(count<=4) grid.classList.add('few');
  else if(count<=8) grid.classList.add('many');
  else grid.classList.add('crowded');

  const avSize=count>=9?46:count>=5?60:count<=2?100:80;
  const fontSize=Math.round(avSize*0.38);
  const isSmall=count>=5;

  grid.innerHTML=allParts.map(u=>{
    const isSelf=u===ME.user_id;
    const state=isSelf
      ? {muted:isMuted, deafened:isDeafened}
      : (peerCallStates[u]||{});
    const rawAv=isSelf?ME.avatar:avatars[u];
    // 🛡️ [HIGH-06] Arama grid avatarı dogrulaması
    const safeRawAvCG=sanitizeAvatarUrl(rawAv);
    const avHTML=safeRawAvCG
      ? `<img src="${safeRawAvCG}" style="width:100%;height:100%;object-fit:cover;">`
      : escHtml(u.charAt(0).toUpperCase());
    const vol=peerVolumes[u]!==undefined?peerVolumes[u]:100;
    const volTxt=!isSelf
      ? `<span class="part-vol-indicator">${vol===0?'🔇':vol===100?'':vol+'%'}</span>`
      : '';
    const volBtn=!isSelf
      ? `<button class="part-vol-btn" data-act="openPeerVolMenu" data-a="${escHtml(u)}" data-pass-event="1" title="Ses Ayarla">🔊</button>`
      : '';
    const ctxAttr=isSelf?'':` data-ctx-act="openPeerVolMenu" data-ctx-a="${escHtml(u)}" data-ctx-pass-event="1"`;
    const muteBadge = state.muted ? `<span class="part-mute-badge">🔇</span>` : '';
    const deafBadge = state.deafened ? `<span class="deafen-badge">🔕</span>` : '';
    return `<div class="part-card${isSmall?' part-card-sm':''}" id="pcard_${u}"${ctxAttr}>
      <div class="part-av" style="width:${avSize}px;height:${avSize}px;font-size:${fontSize}px">${avHTML}</div>
      <span class="part-name">${isSelf?'Sen':u}<span class="part-speak-icon">🎙️</span></span>
      <div class="part-vol-bar"><div class="part-vol-fill" id="pvf_${u}"></div></div>
      ${muteBadge}${deafBadge}${volTxt}${volBtn}
    </div>`;
  }).join('');
}

// ── GRUP ARAMASI (WebRTC mesh) ────────────────────────────────────
async function startGroupCall(){
  cleanCall();
  isMuted=false;isDeafened=false;
  if(_persistentRawStream&&!isMuted) _persistentRawStream.getAudioTracks().forEach(t=>t.enabled=true);
  $('muteBtn').className='';$('muteBtn').textContent='🎤';
  $('deafenBtn').className='';$('deafenBtn').textContent='🔊';
  callParticipants=new Set();
  groupCallPeers={};

  // 🎤 Mikrofon izni kontrol et — reddedilmişse kullanıcıya kılavuz göster
  const _grpMicOk = await _ensureMicPermForCall();
  if(!_grpMicOk) return;

  startCallUI(getDB().groups[chatId].name);
  $('participantsGrid').classList.remove('hidden');
  $('audioPh').classList.add('hidden');
  // Sohbet içi banner'ı gizle — artık aramadayız
  updateChatCallBanner(null);

  try{
    ls=await getMicStream();
  }catch(e){
    let errMsg='Mikrofon izni alınamadı.';
    if(e&&e.name==='NotAllowedError') errMsg='Mikrofon erişimi reddedildi. Tarayıcı ayarlarından izin ver.';
    else if(e&&e.name==='NotFoundError') errMsg='Mikrofon bulunamadı.';
    else if(e&&e.name==='NotReadableError') errMsg='Mikrofon başka bir uygulama tarafından kullanılıyor.';
    else if(e&&e.message) errMsg=e.message;
    endCall(errMsg);return;
  }

  // Mikrofon hazır — kendi ses göstergesini başlat
  _startSpeakDetect(ME.user_id, null, true);
  if(!_speakInterval) _startSpeakLoop();

  const g=getDB().groups[chatId];
  g.members.forEach(m=>{
    if(m!==ME.user_id&&isOn(m)){
      broadcastGroupCallOffer(m);
    }
  });
  updateParticipantsGrid();
  // Aktif arama bildir — Discord tarzı sidebar göstergesi
  _broadcastGroupCallActive();
  if(window._grpCallBcastIv) clearInterval(window._grpCallBcastIv);
  window._grpCallBcastIv=setInterval(_broadcastGroupCallActive, 8000); // 8s'de bir güncelle
}

async function broadcastGroupCallOffer(targetUser){
  const gpc=new RTCPeerConnection(rtcCfg);
  groupCallPeers[targetUser]={pc:gpc,stream:null};
  ls.getTracks().forEach(t=>gpc.addTrack(t,ls));
  gpc.onicecandidate=()=>{};
  gpc.ontrack=e=>{
    const s=e.streams[0];if(!s)return;
    groupCallPeers[targetUser].stream=s;
    // ── Bug fix: sağır moddayken yeni kişinin sesini hemen kapat ──
    if(isDeafened){
      s.getAudioTracks().forEach(t=>{t.enabled=false;});
    }
    if(s.getVideoTracks().length>0){
      const card=document.getElementById(`pcard_${targetUser}`);
      const av=card?.querySelector('.part-av');
      if(av){
        av.classList.add('has-video');
        let vid=av.querySelector('video.remote-feed');
        if(!vid){vid=document.createElement('video');vid.className='remote-feed';vid.autoplay=true;vid.playsInline=true;vid.muted=false;vid.ondblclick=toggleVideoFullscreen;av.innerHTML='';av.appendChild(vid);}
        vid.srcObject=s;
        const rv=$('remoteVideo');if(rv)rv.srcObject=s;
      }
    } else {
      const a=new Audio(); a.srcObject=s;
      // Double audio routing fix: sesi SADECE GainNode çıkarsın, Audio element sessiz kalsın
      a.volume=0;
      if(isDeafened) a.muted=true;
      a.play().catch(()=>{});
      groupCallPeers[targetUser]._audio=a;
      // GainNode — 0-150% ses kontrolü (asıl ses buradan çıkıyor)
      try{
        const _gac=new(window.AudioContext||window.webkitAudioContext)();
        const _src=_gac.createMediaStreamSource(s);
        const _gn=_gac.createGain();
        const _vol=peerVolumes[targetUser]!==undefined?peerVolumes[targetUser]:100;
        _gn.gain.value=isDeafened?0:(_vol/100);
        _src.connect(_gn); _gn.connect(_gac.destination);
        groupCallPeers[targetUser]._gainNode=_gn;
        groupCallPeers[targetUser]._gac=_gac;
      }catch(e){}
      setTimeout(()=>_startSpeakDetect(targetUser, a, false), 500);
    }
  };
  gpc.oniceconnectionstatechange=()=>handleIceState(gpc,targetUser);
  const offer=await gpc.createOffer();
  await gpc.setLocalDescription(offer);
  await waitForIceGathering(gpc);
  // ── Bug fix: eğer aktif ekran paylaşımı varsa yeni kişiye de gönder ──
  if(screenOwner===ME.user_id&&pc){
    const vSender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
    if(vSender&&vSender.track){
      try{gpc.addTrack(vSender.track.clone(), ls);}catch(e){}
    }
  }
  broadcastRTC({type:'grp_offer',to:targetUser,from:ME.user_id,groupId:chatId,sdp:gpc.localDescription});
  callParticipants.add(targetUser);
  updateParticipantsGrid();
}

const _patchedGroupCallSignals=async(d)=>{
  if(!ME)return;
  if(d.from&&blocked.includes(d.from))return;

  if(d.type==='call_state'&&d.to===ME.user_id){
    peerCallStates[d.from]={muted:d.muted,deafened:d.deafened};
    updateParticipantsGrid();
    return;
  }

  if(d.type==='grp_offer'&&d.to===ME.user_id){
    // Duplikat grp_offer koruma — aynı from'dan 3 saniye içinde tekrar gelirse ignore
    const _grpKey='grpOfferDedup_'+d.from+'_'+d.groupId;
    if(window[_grpKey]){return;}
    window[_grpKey]=true;
    setTimeout(()=>{window[_grpKey]=false;},3000);
    const callOpen=!$('callUI').classList.contains('hidden');
    if(!callOpen){
      window._pendingGrpOffers=window._pendingGrpOffers||[];
      window._pendingGrpOffers.push(d);
      if(window._pendingGrpOffers.length===1){
        const gName=getDB().groups[d.groupId]?.name||d.groupId;
        $('callerName').innerText=`📞 ${d.from} — Grup: ${gName}`;
        window._offer={...d,isGroup:true};
        $('callModal').classList.remove('hidden');
      }
      return;
    }
    await _joinGroupPeer(d);
    return;
  }

  if(d.type==='grp_answer'&&d.to===ME.user_id){
    const gpc=groupCallPeers[d.from]?.pc;
    if(gpc){
      await gpc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      startCallTimer();
      // ── Bug fix: aktif ekran paylaşımı varsa yeni katılana hemen gönder ──
      if(screenOwner===ME.user_id){
        try{
          const vt=pc?.getSenders().find(s=>s.track&&s.track.kind==='video')?.track;
          const at=pc?.getSenders().find(s=>s.track&&s.track.kind==='audio'&&s.track.label?.includes('System'))?.track;
          if(vt){
            const vSnd=gpc.getSenders().find(s=>s.track&&s.track.kind==='video');
            if(vSnd) await vSnd.replaceTrack(vt);
            else gpc.addTrack(vt.clone());
            const scOffer=await gpc.createOffer({offerToReceiveVideo:true});
            await gpc.setLocalDescription(scOffer);
            await waitForIceGathering(gpc);
            broadcastRTC({type:'screen_offer',to:d.from,from:ME.user_id,sdp:gpc.localDescription,hasAudio:!!at});
          }
        }catch(e){console.warn('screen relay to new peer failed:',e);}
      }
    }
    return;
  }

  if(d.type==='grp_ice'&&d.to===ME.user_id){
    const gpc=groupCallPeers[d.from]?.pc;
    if(gpc&&gpc.remoteDescription){ try{await gpc.addIceCandidate(new RTCIceCandidate(d.cand));}catch(e){} }
    return;
  }

  if(d.type==='grp_end'&&d.to===ME.user_id){
    callParticipants.delete(d.from);
    if(groupCallPeers[d.from]){
      // ── Ses sızıntısı fix: peer'ın audio element'ini durdur ──
      if(groupCallPeers[d.from]._audio){
        try{groupCallPeers[d.from]._audio.pause();groupCallPeers[d.from]._audio.srcObject=null;}catch(e){}
        groupCallPeers[d.from]._audio=null;
      }
      // ── Deafen/leak fix: GainNode bağlantısını kes ve AudioContext'i kapat ──
      if(groupCallPeers[d.from]._gainNode){
        try{groupCallPeers[d.from]._gainNode.disconnect();}catch(e){}
        groupCallPeers[d.from]._gainNode=null;
      }
      if(groupCallPeers[d.from]._gac){
        try{groupCallPeers[d.from]._gac.close();}catch(e){}
        groupCallPeers[d.from]._gac=null;
      }
      try{groupCallPeers[d.from].pc.close();}catch(e){}
      const rv=$('remoteVideo');
      if(rv.srcObject && groupCallPeers[d.from].stream &&
         rv.srcObject.id===groupCallPeers[d.from].stream.id){
        rv.pause(); rv.srcObject=null; rv.classList.add('hidden');
        $('audioPh').classList.remove('hidden');
        for(const [, peer] of Object.entries(groupCallPeers)){
          if(peer.stream && peer.stream.getVideoTracks().length>0){
            rv.srcObject=peer.stream; rv.classList.remove('hidden');
            $('audioPh').classList.add('hidden'); break;
          }
        }
      }
      delete groupCallPeers[d.from];
    }
    delete peerCallStates[d.from];
    updateParticipantsGrid();
    if(callParticipants.size===0){
      const dur=$('callTime').innerText;
      const durOk=dur&&dur!=='Hazırlanıyor...'&&dur!=='ICE hazırlanıyor...'&&dur!=='Bağlanıyor...'&&dur!=='00:00';
      endCall(`📞 Grup araması sona erdi${durOk?' · Süre: '+dur:''}`);
    } else {
      showToast('Arama',`${d.from} aramadan ayrıldı.`);
    }
    return;
  }

  if(d.type==='group_update'){
    const db=getDB();
    const g=db.groups[d.groupId];
    if(g){
      // 🛡️ [SAST-1 FIX] Yetki kontrolü: önceden hiç yoktu — herhangi bir
      // üye (veya groupId'yi bilen biri) sahte group_update göndererek
      // kendini admin yapabiliyor, başkalarını üyelikten/yöneticilikten
      // düşürebiliyordu. Artık gönderenin (d.from) ALICININ KENDİ yerel
      // admin kaydında olması gerekiyor — TEK istisna: bir üyenin sadece
      // kendini üye listesinden çıkarması (gruptan ayrılma, admin gerekmez).
      const groupAdmins=g.admins||(g.admin?[g.admin]:[]);
      const isAdmin=groupAdmins.includes(d.from);
      const isSelfLeave=!isAdmin && d.members && !d.admins && !d.name && !d.avatar && !d.newAdmin
        && _isValidSelfLeave(g.members, d.members, d.from);
      if(!isAdmin && !isSelfLeave){
        console.warn('[SEC] Yetkisiz group_update reddedildi:', d.from, 'groupId=', d.groupId);
        return;
      }
      const oldName=g.name;
      if(d.name)g.name=d.name;
      if(d.avatar)g.avatar=d.avatar;
      if(d.members)g.members=d.members;
      if(d.admins)g.admins=d.admins;
      if(d.newAdmin){
        if(!g.admins)g.admins=[];
        if(!g.admins.includes(d.newAdmin))g.admins.push(d.newAdmin);
      }
      // 🛡️ [HIGH-05] Grup güncelleme içerikleri escape ediliyor — Stored XSS önlendi
      if(d.name&&d.name!==oldName){
        const k='g_'+d.groupId;
        if(!db.messages[k])db.messages[k]=[];
        db.messages[k].push({sys:true,text:`✏️ ${escHtml(d.from)} grup adını "${escHtml(oldName)}" → "${escHtml(d.name)}" olarak değiştirdi.`,time:gt()});
        if(chatId===d.groupId)renderChat();
      }
      saveDB(db);
      updateUI();
      if(chatId===d.groupId){
        if(d.name) $('chatName').innerText=d.name;
        // 🛡️ [HIGH-06] Grup avatar dogrulaması — setAvatarEl ile güvenli render
        if(d.avatar){ setAvatarEl($('chatAv'), d.avatar, d.groupId.charAt(0).toUpperCase()); }
        if(d.members) $('chatSub').innerText=`${d.members.length} Üye`;
      }
      if(d.newAdmin===ME.user_id)showToast('Yönetici Oldun!','Artık bu grubun yöneticisisin.');
      if($('groupDetailPanel').classList.contains('open'))openGroupDetail(d.groupId);
    }
    return;
  }

  if(d.type==='group_kick'&&d.to===ME.user_id){
    const db=getDB();
    const g=db.groups[d.groupId];
    if(g){
      // 🛡️ [SAST-1 FIX] Yetki kontrolü: önceden hiç yoktu — herhangi bir
      // üye (hatta groupId'yi bilen, üye olmayan biri) sahte group_kick
      // göndererek grubu yerel DB'den sildirebiliyordu. Artık gönderen
      // gerçekten admin değilse hiçbir şey yapılmaz.
      const groupAdmins=g.admins||(g.admin?[g.admin]:[]);
      if(!groupAdmins.includes(d.from)){
        console.warn('[SEC] Yetkisiz group_kick reddedildi:', d.from, 'groupId=', d.groupId);
        return;
      }
      delete db.groups[d.groupId];
      delete db.messages['g_'+d.groupId];
      saveDB(db);
    } else {
      return; // grup zaten yoksa kovulma efektlerini (toast vb.) tetiklemeye gerek yok
    }
    // ── Bug fix: aktif grup aramasındaysa aramayı bitir ──
    const inGroupCall=!$('callUI').classList.contains('hidden')&&
      (activeChatId===d.groupId||chatId===d.groupId)&&chatType==='group';
    if(inGroupCall){
      // Diğer katılımcılara grp_end gönder
      Object.keys(groupCallPeers).forEach(m=>{
        broadcast({type:'grp_end',to:m,from:ME.user_id,groupId:d.groupId});
      });
      endCall('Gruptan çıkarıldınız — arama sonlandı.');
    }
    if(chatId===d.groupId){chatId=null;chatType=null;$('emptyState').classList.remove('hidden');}
    if($('groupDetailPanel').classList.contains('open'))closeGroupDetail();
    updateUI();
    showToast('Gruptan Çıkarıldın',`${d.from} sizi "${d.groupName}" grubundan çıkardı.`);
    return;
  }
};

const handleSigOrig=handleSig;
handleSig=async(d)=>{
  // NOT: Duplikat kontrolü en dıştaki override'da yapılıyor
  await _patchedGroupCallSignals(d);
  const newTypes=['call_state','grp_offer','grp_answer','grp_ice','grp_end','group_update','group_kick','msg_read','msg_edit','msg_delete','msg_react','group_read','screen_offer','screen_answer','grp_call_active','grp_call_ended'];
  if(d.type==='screen_offer'&&d.to===ME.user_id){
    // Ekran paylaşımı renegotiation — yeni video track geliyor
    const conn=pc||(groupCallPeers[d.from]?.pc);
    if(conn){
      try{
        await conn.setRemoteDescription(new RTCSessionDescription(d.sdp));
        const ans=await conn.createAnswer();
        await conn.setLocalDescription(ans);
        broadcastRTC({type:'screen_answer',to:d.from,from:ME.user_id,sdp:conn.localDescription});
      }catch(e){console.warn('screen_offer handle err:',e);}
    }
    return;
  }
  if(d.type==='screen_answer'&&d.to===ME.user_id){
    const conn=pc||(groupCallPeers[d.from]?.pc);
    if(conn){
      try{await conn.setRemoteDescription(new RTCSessionDescription(d.sdp));}catch(e){}
    }
    return;
  }
  // ── Aktif grup araması — Discord tarzı sidebar göstergesi ──
  if(d.type==='grp_call_active'&&d.groupId){
    activeGroupCalls[d.groupId]={members:d.members||[d.from],ts:Date.now()};
    if(chatId===d.groupId) updateChatCallBanner(d.groupId);
    updateFriends(); // sidebar'ı güncelle
    return;
  }
  if(d.type==='grp_call_ended'&&d.groupId){
    delete activeGroupCalls[d.groupId];
    if(chatId===d.groupId) updateChatCallBanner(null);
    updateFriends();
    return;
  }
  if(!newTypes.includes(d.type)) await handleSigOrig(d);
};

// ── ICE BAĞLANTI DURUMU İZLEYİCİSİ ──────────────────────────────
// connectionState: iceConnectionState'den daha güvenilir, ayrıca dinlenir
function handleConnectionState(peerConnection, targetUser){
  const s = peerConnection.connectionState;
  console.log(`[CONN] [${targetUser}]: connectionState=${s}`);
  if(s === 'connected'){
    // ICE restart recovery timer varsa temizle — bağlantı kuruldu
    if(peerConnection._iceRestartTimer){
      clearTimeout(peerConnection._iceRestartTimer);
      peerConnection._iceRestartTimer = null;
    }
    // ice handler'ı tetikle — timer başlasın
    handleIceState(peerConnection, targetUser);
  }
  if(s === 'disconnected'){
    // 'disconnected' geçici olabilir — 6sn bekle, düzelmezse failed gibi işle
    if(!peerConnection._disconnectTimer){
      peerConnection._disconnectTimer = setTimeout(()=>{
        peerConnection._disconnectTimer = null;
        if(peerConnection.connectionState === 'disconnected' ||
           peerConnection.connectionState === 'failed'){
          handleConnectionState(peerConnection, targetUser);
        }
      }, 6000);
    }
  }
  if(s === 'connected' || s === 'closed'){
    // disconnected timer'ı temizle
    if(peerConnection._disconnectTimer){
      clearTimeout(peerConnection._disconnectTimer);
      peerConnection._disconnectTimer = null;
    }
  }
  if(s === 'failed'){
    const el=$('callTime');
    // ICE restart: bir kez dene
    if(!peerConnection._iceRestartDone){
      peerConnection._iceRestartDone = true;
      if(el) el.innerText = 'ICE yeniden bağlanıyor...';
      console.warn('[ICE] Restart deneniyor:', targetUser);
      try{ peerConnection.restartIce(); }catch(e){}
      // Caller tarafı yeni offer gönder
      if(peerConnection._isCallerSide){
        (async()=>{
          try{
            const offer = await peerConnection.createOffer({iceRestart:true});
            await peerConnection.setLocalDescription(offer);
            broadcastRTC({type:'rtc_offer',to:targetUser,from:ME.user_id,sdp:peerConnection.localDescription,iceRestart:true});
          }catch(e){ endCall('❌ Bağlantı kurulamadı.'); }
        })();
      }
      // [FIX] Callee tarafı: caller'dan restart offer bekleniyor.
      // Ama offer hiç gelmezse sonsuza kadar beklemez — 10sn timeout.
      peerConnection._iceRestartTimer = setTimeout(()=>{
        peerConnection._iceRestartTimer = null;
        if(peerConnection.connectionState !== 'connected' &&
           peerConnection.connectionState !== 'closed'){
          endCall('❌ Bağlantı yeniden kurulamadı (zaman aşımı).');
        }
      }, 10000);
    } else {
      // İkinci kez failed — restart da işe yaramadı
      if(peerConnection._iceRestartTimer){
        clearTimeout(peerConnection._iceRestartTimer);
        peerConnection._iceRestartTimer = null;
      }
      endCall('❌ Bağlantı başarısız (ICE restart sonrası).');
    }
  }
}

function handleIceState(peerConnection, targetUser){
  const s=peerConnection.iceConnectionState;
  console.log(`ICE [${targetUser}]: iceState=${s}`);
  const el=$('callTime');
  if(s==='connected'||s==='completed'){
    console.log('✅ Bağlantı kuruldu:',targetUser);
    _hideRinging(); // Çaldırma ekranını kapat — bağlantı kuruldu
    // Timer sadece ilk connected'da başlat
    if(el&&(el.innerText==='Bağlanıyor...'||el.innerText==='ICE hazırlanıyor...')){
      if(callIv===null) startCallTimer();
    }
  } else if(s==='failed'){
    console.error('❌ ICE başarısız:',targetUser);
    showToast('Bağlantı Hatası','ICE başarısız — TURN sunucusuna ulaşılamıyor.');
    if(el) el.innerText='❌ Bağlantı başarısız';
    // Donmuş video sorununu engelle: direkt temizle
    const rv=$('remoteVideo');
    rv.pause(); rv.srcObject=null; rv.classList.add('hidden');
    $('audioPh').classList.remove('hidden');
    // Grup aramada sadece bu peer'ı sil; DM'de çağrıyı bitir
    if(groupCallPeers[targetUser]){
      callParticipants.delete(targetUser);
      try{groupCallPeers[targetUser].pc.close();}catch(e){}
      delete groupCallPeers[targetUser];
      updateParticipantsGrid();
    } else {
      endCall('❌ Bağlantı başarısız.');
    }
  } else if(s==='disconnected'){
    if(el) el.innerText='⚠️ Bağlantı kesildi';
    // 5sn sonra hâlâ disconnected ise temizle
    setTimeout(()=>{
      if(peerConnection.iceConnectionState==='disconnected'||peerConnection.iceConnectionState==='failed'){
        // Video donmasını engelle
        const rv=$('remoteVideo');
        rv.pause(); rv.srcObject=null; rv.classList.add('hidden');
        $('audioPh').classList.remove('hidden');
        if(groupCallPeers[targetUser]){
          callParticipants.delete(targetUser);
          try{groupCallPeers[targetUser].pc.close();}catch(e){}
          delete groupCallPeers[targetUser];
          updateParticipantsGrid();
          showToast('Arama',`${targetUser} bağlantısı kesildi.`);
        } else {
          endCall(`⚠️ ${targetUser} ile bağlantı kesildi.`);
        }
      }
    },5000);
  } else if(s==='closed'){
    // Donmuş video temizle
    const rv=$('remoteVideo');
    rv.pause(); rv.srcObject=null; rv.classList.add('hidden');
    $('audioPh').classList.remove('hidden');
  }
}

async function _joinGroupPeer(d){
  if(!ls){
    try{ls=await getMicStream();}
    catch(e){return;}
  }
  if(groupCallPeers[d.from]){ try{groupCallPeers[d.from].pc.close();}catch(e){} }
  const gpc=new RTCPeerConnection(rtcCfg);
  groupCallPeers[d.from]={pc:gpc,stream:null};
  ls.getTracks().forEach(t=>gpc.addTrack(t,ls));
  gpc.onicecandidate=()=>{};
  gpc.ontrack=e=>{
    const s=e.streams[0];if(!s)return;
    groupCallPeers[d.from].stream=s;
    // ── Bug fix: sağır moddayken yeni kişinin sesini hemen kapat ──
    if(isDeafened){
      s.getAudioTracks().forEach(t=>{t.enabled=false;});
    }
    if(s.getVideoTracks().length>0){
      const card=document.getElementById(`pcard_${d.from}`);
      const av=card?.querySelector('.part-av');
      if(av){
        av.classList.add('has-video');
        let vid=av.querySelector('video.remote-feed');
        if(!vid){vid=document.createElement('video');vid.className='remote-feed';vid.autoplay=true;vid.playsInline=true;vid.muted=false;vid.ondblclick=toggleVideoFullscreen;av.innerHTML='';av.appendChild(vid);}
        vid.srcObject=s;
        const rv=$('remoteVideo');if(rv)rv.srcObject=s;
      }
    } else {
      const a=new Audio(); a.srcObject=s;
      // Double audio routing fix: sesi SADECE GainNode çıkarsın, Audio element sessiz kalsın
      a.volume=0;
      if(isDeafened) a.muted=true;
      a.play().catch(()=>{});
      groupCallPeers[d.from]._audio=a;
      // GainNode — 0-150% ses kontrolü (asıl ses buradan çıkıyor)
      try{
        const _gac=new(window.AudioContext||window.webkitAudioContext)();
        const _src=_gac.createMediaStreamSource(s);
        const _gn=_gac.createGain();
        const _vol=peerVolumes[d.from]!==undefined?peerVolumes[d.from]:100;
        _gn.gain.value=isDeafened?0:(_vol/100);
        _src.connect(_gn); _gn.connect(_gac.destination);
        groupCallPeers[d.from]._gainNode=_gn;
        groupCallPeers[d.from]._gac=_gac;
      }catch(e){}
      setTimeout(()=>_startSpeakDetect(d.from, a, false), 500);
    }
  };
  gpc.oniceconnectionstatechange=()=>handleIceState(gpc,d.from);
  await gpc.setRemoteDescription(new RTCSessionDescription(d.sdp));
  const ans=await gpc.createAnswer();
  await gpc.setLocalDescription(ans);
  await waitForIceGathering(gpc);
  broadcastRTC({type:'grp_answer',to:d.from,from:ME.user_id,groupId:d.groupId,sdp:gpc.localDescription});
  callParticipants.add(d.from);
  updateParticipantsGrid();
  if(callIv===null) startCallTimer();
}

$('acceptCallBtn').onclick=async()=>{
  const o=window._offer;

  // 🎤 Mikrofon iznini ÖNCE kontrol et — bu bir user gesture (tıklama),
  // izin henüz 'prompt' ise tarayıcı şimdi sorar; 'denied' ise kılavuz modal
  // gösterilir ve izin verilmezse arama otomatik reddedilir.
  const _accMicOk = await _ensureMicPermForCall();
  if(!_accMicOk){
    // İzin reddedildi — aramayı karşı tarafa da bildir
    _stopCallNotif();
    window._pendingGrpOffers=[];
    if(o&&o.isGroup){
      broadcast({type:'grp_end',to:o.from,from:ME.user_id,groupId:o.groupId});
    } else if(o){
      broadcast({type:'rtc_reject',to:o.from,from:ME.user_id});
    }
    showToast('Arama Reddedildi','🎤 Mikrofon izni olmadan arama yapılamaz.');
    return;
  }

  _stopCallNotif(); // Zili durdur — aramayı kabul ettik
  $('callModal').classList.add('hidden');

  if(o&&o.isGroup){
    callParticipants=new Set();groupCallPeers={};
    isMuted=false;isDeafened=false;
    if(_persistentRawStream&&!isMuted) _persistentRawStream.getAudioTracks().forEach(t=>t.enabled=true);
    $('muteBtn').textContent='🎤';$('muteBtn').classList.remove('active-mute');
    $('deafenBtn').textContent='🔊';$('deafenBtn').classList.remove('active-deafen');
    const gName=getDB().groups[o.groupId]?.name||o.groupId;
    startCallUI(gName);
    $('participantsGrid').classList.remove('hidden');$('audioPh').classList.add('hidden');
    const pending=window._pendingGrpOffers||[];
    window._pendingGrpOffers=[];
    for(const pd of pending) await _joinGroupPeer(pd);
    return;
  }

  cleanCall();isMuted=false;isDeafened=false;
  if(_persistentRawStream&&!isMuted) _persistentRawStream.getAudioTracks().forEach(t=>t.enabled=true);
  $('participantsGrid').classList.remove('hidden');
  $('audioPh').classList.add('hidden');
  startCallUI(o.from);
  $('callTime').innerText='Hazırlanıyor...';
  pc=new RTCPeerConnection(rtcCfg);
  try{ls=await getMicStream();ls.getTracks().forEach(t=>pc.addTrack(t,ls));
    _startSpeakDetect(ME.user_id, null, true);
    if(!_speakInterval) _startSpeakLoop();
  }
  catch(e){
    broadcast({type:'rtc_reject',to:o.from,from:ME.user_id});
    let errMsg='Mikrofon izni alınamadı.';
    if(e&&e.name==='NotAllowedError') errMsg='Mikrofon erişimi reddedildi. Tarayıcı ayarlarından izin ver.';
    else if(e&&e.name==='NotFoundError') errMsg='Mikrofon bulunamadı.';
    else if(e&&e.name==='NotReadableError') errMsg='Mikrofon başka bir uygulama tarafından kullanılıyor.';
    else if(e&&e.message) errMsg=e.message;
    endCall(errMsg);return;
  }
  // Trickle ICE: adayları anında gönder
  pc.onicecandidate=(e)=>{
    if(e.candidate) broadcastRTC({type:'rtc_ice',to:o.from,from:ME.user_id,cand:e.candidate});
  };
  pc.ontrack=onTrack;
  pc._isCallerSide=false;
  pc.oniceconnectionstatechange=()=>{handleIceState(pc,o.from);};
  pc.onconnectionstatechange=()=>{handleConnectionState(pc,o.from);};
  // Renegotiation — karşı taraf yeni track eklediğinde (örn. video açtığında)
  // _setupDone: initial offer/answer tamamlanana kadar onnegotiationneeded susturulur
  pc._setupDone=false;
  pc.onnegotiationneeded=async()=>{
    if(!pc||pc.signalingState==='closed') return;
    if(!pc._setupDone) return; // ilk setup bitmeden renegotiation yok
    if(!pc.remoteDescription) return;
    try{
      const offer=await pc.createOffer();
      if(!pc||pc.signalingState==='closed') return;
      await pc.setLocalDescription(offer);
      broadcastRTC({type:'rtc_renego',to:o.from,from:ME.user_id,sdp:pc.localDescription});
    }catch(e){}
  };
  await pc.setRemoteDescription(new RTCSessionDescription(o.sdp));
  // Bekleyen ICE adaylarını uygula
  for(const cand of iceQ){try{await pc.addIceCandidate(new RTCIceCandidate(cand));}catch(e){}}
  iceQ=[];
  const ans=await pc.createAnswer();
  await pc.setLocalDescription(ans);
  // Answer'ı ICE beklenmeden anında gönder
  broadcastRTC({type:'rtc_answer',to:o.from,from:ME.user_id,sdp:pc.localDescription});
  pc._setupDone=true; // callee: answer gönderildi, renegotiation artık serbest
  $('callTime').innerText='Bağlanıyor...';
  // startCallTimer ICE connected'da çağrılır
};

$('rejectCallBtn').onclick=()=>{
  _stopCallNotif(); // Zili durdur
  _stopMicStream(); // 🔒 Mikrofonu kapat
  $('callModal').classList.add('hidden');
  const o=window._offer;
  window._pendingGrpOffers=[];
  if(o&&o.isGroup){
    broadcast({type:'grp_end',to:o.from,from:ME.user_id,groupId:o.groupId});
  } else {
    broadcast({type:'rtc_reject',to:o.from,from:ME.user_id});
  }
};

$('callBtn').onclick=async()=>{
  // Aktif arama varsa → callUI'yı göster (tekrar arama başlatma)
  const callUIHidden=$('callUI').classList.contains('hidden');
  if(!callUIHidden){
    // callUI zaten açık — hiçbir şey yapma
    return;
  }
  // callUI gizli ama arama devam ediyor (minimize edildi) → göster
  const callOngoing=callIv!==null||Object.keys(groupCallPeers||{}).length>0||pc;
  if(callOngoing){
    $('callUI').classList.remove('hidden');
    return;
  }
  debugIce(); // ICE durumunu kontrol et ve logla
  if(chatType==='group'){
    startGroupCall();
  } else {
    cleanCall();isMuted=false;isDeafened=false;
    if(_persistentRawStream&&!isMuted) _persistentRawStream.getAudioTracks().forEach(t=>t.enabled=true);
    $('muteBtn').textContent='🎤';$('muteBtn').classList.remove('active-mute');
    $('deafenBtn').textContent='🔊';$('deafenBtn').classList.remove('active-deafen');
    $('participantsGrid').classList.remove('hidden');
    // 🎤 Mikrofon izni kontrol et — reddedilmişse kullanıcıya kılavuz göster
    const _callMicOk = await _ensureMicPermForCall();
    if(!_callMicOk) return;
    // Çaldırma ekranını göster
    _showRinging(chatId);
    startCallUI(chatId);
    $('callTime').innerText='Hazırlanıyor...';
    if(window._callLock){console.warn('Arama zaten başlatılıyor, atlanıyor.');return;}
    window._callLock=true;
    setTimeout(()=>window._callLock=false, 8000);
    pc=new RTCPeerConnection(rtcCfg);
    try{ls=await getMicStream();ls.getTracks().forEach(t=>pc.addTrack(t,ls));
      _startSpeakDetect(ME.user_id, null, true);
      if(!_speakInterval) _startSpeakLoop();
    }
    catch(e){
      _hideRinging();
      window._callLock=false;
      let errMsg='Mikrofon izni alınamadı.';
      if(e && e.name==='NotAllowedError')  errMsg='Mikrofon erişimi reddedildi. Tarayıcı ayarlarından izin ver.';
      else if(e && e.name==='NotFoundError')  errMsg='Mikrofon bulunamadı. Cihazı bağlı olduğundan emin ol.';
      else if(e && e.name==='NotReadableError') errMsg='Mikrofon başka bir uygulama tarafından kullanılıyor.';
      else if(e && e.message) errMsg=e.message;
      endCall(errMsg);
      return;
    }
    // Trickle ICE: adayları anında gönder
    pc.onicecandidate=(e)=>{
      if(e.candidate) broadcastRTC({type:'rtc_ice',to:chatId,from:ME.user_id,cand:e.candidate});
    };
    pc.ontrack=onTrack;
    pc._isCallerSide=true;
    pc.oniceconnectionstatechange=()=>{handleIceState(pc,chatId);};
    pc.onconnectionstatechange=()=>{handleConnectionState(pc,chatId);};
    // Renegotiation — video açıldığında otomatik tetiklenir
    // _setupDone: initial offer/answer tamamlanana kadar onnegotiationneeded susturulur
    pc._setupDone=false;
    pc.onnegotiationneeded=async()=>{
      if(!pc||pc.signalingState==='closed') return;
      if(!pc._setupDone) return; // ilk setup bitmeden renegotiation yok
      if(!pc.remoteDescription) return;
      try{
        const offer=await pc.createOffer();
        if(!pc||pc.signalingState==='closed') return;
        await pc.setLocalDescription(offer);
        broadcastRTC({type:'rtc_renego',to:chatId,from:ME.user_id,sdp:pc.localDescription});
      }catch(e){}
    };
    const offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
    await pc.setLocalDescription(offer);
    // Offer'ı ICE beklenmeden anında gönder
    broadcastRTC({type:'rtc_offer',to:chatId,from:ME.user_id,sdp:pc.localDescription});
    $('callTime').innerText='Bağlanıyor...';
    window._callLock=false;
  }
};

// ── ÇALDIRMA Ekranı ─────────────────────────────────
function _showRinging(targetUser){
  const ru=$('callRingUI');
  if(!ru) return;
  $('ringName').textContent=targetUser;
  // Avatar
  const db=getDB();
  const udata=db.users?.[targetUser?.toLowerCase()];
  const rav=$('ringAv');
  if(rav){
    if(udata?.avatar){
      rav.innerHTML='';
      const img=document.createElement('img');
      img.src=udata.avatar;img.alt='';
      rav.appendChild(img);
    } else {
      rav.innerHTML='';
      rav.textContent=(udata?.displayName||targetUser||'?').charAt(0).toUpperCase();
    }
  }
  ru.classList.add('show');
}
function _hideRinging(){
  const ru=$('callRingUI');
  if(ru) ru.classList.remove('show');
}
window.cancelOutgoingRing=()=>{
  _hideRinging();
  _stopMicStream(); // 🔒 Mikrofonu kapat
  if(chatId) broadcast({type:'rtc_end',to:chatId,from:ME.user_id});
  endCall('Arama iptal edildi.');
};

const _origEndCall=endCall;
endCall=reason=>{
  if(Object.keys(groupCallPeers).length>0){
    const g=getDB().groups[activeChatId||chatId];
    g&&g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'grp_end',to:m,from:ME.user_id,groupId:activeChatId||chatId});});
    // ── Ses sızıntısı fix: tüm grup peer audio'larını durdur ──────
    Object.values(groupCallPeers).forEach(p=>{
      if(p._audio){try{p._audio.pause();p._audio.srcObject=null;}catch(e){}}
      try{p.pc.close();}catch(e){}
    });
    groupCallPeers={};
  }
  // ── Tek taraflı arama sesini de durdur ─────────────────────────
  if(window._remoteAudio){
    try{window._remoteAudio.pause();window._remoteAudio.srcObject=null;}catch(e){}
    window._remoteAudio=null;
  }
  callParticipants=new Set();
  peerCallStates={};
  window._pendingGrpOffers=[];
  isMuted=false;isDeafened=false;
  const mb=$('muteBtn'),db2=$('deafenBtn');
  if(mb){mb.classList.remove('active-mute');mb.textContent='🎤';}
  if(db2){db2.classList.remove('active-deafen');db2.textContent='🔊';}
  const pg=$('participantsGrid');
  if(pg){
    pg.classList.add('hidden');
    // Kendi kartımızı temizle
    const myc=pg.querySelector('[data-mycard]');
    if(myc) myc.remove();
  }

  // Süreyi oluştur — eğer reason içinde zaten "Süre:" varsa ekleme
  const dur=$('callTime').innerText;
  const durOk=dur&&dur!=='Hazırlanıyor...'&&dur!=='ICE hazırlanıyor...'&&dur!=='Bağlanıyor...'&&dur!=='00:00'&&!dur.startsWith('⚠️')&&!dur.startsWith('❌');
  let msg=reason||'';
  if(durOk&&!msg.includes('Süre:')) msg+=` · Süre: ${dur}`;

  // Mesajı aramanın başladığı sohbete yaz
  const targetId=activeChatId||chatId;
  const targetType=activeChatType||chatType;
  if(targetId&&targetType&&msg){
    const db=getDB();
    const k=targetType==='private'?[ME.user_id,targetId].sort().join('_'):'g_'+targetId;
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push({sys:true,text:msg,time:gt()});
    saveDB(db);
    if(chatId===targetId) renderChat();
  }

  // 🔒 Güvenlik: Mikrofon kapat — arama bitti
  _stopMicStream();
  _stopAudioKeepAlive();
  clearInterval(callIv); callIv=null;
  activeChatId=null; activeChatType=null;
  _hideRinging(); // Çaldırma ekranını kapat
  _hideCallBanner(); // Aktif arama banner'ı kapat
  cleanCall();
  $('callUI').classList.add('hidden');
  try{$('remoteVideo').srcObject=null;}catch(e){}
  screenOwner=null;
  const sb=$('screenBtn');
  if(sb){sb.disabled=false;sb.innerText='Ekran Paylaş';}
  // callBtn'i sıfırla
  const cb=$('callBtn');
  if(cb){ cb.textContent='📞 Sesli Ara'; cb.style.background=''; }
};

// ── SOHBET İÇİ ARAMA BANNER — Aktif grup araması ──────────────────
function updateChatCallBanner(groupId){
  const banner=$('chatCallBanner');
  if(!banner) return;
  if(!groupId){
    banner.classList.add('hidden');
    banner.style.display='none';
    return;
  }
  const call=activeGroupCalls[groupId];
  if(!call||!call.members||call.members.length===0){
    banner.classList.add('hidden');
    banner.style.display='none';
    return;
  }
  // Kendi kendine arama yapıyorsa (callUI açıksa) banner gösterme — callBtn'den "Aramaya Dön" ile gidilir
  const myCallOngoing=!$('callUI').classList.contains('hidden')&&(activeChatId===groupId||chatId===groupId);
  if(myCallOngoing){
    banner.classList.add('hidden');
    banner.style.display='none';
    return;
  }
  // Katılımcıları göster
  const parts=$('chatCallParticipants');
  if(parts){
    const me=ME?ME.user_id:'';
    const others=call.members.filter(m=>m!==me);
    const total=call.members.length;
    parts.textContent=others.slice(0,3).join(', ')+(others.length>3?` +${others.length-3} kişi`:'')+` · ${total} kişi aktif`;
  }
  banner.classList.remove('hidden');
  banner.style.display='flex';
}

window.openGroupDetail=(gid)=>{
  const db=getDB();const g=db.groups[gid];if(!g)return;
  // Eski format uyumluluğu
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  const isAdmin=g.admins.includes(ME.user_id);

  const gdpAv=$('gdpAv');
  // 🛡️ [HIGH-06] Grup detay avatarı — setAvatarEl ile güvenli render
  if(g.avatar){ setAvatarEl(gdpAv, g.avatar, 'G'); }
  else{ gdpAv.innerText='G'; }
  gdpAv.onclick=isAdmin?()=>$('groupAvatarInput').click():null;
  gdpAv.title=isAdmin?'Fotoğraf değiştir':'';
  gdpAv.style.cursor=isAdmin?'pointer':'default';

  $('gdpName').innerText=g.name;
  const adminLabel=g.admins.length
    ? (g.admins.includes(ME.user_id)?'Yöneticisin':'Yöneticiler: '+g.admins.join(', '))
    : '';
  $('gdpSub').innerText=`${g.members.length} üye · ${adminLabel}`;
  $('gdpRenameInput').value=g.name;

  isAdmin?$('gdpAdminActions').classList.remove('hidden'):$('gdpAdminActions').classList.add('hidden');

  const myFriends=db.users[ME.user_id.toLowerCase()]?.friends||[];
  const notInGroup=myFriends.filter(f=>!g.members.includes(f));
  const addMemberHTML=isAdmin&&notInGroup.length?`
    <div class="gdp-section">Üye Ekle</div>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <select id="gdpAddSelect" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--panel);color:var(--text)">
        ${notInGroup.map(f=>`<option value="${f}">${f}</option>`).join('')}
      </select>
      <button data-act="addMemberToGroup" style="padding:8px 14px;font-size:13px">Ekle</button>
    </div>`:'';

  $('gdpMembers').innerHTML=(isAdmin&&notInGroup.length?addMemberHTML:'')+
    `<div class="gdp-section">Üyeler</div>`+
    g.members.map(m=>{
    const on=isOn(m);
    const rawAv=m===ME.user_id?ME.avatar:avatars[m];
    // 🛡️ [HIGH-06] Grup üyesi avatarı dogrulaması
    const safeRawAvMem=sanitizeAvatarUrl(rawAv);
    const avHTML=safeRawAvMem?`<img src="${safeRawAvMem}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:(escHtml(m.charAt(0).toUpperCase()));
    const avZoomAttr=safeRawAvMem?`data-act="openAvatarZoom" data-a="${escHtml(safeRawAvMem)}" data-a2="${escHtml(m)}" style="cursor:zoom-in"`:`style="cursor:default"`;
    const isMAdmin=g.admins.includes(m);
    const badge=isMAdmin?'<span style="font-size:10px;background:var(--ok);color:#fff;padding:1px 6px;border-radius:8px;margin-left:6px">Yönetici</span>':'';
    const selfBadge=m===ME.user_id?'<span style="font-size:10px;background:var(--primary);color:#fff;padding:1px 6px;border-radius:8px;margin-left:4px">Sen</span>':'';
    const kickBtn=isAdmin&&m!==ME.user_id
      ?`<button data-act="kickMember" data-a="${escHtml(m)}" class="btn-d" style="padding:3px 8px;font-size:11px;border-radius:6px;margin-left:4px">Çıkar</button>`:'';
    const promoteBtn=isAdmin&&m!==ME.user_id&&!isMAdmin
      ?`<button data-act="promoteAdmin" data-a="${escHtml(m)}" style="padding:3px 8px;font-size:11px;border-radius:6px;background:#8b5cf6;color:#fff;border:none;cursor:pointer;margin-left:4px">⭐ Yönetici Yap</button>`:'';
    const demoteBtn=isAdmin&&m!==ME.user_id&&isMAdmin
      ?`<button data-act="demoteAdmin" data-a="${escHtml(m)}" style="padding:3px 8px;font-size:11px;border-radius:6px;background:#f59e0b;color:#fff;border:none;cursor:pointer;margin-left:4px">Yetkiyi Al</button>`:'';
    return `<div class="gdp-member">
      <div ${avZoomAttr} style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden;position:relative;flex-shrink:0">
        ${avHTML}<span class="sdot status-dot" style="position:absolute;bottom:0;right:0;width:10px;height:10px;border:2px solid var(--panel);background:${on?(({available:'#10b981',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b'})[peerStatuses[m]||'available']||'#10b981'):'#6b7280'}"></span>
      </div>
      <div style="flex:1">
        <span style="font-size:13px;font-weight:600">${m}</span>${badge}${selfBadge}
        <div style="font-size:11px;color:var(--muted)">${on?'Çevrimiçi':'Çevrimdışı'}</div>
      </div>
      <div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:flex-end">${promoteBtn}${demoteBtn}${kickBtn}</div>
    </div>`;
  }).join('');

  window._currentDetailGid=gid;
  $('groupDetailPanel').classList.add('open');
};

// ── GÖRÜNTÜLÜ ARAMA — ses + video birlikte başlat ─────────────────
window.startVideoCall=async()=>{
  if(!ME||chatType!=='private') return;
  const callUIHidden=$('callUI').classList.contains('hidden');
  if(!callUIHidden){ $('callUI').classList.remove('hidden'); return; }
  const callOngoing=callIv!==null||pc;
  if(callOngoing){ $('callUI').classList.remove('hidden'); return; }

  cleanCall();isMuted=false;isDeafened=false;
  $('muteBtn').textContent='🎤';$('muteBtn').classList.remove('active-mute');
  $('deafenBtn').textContent='🔊';$('deafenBtn').classList.remove('active-deafen');
  $('participantsGrid').classList.remove('hidden');
  _showRinging(chatId);
  startCallUI(chatId);
  $('callTime').innerText='Hazırlanıyor...';
  if(window._callLock){return;}
  window._callLock=true;
  setTimeout(()=>window._callLock=false,8000);

  pc=new RTCPeerConnection(rtcCfg);

  // 1. Mikrofon al
  try{
    ls=await getMicStream();
    ls.getTracks().forEach(t=>pc.addTrack(t,ls));
    _startSpeakDetect(ME.user_id,null,true);
    if(!_speakInterval) _startSpeakLoop();
  }catch(e){
    _hideRinging();window._callLock=false;
    let errMsg='Mikrofon izni alınamadı.';
    if(e&&e.name==='NotAllowedError') errMsg='Mikrofon erişimi reddedildi. Tarayıcı ayarlarından izin ver.';
    else if(e&&e.name==='NotFoundError') errMsg='Mikrofon bulunamadı.';
    else if(e&&e.name==='NotReadableError') errMsg='Mikrofon başka bir uygulama tarafından kullanılıyor.';
    else if(e&&e.message) errMsg=e.message;
    endCall(errMsg);return;
  }

  // 2. Kamera al
  try{
    _localVideoStream=await navigator.mediaDevices.getUserMedia({
      video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},
      audio:false
    });
    _videoEnabled=true;
    const vBtn=$('videoBtn');
    if(vBtn){vBtn.textContent='🎥';vBtn.style.background='rgba(34,197,94,.35)';}
    // Yerel video kutusunu oluştur
    let localVid=document.getElementById('localVideo');
    if(!localVid){
      localVid=document.createElement('video');
      localVid.id='localVideo';localVid.autoplay=true;localVid.muted=true;localVid.playsInline=true;
      localVid.style.cssText='width:120px;height:90px;border-radius:8px;object-fit:cover;position:absolute;bottom:8px;right:8px;z-index:5;border:2px solid var(--primary)';
      $('callUI').appendChild(localVid);
    }
    localVid.srcObject=_localVideoStream;
    // Video track'i peer'a ekle
    const videoTrack=_localVideoStream.getVideoTracks()[0];
    try{pc.addTrack(videoTrack,_localVideoStream);}catch(e){}
  }catch(e){
    // Kamera açılamazsa sesli aramaya devam et
    showToast('Kamera','Kamera açılamadı, yalnızca sesli devam ediliyor.');
  }

  // 3. Offer oluştur
  pc.onicecandidate=(e)=>{
    if(e.candidate) broadcastRTC({type:'rtc_ice',to:chatId,from:ME.user_id,cand:e.candidate});
  };
  pc.ontrack=onTrack;
  pc.oniceconnectionstatechange=()=>{handleIceState(pc,chatId);};
  pc._setupDone=false;
  pc.onnegotiationneeded=async()=>{
    if(!pc||pc.signalingState==='closed') return;
    if(!pc._setupDone) return;
    if(!pc.remoteDescription) return;
    try{
      const offer=await pc.createOffer();
      if(!pc||pc.signalingState==='closed') return;
      await pc.setLocalDescription(offer);
      broadcastRTC({type:'rtc_renego',to:chatId,from:ME.user_id,sdp:pc.localDescription});
    }catch(e){}
  };
  try{
    const offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
    await pc.setLocalDescription(offer);
    broadcastRTC({type:'rtc_offer',to:chatId,from:ME.user_id,sdp:pc.localDescription,hasVideo:true});
    $('callTime').innerText='Bağlanıyor...';
  }catch(e){ endCall('Bağlantı kurulamadı.'); }
  window._callLock=false;
};

window.closeGroupDetail=()=>$('groupDetailPanel').classList.remove('open');

window.leaveGroup=()=>{
  const gid=window._currentDetailGid;
  const db=getDB();const g=db.groups[gid];
  if(!g)return;
  if(!confirm(`"${g.name}" grubundan ayrılmak istiyor musun?`))return;

  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  const wasAdmin=g.admins.includes(ME.user_id);
  // Üye listesinden çıkar
  g.members=g.members.filter(m=>m!==ME.user_id);

  if(g.members.length===0){
    // Son kişiydi, grubu sil
    delete db.groups[gid];
    delete db.messages['g_'+gid];
    saveDB(db);
  } else {
    // Yönetici ayrılıyorsa rastgele birine yöneticilik geç
    if(wasAdmin){
      g.admins=g.admins.filter(a=>a!==ME.user_id);
      if(g.admins.length===0){
        // Başka admin yoksa rastgele birine ver
        const newAdmin=g.members[Math.floor(Math.random()*g.members.length)];
        g.admins=[newAdmin];
        g.members.forEach(m=>{
          broadcast({type:'group_update',to:m,from:ME.user_id,groupId:gid,members:g.members,admins:g.admins});
        });
        showToast('Yöneticilik Devredildi',`${newAdmin} yeni yönetici oldu.`);
      } else {
        g.members.forEach(m=>{
          broadcast({type:'group_update',to:m,from:ME.user_id,groupId:gid,members:g.members,admins:g.admins});
        });
      }
    } else {
      // Normal üye ayrıldı
      g.members.forEach(m=>{
        broadcast({type:'group_update',to:m,from:ME.user_id,groupId:gid,members:g.members});
      });
    }
    saveDB(db);
  }

  // Kendi DB'sinden grubu sil
  const myDb=getDB();
  delete myDb.groups[gid];
  saveDB(myDb);

  if(chatId===gid){chatId=null;chatType=null;$('emptyState').classList.remove('hidden');}
  closeGroupDetail();
  updateUI();
  showToast('Gruptan Ayrıldın',`"${g.name}" grubundan ayrıldınız.`);
};

window.promoteAdmin=m=>{
  const gid=window._currentDetailGid;
  const db=getDB();const g=db.groups[gid];
  if(!g)return;
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  if(!g.admins.includes(ME.user_id))return;
  if(g.admins.includes(m))return;
  g.admins.push(m);
  saveDB(db);
  g.members.forEach(u=>{if(u!==ME.user_id)broadcast({type:'group_update',to:u,from:ME.user_id,groupId:gid,admins:g.admins});});
  openGroupDetail(gid);
  showToast('Yönetici Yapıldı',`${m} artık yönetici.`);
};

window.demoteAdmin=m=>{
  const gid=window._currentDetailGid;
  const db=getDB();const g=db.groups[gid];
  if(!g)return;
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  if(!g.admins.includes(ME.user_id))return;
  g.admins=g.admins.filter(a=>a!==m);
  if(g.admins.length===0)g.admins=[ME.user_id]; // en az 1 admin kalmalı
  saveDB(db);
  g.members.forEach(u=>{if(u!==ME.user_id)broadcast({type:'group_update',to:u,from:ME.user_id,groupId:gid,admins:g.admins});});
  openGroupDetail(gid);
  showToast('Yetki Alındı',`${m} artık yönetici değil.`);
};

window.kickMember=m=>{
  const gid=window._currentDetailGid;
  const db=getDB();const g=db.groups[gid];
  if(!g)return;
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  if(!g.admins.includes(ME.user_id)||m===ME.user_id)return;
  if(!confirm(`${m} kişisini gruptan çıkarmak istiyor musun?`))return;
  g.members=g.members.filter(x=>x!==m);
  g.admins=g.admins.filter(a=>a!==m);
  saveDB(db);
  broadcast({type:'group_kick',to:m,from:ME.user_id,groupId:gid,groupName:g.name});
  g.members.forEach(u=>{if(u!==ME.user_id)broadcast({type:'group_update',to:u,from:ME.user_id,groupId:gid,members:g.members,admins:g.admins});});
  updateUI();openGroupDetail(gid);
  showToast('Üye Çıkarıldı',`${m} gruptan çıkarıldı.`);
};

window.addMemberToGroup=()=>{
  const gid=window._currentDetailGid;
  const sel=$('gdpAddSelect');if(!sel)return;
  const newMember=sel.value;if(!newMember)return;
  const db=getDB();const g=db.groups[gid];
  if(!g)return;
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  if(!g.admins.includes(ME.user_id))return;
  if(g.members.includes(newMember))return;
  g.members.push(newMember);
  saveDB(db);
  broadcast({type:'group_invite',to:newMember,from:ME.user_id,group:g});
  g.members.forEach(u=>{if(u!==ME.user_id&&u!==newMember)broadcast({type:'group_update',to:u,from:ME.user_id,groupId:gid,members:g.members});});
  updateUI();openGroupDetail(gid);
  showToast('Üye Eklendi',`${newMember} gruba eklendi.`);
};

window.renameGroup=()=>{
  const newName=$('gdpRenameInput').value.trim();
  if(!newName)return;
  const db=getDB();const gid=window._currentDetailGid;
  if(!db.groups[gid])return;
  const g=db.groups[gid];
  if(!g.admins)g.admins=g.admin?[g.admin]:[];
  if(!g.admins.includes(ME.user_id))return;
  const oldName=g.name;
  g.name=newName;saveDB(db);
  // Üyelere bildir
  g.members.forEach(m=>{
    if(m!==ME.user_id) broadcast({type:'group_update',to:m,from:ME.user_id,groupId:gid,name:newName});
  });
  // Gruba sistem mesajı yaz
  const k='g_'+gid;
  if(!db.messages[k])db.messages[k]=[];
  // 🛡️ [HIGH-05] Sistem mesajı — escape ediliyor (localStorage'dan gelen değer)
  db.messages[k].push({sys:true,text:`✏️ ${escHtml(ME.user_id)} grup adını "${escHtml(oldName)}" → "${escHtml(newName)}" olarak değiştirdi.`,time:gt()});
  saveDB(db);
  updateUI();
  if(chatId===gid){$('chatName').innerText=newName;renderChat();}
  $('gdpName').innerText=newName;
  showToast('Grup Adı Güncellendi',newName);
};

$('groupAvatarInput').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const gid=window._currentDetailGid;
  const db=getDB();
  if(!db.groups[gid])return;
  if(!db.groups[gid].admins)db.groups[gid].admins=db.groups[gid].admin?[db.groups[gid].admin]:[];
  if(!db.groups[gid].admins.includes(ME.user_id))return;
  const img2=new Image();const url2=URL.createObjectURL(f);
  img2.onload=()=>{
    const MAX=200;let w=img2.width,h=img2.height;
    if(w>MAX||h>MAX){const sc=Math.min(MAX/w,MAX/h);w=Math.round(w*sc);h=Math.round(h*sc);}
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    cv.getContext('2d').drawImage(img2,0,0,w,h);
    const b64=cv.toDataURL('image/jpeg',0.7);
    URL.revokeObjectURL(url2);
    db.groups[gid].avatar=b64;saveDB(db);
    const g=db.groups[gid];
    g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_update',to:m,from:ME.user_id,groupId:gid,avatar:b64});});
    updateUI();
    if(chatId===gid){ setAvatarEl($('chatAv'), b64, 'G'); }
    openGroupDetail(gid);
    showToast('Grup Fotoğrafı Güncellendi','');
  };
  img2.src=url2;
};

$('avatarInput').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const img=new Image();
  const url=URL.createObjectURL(f);
  img.onload=()=>{
    const MAX=300;
    let w=img.width,h=img.height;
    if(w>MAX||h>MAX){const sc=Math.min(MAX/w,MAX/h);w=Math.round(w*sc);h=Math.round(h*sc);}
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    const b64=c.toDataURL('image/jpeg',0.75);
    URL.revokeObjectURL(url);
    const db=getDB();
    db.users[ME.user_id.toLowerCase()].avatar=b64;ME.avatar=b64;saveDB(db);
    updateUI();
    broadcast({type:'presence',from:ME.user_id,avatar:b64});
    showToast('Fotoğraf Güncellendi','Arkadaşların kısa süre içinde görecek.');
  };
  img.src=url;
};

// ── AYARLAR ───────────────────────────────────────────────────────
window.toggleSettings=()=>{
  $('settingsPanel').classList.toggle('open');
  if(typeof _updateMobilBildirimUI==='function') _updateMobilBildirimUI();
};
window.copyToken=()=>{
  navigator.clipboard.writeText(ME.token).then(()=>showToast('Kopyalandı',ME.token));
};
window.doLogout=()=>{
  // Tüm WebRTC DataChannel bağlantılarını kapat
  Object.keys(_dcPeers).forEach(uid_ => _dcClose(uid_));
  document.body.classList.remove('sv-logged-in');
  sessionClear();
  location.reload();
};

// ── HESAP KALICI SİL (giriş yapılmışken) ──────────────────────────
window.deleteCurrentAccount=()=>{
  if(!ME) return;
  toggleSettings();
  const key=ME.user_id.toLowerCase();
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.9);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';
  overlay.innerHTML=`
    <div style="background:var(--panel);border-radius:20px;padding:32px;max-width:400px;width:92%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid var(--border);animation:modalIn .25s cubic-bezier(.34,1.56,.64,1) both">
      <div style="font-size:52px;margin-bottom:16px">🗑️</div>
      <h3 style="margin:0 0 8px;color:var(--text);font-size:20px;font-weight:700">Hesabı Kalıcı Sil</h3>
      <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 12px">
        <strong style="color:var(--danger)">${ME.user_id}</strong> hesabını kalıcı olarak silmek istediğinden emin misin?
      </p>
      <div style="background:rgba(237,66,69,.08);border:1px solid rgba(237,66,69,.25);border-radius:12px;padding:12px 16px;margin-bottom:24px;text-align:left">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:var(--danger)">⚠️ Bu işlem geri alınamaz!</p>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.8">
          <li>Tüm mesajlar silinir</li>
          <li>Tüm arkadaş listesi silinir</li>
          <li>Hesap bilgileri kalıcı olarak kaldırılır</li>
        </ul>
      </div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 16px">Onaylamak için <strong style="color:var(--text)">"${ME.user_id}"</strong> yazın:</p>
      <input id="_deleteConfirmInput" placeholder="Kullanıcı adını girin..." style="width:100%;padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:16px;border:2px solid var(--border);background:var(--input-bg);color:var(--text);outline:none;box-sizing:border-box">
      <div style="display:flex;gap:10px">
        <button id="_delCancelBtn2" style="flex:1;padding:13px;border-radius:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);font-weight:600;font-size:14px;cursor:pointer">Vazgeç</button>
        <button id="_deleteExecBtn" disabled style="flex:1;padding:13px;border-radius:12px;background:var(--danger);color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;opacity:.5;transition:.2s">Hesabı Sil</button>
      </div>
    </div>`;
  overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove();};
  document.body.appendChild(overlay);
  // ── CSP-safe: inline onclick/oninput yerine JS event listener ─────
  overlay.querySelector('#_delCancelBtn2').onclick=()=>overlay.remove();
  overlay.querySelector('#_deleteConfirmInput').oninput=function(){
    const btn=overlay.querySelector('#_deleteExecBtn');
    const match=this.value.toLowerCase()===key;
    btn.disabled=!match;
    btn.style.opacity=match?'1':'.5';
  };
  overlay.querySelector('#_deleteExecBtn').onclick=()=>execDeleteCurrentAccount(key,overlay);
  setTimeout(()=>overlay.querySelector('#_deleteConfirmInput').focus(),120);
};

window.execDeleteCurrentAccount=(key,overlay)=>{
  const db=getDB();
  // Çevrimdışı bildir
  if(ME) broadcast({type:'presence',from:ME.user_id,avatar:null,v:APP_VERSION,status:'offline'}).catch(()=>{});
  // Veritabanından sil
  delete db.users[key];
  Object.keys(db.messages||{}).forEach(k2=>{
    if(k2===key||k2.startsWith(key+'_')||k2.endsWith('_'+key)) delete db.messages[k2];
  });
  saveDB(db);
  // Şifreyi sil
  try{localStorage.removeItem('sv_pw_'+key);}catch(e){}
  // Hesap listesinden çıkar
  try{
    const list=getAccounts().filter(a=>a!==key);
    localStorage.setItem(ACC_KEY,JSON.stringify(list));
  }catch(e){}
  // Oturumu kapat
  sessionClear();
  overlay&&overlay.remove();
  // Kısa gecikmeyle yenile
  setTimeout(()=>location.reload(),300);
};

// ── ŞİFRE DEĞİŞTİR ───────────────────────────────────────────────
window.changePassword=async()=>{
  if(!ME) return;
  const k=ME.user_id.toLowerCase();
  // Mevcut şifre varsa önce doğrula
  if(pwExists(k)){
    const old=prompt('Mevcut şifreniz:');
    if(old===null) return;
    const ok=await pwVerify(k, old);
    if(!ok){ showToast('Hata','❌ Mevcut şifre yanlış!'); return; }
  }
  const np=prompt('Yeni şifre (en az 6 karakter):');
  if(!np||np.length<6){ showToast('Hata','Şifre en az 6 karakter olmalı.'); return; }
  const np2=prompt('Yeni şifreyi tekrar girin:');
  if(np!==np2){ showToast('Hata','Şifreler eşleşmiyor!'); return; }
  await pwSave(k, np);
  showToast('Şifre Değiştirildi','✅ Yeni şifreniz kaydedildi.');
  toggleSettings();
};
// ── KULLANICI DURUMU ──────────────────────────────────────────────
let myStatus='available';
const STATUS_LABELS={available:'🟢 Müsait',busy:'🔴 Meşgul',dnd:'🟣 Rahatsız Etme',away:'🟡 Uzakta'};
const STATUS_COLORS={available:'#10b981',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b'};
let peerStatuses={};
let peerCustomStatuses={};

window.changeStatus=s=>{
  myStatus=s;
  // Kendi avatarındaki noktayı güncelle
  const dot=$('myStatusDot');
  if(dot) dot.style.background=STATUS_COLORS[s]||'#10b981';
  const navDot=$('dnrOnlineDot');
  if(navDot) navDot.style.background=STATUS_COLORS[s]||'#10b981';
  sendPresence();
};

// ── ÖZEL DURUM (Custom Status) ────────────────────────────────────
let myCustomStatus = { emoji:'', text:'' };

// Tüm emoji kategorileri
const CS_EMOJI_CATS = [
  { label:'😊', name:'Yüzler', emojis:['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  { label:'👋', name:'Eller', emojis:['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁','👅','👄','💋'] },
  { label:'🐶', name:'Hayvanlar', emojis:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿','🦔'] },
  { label:'🍕', name:'Yiyecek', emojis:['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🫖','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'] },
  { label:'⚽', name:'Spor', emojis:['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥊','🥋','⛳','🏹','🎣','🤿','🥌','🛷','🎿','⛸','🛼','🎯','🎽','🛹','🛼','🏋️','🤼','🤸','⛹️','🤺','🏇','🧘','🏄','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖','🎗','🏵','🎫','🎟'] },
  { label:'🎵', name:'Müzik', emojis:['🎵','🎶','🎼','🎤','🎧','🎷','🎺','🎸','🪕','🎻','🥁','🪘','🎹','🎙','📻','🎚','🎛'] },
  { label:'💼', name:'İş', emojis:['💼','📁','📂','🗂','📋','📊','📈','📉','📝','📌','📍','📎','🖇','📐','📏','✂️','🗃','🗄','🗑','🔒','🔓','🔑','🗝','🔨','⛏','🔧','🔩','⚙️','🖥','💻','🖨','⌨️','🖱','📱','☎️','📞','📟','📠','📺','📷','📸','📹','🎥','📡','🔭','🔬'] },
  { label:'❤️', name:'Semboller', emojis:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉','☦️','🛐','⭐','🌟','💫','✨','⚡','🔥','💥','❄️','🌈','☀️','🌤','⛅','🌧','⛈','🌩','🌪','🌫','🌊','💧','🌙','🌝','🌚','🌞','🌻','🌺','🌸','🌼','🌷','🌱','🌿','🍀','🍃','🍂','🍁'] },
  { label:'🚗', name:'Seyahat', emojis:['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍','🛵','🚲','🛴','🛹','🛼','🚨','🚔','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩','💺','🚁','🛸','🚀','⛵','🚤','🛥','🛳','⛴','🚢','⚓','🪝','⛽','🗺','🧭','🗿','🗼','🗽','⛩','🕌','🕍','⛪','🕋','⛲','⛺','🏕','🌋','🏔','🏗','🏘','🏙','🏚','🏛','🏟','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰'] },
];

let _csSelectedEmoji = '';
let _csActiveCat = 0;

function toggleCsEmojiPicker(){
  const p=$('csEmojiPicker');
  if(!p) return;
  const isOpen=p.classList.contains('open');
  // Diğer pickerleri kapat
  document.querySelectorAll('.open').forEach(el=>{if(el.id==='csEmojiPicker')el.classList.remove('open');});
  if(!isOpen){
    p.classList.add('open');
    // Position fixed — totem veya sidebar'ın üstüne taşmasın
    const btn=$('csEmojiToggleBtn');
    if(btn){
      const r=btn.getBoundingClientRect();
      p.style.position='fixed';
      p.style.top=(r.bottom+6)+'px';
      p.style.left=r.left+'px';
      p.style.right='auto';
      // Sağ kenardan taşmasın
      const pw=280;
      if(r.left+pw>window.innerWidth) p.style.left=(window.innerWidth-pw-8)+'px';
    }
    _renderCsEmojiCats();
    _renderCsEmojis(0, '');
    // Dışarı tıkla kapat
    setTimeout(()=>{
      document.addEventListener('click', _closeCsPickerOutside, {once:true});
    }, 50);
  }
}
function _closeCsPickerOutside(e){
  const p=$('csEmojiPicker');
  if(p&&!p.contains(e.target)&&e.target.id!=='csEmojiToggleBtn'){
    p.classList.remove('open');
  }
}
function _renderCsEmojiCats(){
  const cats=$('csEmojiCats');
  if(!cats) return;
  cats.innerHTML=CS_EMOJI_CATS.map((c,i)=>`
    <span class="cs-emoji-cat${i===_csActiveCat?' active':''}" data-act="csSelectCat" data-a="${i}" title="${c.name}">${c.label}</span>
  `).join('');
}
window.csSelectCat=function(i){
  _csActiveCat=i;
  _renderCsEmojiCats();
  _renderCsEmojis(i, $('csEmojiSearch')?.value||'');
};
function _renderCsEmojis(catIdx, search){
  const grid=$('csEmojiGrid');
  if(!grid) return;
  let emojis=search
    ? CS_EMOJI_CATS.flatMap(c=>c.emojis).filter(e=>e.includes(search))
    : CS_EMOJI_CATS[catIdx]?.emojis||[];
  grid.innerHTML=emojis.map(e=>`<button class="cs-emoji-btn" data-act="csPickEmoji" data-a="${escHtml(e)}" title="${e}">${e}</button>`).join('');
}
window.csEmojiSearch=function(q){
  _renderCsEmojis(_csActiveCat, q);
};
window.csPickEmoji=function(e){
  _csSelectedEmoji=e;
  const btn=$('csEmojiToggleBtn');
  if(btn) btn.textContent=e;
  $('csEmojiPicker')?.classList.remove('open');
  $('csStatusText')?.focus();
};
window.csPreview=function(){
  // anlık önizleme — kaydetmeden göster
};
window.saveCustomStatus=function(){
  const text=($('csStatusText')?.value||'').trim();
  const emoji=_csSelectedEmoji||'';
  myCustomStatus={emoji,text};
  // LocalStorage'a kaydet
  try{ localStorage.setItem('sv_custom_status', JSON.stringify(myCustomStatus)); }catch(e){}
  sendPresence();
  _renderCurrentCustomStatus();
  showToast('Özel Durum','✅ Durum güncellendi!');
};
function _renderCurrentCustomStatus(){
  const el=$('svCurrentCustomStatus');
  if(!el) return;
  const {emoji,text}=myCustomStatus;
  if(!emoji&&!text){ el.innerHTML='<span style="opacity:.4;font-size:11px">Özel durum yok — yukarıdan ekle</span>'; return; }
  el.innerHTML=`${emoji?`<span>${emoji}</span>`:''}${text?`<span style="color:var(--text)">${escHtml(text)}</span>`:''}
    <span style="font-size:10px;opacity:.5;margin-left:4px" data-act="clearCustomStatus" data-stop="1">✕</span>`;
}
window.clearCustomStatus=function(e){
  e&&e.stopPropagation();
  myCustomStatus={emoji:'',text:''};
  _csSelectedEmoji='';
  const btn=$('csEmojiToggleBtn'); if(btn) btn.textContent='😊';
  const inp=$('csStatusText'); if(inp) inp.value='';
  try{ localStorage.removeItem('sv_custom_status'); }catch(e){}
  sendPresence();
  _renderCurrentCustomStatus();
};

// Presence'a customStatus eklendi — orijinal sendPresence zaten güncellendi
// svUpdateProfilePanel custom status desteği orijinal fonksiyona eklendi

// Presence'da gelen customStatus'u arkadaş listesinde göster

// Bildirim & arama engelleme yardımcısı
function isSilentMode(){ return myStatus==='busy'||myStatus==='dnd'||myStatus==='away'; }

// ── DOSYA GÖNDERME ────────────────────────────────────────────────
window.sendFile=async(input)=>{
  const files=[...input.files];
  if(!files.length||!chatId)return;
  input.value='';
  for(const file of files){
    if(file.size>10*1024*1024){showToast('Dosya Çok Büyük','Max 10MB');continue;}
    const reader=new FileReader();
    reader.onload=ev=>{
      const data=ev.target.result; // base64 data URL
      const isGif=file.type==='image/gif';
      const isImg=file.type.startsWith('image/');
      const fileType=isGif?'gif':isImg?'image':'file';
      const msgId=uid();
      // Dosya verisini oturum belleğine kaydet
      _sessionFiles.set(msgId, data);
      // MQTT üzerinden gönder — fileData dahil (alıcı da görsün)
      const msg={id:msgId,from:ME.user_id,text:file.name,time:gt(),fileType,fileName:file.name,fileSize:file.size,fileData:data};
      const db=getDB();
      if(chatType==='private'){
        const k=[ME.user_id,chatId].sort().join('_');
        if(!db.messages[k])db.messages[k]=[];
        // Lokal kayıt: fileData yerine __session__ referansı (localStorage taşması önlenir)
        db.messages[k].push({...msg, fileData:'__session__'+msgId});
        saveDB(db);
        broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg});
      } else {
        const k='g_'+chatId;
        if(!db.messages[k])db.messages[k]=[];
        db.messages[k].push({...msg, fileData:'__session__'+msgId});
        saveDB(db);
        const g=db.groups[chatId];
        g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg});});
      }
      renderChat();
      spawnParticles(window.innerWidth/2,window.innerHeight-100,15,'#10b981');
    };
    reader.readAsDataURL(file);
  }
};

// ── GIF URL GÖNDER ───────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
//  🖱️ SÜRÜKLE & BIRAK DOSYA GÖNDERİMİ
// ══════════════════════════════════════════════════════════════════
(()=>{
  const chatArea=document.getElementById('chatArea');
  if(!chatArea) return;
  let dragCounter=0;

  chatArea.addEventListener('dragenter',e=>{
    e.preventDefault();e.stopPropagation();
    if(!chatId) return;
    dragCounter++;
    chatArea.classList.add('drag-over');
  });

  chatArea.addEventListener('dragleave',e=>{
    e.preventDefault();e.stopPropagation();
    dragCounter--;
    if(dragCounter<=0){dragCounter=0;chatArea.classList.remove('drag-over');}
  });

  chatArea.addEventListener('dragover',e=>{
    e.preventDefault();e.stopPropagation();
    e.dataTransfer.dropEffect='copy';
  });

  chatArea.addEventListener('drop',async e=>{
    e.preventDefault();e.stopPropagation();
    dragCounter=0;
    chatArea.classList.remove('drag-over');
    if(!chatId){showToast('Dosya','Önce bir sohbet seçin.');return;}
    const files=[...e.dataTransfer.files];
    if(!files.length) return;
    // sendFile'a sahte input gibi geçir
    const fakeInput={files};
    await sendFile(fakeInput);
  });
})();
window.openGifModal=()=>{
  const m=$('gifUrlModal');
  m.style.display='flex';
  setTimeout(()=>$('gifUrlInput').focus(),100);
};
window.closeGifModal=()=>{
  $('gifUrlModal').style.display='none';
  $('gifUrlInput').value='';
};
window.submitGifUrl=()=>{
  const url=$('gifUrlInput').value.trim();
  if(!url){showToast('Hata','GIF URL giriniz.');return;}
  if(!url.startsWith('http')){showToast('Hata','Geçerli bir URL girin.');return;}
  closeGifModal();
  sendGif(url);
};
window.sendGif=url=>{
  if(!chatId)return;
  const msgId=uid();
  _sessionFiles.set(msgId, url); // URL'yi de oturum belleğine al
  const msg={id:msgId,from:ME.user_id,text:'GIF',time:gt(),fileType:'gif',fileData:url};
  const db=getDB();
  if(chatType==='private'){
    const k=[ME.user_id,chatId].sort().join('_');
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push({...msg, fileData:'__session__'+msgId});
    saveDB(db);
    broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg});
  } else {
    const k='g_'+chatId;
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push({...msg, fileData:'__session__'+msgId});
    saveDB(db);
    const g=db.groups[chatId];
    g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg});});
  }
  renderChat();
};
// Enter ile gönder
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&$('gifUrlModal').style.display==='flex') submitGifUrl();
  if(e.key==='Escape'&&$('gifUrlModal').style.display==='flex') closeGifModal();
});


// ── MESAJ ARAMA ────────────────────────────────────────────────────
let srResults=[],srIdx=0;
window.toggleMsgSearch=()=>{
  const bar=$('msgSearchBar');const hidden=bar.classList.toggle('hidden');
  if(!hidden){$('msgSearchInp').focus();$('msgSearchInp').value='';srResults=[];$('srCount').textContent='';}
  else document.querySelectorAll('.msg-wrap.search-highlight').forEach(el=>el.classList.remove('search-highlight'));
};
window.searchMessages=()=>{
  const q=$('msgSearchInp').value.trim().toLowerCase();
  document.querySelectorAll('.msg-wrap').forEach(el=>el.classList.remove('search-highlight'));
  if(!q){$('srCount').textContent='';srResults=[];return;}
  srResults=[...document.querySelectorAll('.msg-wrap')].filter(el=>{
    const txt=(el.querySelector('.msg-text')?.textContent||el.querySelector('.file-name')?.textContent||'').toLowerCase();
    return txt.includes(q);
  });
  srIdx=srResults.length-1;
  $('srCount').textContent=`${srResults.length} sonuç`;
  if(srResults.length)highlightSr();
};
window.searchNav=dir=>{if(!srResults.length)return;srIdx=(srIdx+dir+srResults.length)%srResults.length;highlightSr();};
function highlightSr(){
  document.querySelectorAll('.msg-wrap.search-highlight').forEach(el=>el.classList.remove('search-highlight'));
  const el=srResults[srIdx];if(!el)return;
  el.classList.add('search-highlight');el.scrollIntoView({behavior:'smooth',block:'center'});
  $('srCount').textContent=`${srIdx+1}/${srResults.length}`;
}

// ── SÜRÜKLENEBİLİR CALL UI ────────────────────────────────────────
(()=>{
  let dragEl=null,ox=0,oy=0;
  document.addEventListener('mousedown',e=>{
    const cu=e.target.closest('.call-ui');if(!cu||e.target.tagName==='BUTTON'||e.target.tagName==='SELECT'||e.target.tagName==='INPUT')return;
    dragEl=cu;const rect=cu.getBoundingClientRect();ox=e.clientX-rect.left;oy=e.clientY-rect.top;cu.style.transition='none';e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragEl)return;
    let nx=Math.max(0,Math.min(window.innerWidth-dragEl.offsetWidth,e.clientX-ox));
    let ny=Math.max(0,Math.min(window.innerHeight-dragEl.offsetHeight,e.clientY-oy));
    dragEl.style.left=nx+'px';dragEl.style.top=ny+'px';dragEl.style.right='auto';
  });
  document.addEventListener('mouseup',()=>{if(dragEl){dragEl.style.transition='';dragEl=null;}});
  document.addEventListener('touchstart',e=>{
    const cu=e.target.closest('.call-ui');if(!cu||e.target.tagName==='BUTTON')return;
    dragEl=cu;const t=e.touches[0];const rect=cu.getBoundingClientRect();ox=t.clientX-rect.left;oy=t.clientY-rect.top;cu.style.transition='none';
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!dragEl)return;const t=e.touches[0];
    let nx=Math.max(0,Math.min(window.innerWidth-dragEl.offsetWidth,t.clientX-ox));
    let ny=Math.max(0,Math.min(window.innerHeight-dragEl.offsetHeight,t.clientY-oy));
    dragEl.style.left=nx+'px';dragEl.style.top=ny+'px';dragEl.style.right='auto';
  },{passive:true});
  document.addEventListener('touchend',()=>{if(dragEl){dragEl.style.transition='';dragEl=null;}});
})();


// ── BİLDİRİM SESLERİ (Web Audio — dosya gerekmez) ─────────────────
function playSound(type){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const o=ac.createOscillator();const g2=ac.createGain();
    o.connect(g2);g2.connect(ac.destination);
    if(type==='msg'){
      o.type='sine';o.frequency.setValueAtTime(880,ac.currentTime);
      o.frequency.setValueAtTime(1100,ac.currentTime+0.08);
      g2.gain.setValueAtTime(0.25,ac.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.25);
      o.start(ac.currentTime);o.stop(ac.currentTime+0.25);
    }else if(type==='call'){
      o.type='sine';o.frequency.setValueAtTime(440,ac.currentTime);
      g2.gain.setValueAtTime(0.4,ac.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.55);
      o.start(ac.currentTime);o.stop(ac.currentTime+0.55);
    }
  }catch(e){}
}

// ── OKUNDU BİLGİSİ ────────────────────────────────────────────────
function markAsRead(fromUser){
  if(!ME||chatType!=='private')return;
  const db=getDB();
  const k=[ME.user_id,fromUser].sort().join('_');
  const msgs=db.messages[k]||[];
  // Sadece fiilen elimizde olan (alınmış) son mesajın id'sini gönder —
  // karşı taraf henüz teslim edilmemiş mesajları "okundu" saymasın.
  let lastMsgId=null;
  for(let i=msgs.length-1;i>=0;i--){
    if(msgs[i].from===fromUser){lastMsgId=msgs[i].id;break;}
  }
  broadcast({type:'msg_read',to:fromUser,from:ME.user_id,lastMsgId});
}

function broadcastGroupRead(groupId, lastMsgId, toUser){
  // Grubun admin/üyelerine okundu bildir (sadece gönderene)
  broadcast({type:'group_read',to:toUser,from:ME.user_id,groupId,msgId:lastMsgId});
}

function markGroupAllRead(groupId){
  if(!ME)return;
  const db=getDB();
  const g=db.groups[groupId];if(!g)return;
  const k='g_'+groupId;
  if(!db.messages[k])return;
  // Tüm mesajları oku ve göndericilere bildir
  const senders=new Set();
  db.messages[k].forEach(m=>{
    if(m.from!==ME.user_id&&m.id){
      if(!m.readBy)m.readBy=[];
      if(!m.readBy.includes(ME.user_id)){m.readBy.push(ME.user_id);senders.add(m.from);}
    }
  });
  if(senders.size){
    saveDB(db);
    senders.forEach(s=>broadcast({type:'group_read',to:s,from:ME.user_id,groupId,msgId:'all'}));
  }
}

// ── REPLY ────────────────────────────────────────────────────────
window._replyTo=null;
window.startReply=(msgId)=>{
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msg=(db.messages[k]||[]).find(m=>m.id===msgId);
  if(!msg)return;
  window._replyTo={id:msg.id,from:msg.from,text:msg.text};
  $('replyBarTxt').textContent=`${msg.from}: ${msg.text.substring(0,60)}`;
  $('replyBar').classList.remove('hidden');
  $('msgInput').focus();
};
window.cancelReply=()=>{
  window._replyTo=null;
  $('replyBar').classList.add('hidden');
  $('replyBarTxt').textContent='';
};

// ── MESAJ SAĞ TIK MENÜSÜ ─────────────────────────────────────────
window.showMsgCtx=(e,msgId,fromUser)=>{
  e.preventDefault();
  const existing=document.getElementById('msgCtxMenu');
  if(existing)existing.remove();

  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msg=(db.messages[k]||[]).find(m=>m.id===msgId);
  if(!msg||msg.deleted)return;

  const isMe=msg.from===ME.user_id;
  const m=document.createElement('div');
  m.id='msgCtxMenu';
  m.className='ctx';
  m.style.cssText='position:fixed;z-index:9999';

  // Kim gördü bölümü (grup için)
  let seenSection='';
  if(chatType==='group'&&isMe){
    const db2=getDB();
    const g=db2.groups[chatId];
    const readers=(msg.readBy||[]).filter(u=>u!==ME.user_id);
    const notRead=g.members.filter(u=>u!==ME.user_id&&!readers.includes(u));
    seenSection=`
      <div style="padding:8px 16px 4px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">
        👁️ Görüldü (${readers.length}/${g.members.length-1})
      </div>
      ${readers.length?readers.map(u=>`<div class="cxi" style="cursor:default;font-size:12px">✅ ${u}</div>`).join(''):'<div style="padding:4px 16px;font-size:12px;color:var(--muted)">Henüz kimse görmedi</div>'}
      ${notRead.length?`<div style="padding:2px 16px 4px;font-size:11px;color:var(--muted)">⏳ ${notRead.join(', ')}</div>`:''}
      <div style="height:1px;background:var(--border);margin:4px 0"></div>`;
  }

  m.innerHTML=`
    ${seenSection}
    <div class="cxi" data-act="_uiMsgCtxReply" data-a="${escHtml(msgId)}">↩ Yanıtla</div>
    <div class="cxi" data-act="_uiMsgCtxReact" data-a="${escHtml(msgId)}" data-self="2">😊 Reaksiyon Ekle</div>
    ${isMe?`<div class="cxi" data-act="_uiMsgCtxEdit" data-a="${escHtml(msgId)}">✏️ Düzenle</div>`:''}
    ${isMe?`<div class="cxi d" data-act="_uiMsgCtxDelete" data-a="${escHtml(msgId)}">🗑️ Sil</div>`:''}
  `;

  let x=e.clientX, y=e.clientY;
  if(x+200>window.innerWidth) x=window.innerWidth-210;
  if(y+220>window.innerHeight) y=window.innerHeight-230;
  m.style.left=x+'px'; m.style.top=y+'px';
  document.body.appendChild(m);
  setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),10);
};

// ── DÜZENLE ──────────────────────────────────────────────────────
window.editMsg=(msgId)=>{
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msg=(db.messages[k]||[]).find(m=>m.id===msgId);
  if(!msg||msg.from!==ME.user_id)return;
  const newText=prompt('Mesajı düzenle:',msg.text);
  if(!newText||newText.trim()===msg.text)return;
  msg.text=newText.trim();msg.edited=true;
  saveDB(db);renderChat();
  const payload={type:'msg_edit',from:ME.user_id,msgId,newText:newText.trim()};
  if(chatType==='private')broadcast({...payload,to:chatId});
  else{const g=db.groups[chatId];g.members.forEach(m=>{if(m!==ME.user_id)broadcast({...payload,to:m,groupId:chatId});});}
};

// ── SİL ──────────────────────────────────────────────────────────
window.deleteMsg=(msgId)=>{
  if(!confirm('Bu mesajı herkesten silmek istiyor musun?'))return;
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msg=(db.messages[k]||[]).find(m=>m.id===msgId);
  if(!msg||msg.from!==ME.user_id)return;
  msg.deleted=true;msg.text='';msg.file=null;msg.img=null;
  saveDB(db);renderChat();
  const payload={type:'msg_delete',from:ME.user_id,msgId};
  if(chatType==='private'){
    broadcast({...payload,to:chatId,peer:ME.user_id});
  } else {
    const g=db.groups[chatId];
    g&&g.members.forEach(m=>{if(m!==ME.user_id)broadcast({...payload,to:m,groupId:chatId});});
  }
};

// ── REAKSİYON ────────────────────────────────────────────────────
window.openReactPicker=(msgId,btn)=>{
  const emojis=['👍','❤️','😂','😮','😢','🔥','👏','🎉','😍','🤣'];
  const existing=document.getElementById('inlineReactPicker');
  if(existing)existing.remove();
  const p=document.createElement('div');
  p.id='inlineReactPicker';
  p.style.cssText='position:fixed;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:6px;display:flex;gap:2px;z-index:9000;box-shadow:0 4px 20px rgba(0,0,0,.2)';
  const r=btn.getBoundingClientRect();
  p.style.top=(r.top-52)+'px';
  p.style.left=Math.min(r.left-20,window.innerWidth-230)+'px';
  p.innerHTML=emojis.map(e=>`<button class="react-pick-btn" data-act="_uiPickReact" data-a="${msgId}" data-a2="${e}">${e}</button>`).join('');
  document.body.appendChild(p);
  setTimeout(()=>document.addEventListener('click',()=>p.remove(),{once:true}),50);
};

window.toggleReaction=(msgId,emoji)=>{
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const msg=(db.messages[k]||[]).find(m=>m.id===msgId);
  if(!msg)return;
  if(!msg.reactions)msg.reactions={};
  const prev=msg.reactions[ME.user_id];
  if(prev===emoji)delete msg.reactions[ME.user_id];
  else msg.reactions[ME.user_id]=emoji;
  saveDB(db);renderChat();
  const newEmoji=msg.reactions[ME.user_id]||null;
  const payload={type:'msg_react',from:ME.user_id,msgId,emoji:newEmoji};
  if(chatType==='private')broadcast({...payload,to:chatId});
  else{const g=db.groups[chatId];g.members.forEach(m=>{if(m!==ME.user_id)broadcast({...payload,to:m,groupId:chatId});});}
};

// ── ATAÇ MENÜSÜ ──────────────────────────────────────────────────
window.toggleAttachMenu=function(){
  const m=$('attachMenu');
  if(!m)return;
  m.classList.toggle('hidden');
};
window.closeAttachMenu=function(){
  $('attachMenu')?.classList.add('hidden');
};
// Dışarı tıklayınca kapat
document.addEventListener('click',e=>{
  if(!e.target.closest('#attachMenu')&&!e.target.closest('#attachBtn'))
    closeAttachMenu();
});

// ── GÖNDER / SES BUTONU TOGGLE (MOBİL) ───────────────────────────
// mobileSendBtn ↔ mobileVoiceBtn — input doluysa ✈, boşsa 🎙️
(function setupMobileSendVoiceToggle(){
  function _upd(){
    const val=($('msgInputMobile')?.value||'').trim();
    const sb=$('mobileSendBtn');
    const vb=$('mobileVoiceBtn');
    if(!sb||!vb)return;
    if(val.length>0){
      sb.style.display='flex';
      vb.style.display='none';
    }else{
      sb.style.display='none';
      vb.style.display='flex';
    }
  }
  // mobil input'u dinle
  document.addEventListener('input',e=>{
    if(e.target.id==='msgInputMobile')_upd();
  });
  // Gönder sonrası sıfırla
  setTimeout(()=>{
    const sb=$('mobileSendBtn');
    if(sb) sb.addEventListener('click',()=>setTimeout(_upd,50));
  },500);
  setTimeout(_upd,400);
})();

// Mobil gönder butonu — msgInputMobile'dan oku
setTimeout(()=>{
  const msb=$('mobileSendBtn');
  if(!msb)return;
  msb.onclick=()=>{
    // Aktif inputu bul ve değerini msgInput'a sync et
    const mInp=$('msgInputMobile');
    if(mInp) $('msgInput').value=mInp.value;
    $('sendBtn').click();
    if(mInp){mInp.value='';mInp.focus();}
    // Ses butonunu geri getir
    const sb=$('mobileSendBtn');const vb=$('mobileVoiceBtn');
    if(sb&&vb){sb.style.display='none';vb.style.display='flex';}
  };
  // Mobil input enter
  const mInp=$('msgInputMobile');
  if(mInp){
    mInp.addEventListener('keypress',e=>{if(e.key==='Enter')msb.click();});
    // Mobil emoji picker için de bağla
    const mEmojiBtn=$('mobileEmojiBtn');
    if(mEmojiBtn) mEmojiBtn.onclick=()=>toggleEmojiPicker();
  }
},600);

// Mobil ses kaydı wrapper
window.startMobileVoice=function(e){
  if(e)e.preventDefault();
  startVoiceRec();
};
window.stopMobileVoice=function(e){
  if(e)e.preventDefault();
  stopVoiceRec();
};

// ── EMOJİ PİCKER ─────────────────────────────────────────────────
const EMOJI_CATS={
  '😊':['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','😝','🤪','😎','🥹','😒','😞','😔','😟','😕','☹️','😣','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','😱','😨','😰','😥','😓','🫠'],
  '👍':['👍','👎','👊','✊','🤛','🤜','🤝','🙏','👐','🤲','👏','🙌','💪','🦾','✌️','🤞','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','🫶','💅'],
  '❤️':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🔥','⚡','🌈','💫','⭐','🌟','✨','💥','🎉','🎊','🎈','🎁','🏆','🥇'],
  '🐶':['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦉','🦇','🐺','🐴','🦄','🐝','🦋','🐌','🐞','🦎','🐊','🐢'],
  '🍕':['🍕','🍔','🌭','🥪','🥙','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🧁','🍰','🎂','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','☕','🍵'],
  '⚽':['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','⛳','🎯','🎮','🕹️','🎲','♟️','🎭','🎨','🎪','🎤','🎧','🎷','🎸','🎹','🎺','🥁','🎬'],
};

let _emojiCat='😊';
function buildEmojiPicker(){
  const p=$('emojiPicker');
  if(!p)return;
  const catBtns=Object.keys(EMOJI_CATS).map(c=>`<div class="emoji-cat ${c===_emojiCat?'active':''}" data-act="switchEmojiCat" data-a="${escHtml(c)}">${c}</div>`).join('');
  const emojis=EMOJI_CATS[_emojiCat]||[];
  const grid=emojis.map(e=>`<button class="emoji-btn" data-act="insertEmoji" data-a="${escHtml(e)}">${e}</button>`).join('');
  p.innerHTML=`<div class="emoji-cats">${catBtns}</div><div class="emoji-grid">${grid}</div>`;
}
window.switchEmojiCat=cat=>{_emojiCat=cat;buildEmojiPicker();};
window.insertEmoji=emoji=>{
  // Mobil görünümde mi masaüstü mü?
  const isMobile=window.innerWidth<=768;
  const inp=isMobile?($('msgInputMobile')||$('msgInput')):$('msgInput');
  const pos=inp.selectionStart||inp.value.length;
  inp.value=inp.value.slice(0,pos)+emoji+inp.value.slice(pos);
  inp.focus();inp.setSelectionRange(pos+emoji.length,pos+emoji.length);
  // Mobil toggle'ı tetikle
  if(isMobile) inp.dispatchEvent(new Event('input'));
};
window.toggleEmojiPicker=()=>{
  const p=$('emojiPicker');
  const open=p.classList.toggle('open');
  if(open)buildEmojiPicker();
};
document.addEventListener('click',e=>{
  if(!e.target.closest('#emojiPicker')&&!e.target.closest('#emojiToggleBtn')&&!e.target.closest('#mobileEmojiBtn'))
    $('emojiPicker')?.classList.remove('open');
});

// 🛡️ [YENİ-H3] Link preview — güvenli event delegation
// onclick attribute yoktur; data-lp-url http/https kontrol edildikten sonra açılır
document.addEventListener('click', e => {
  const card = e.target.closest('[data-lp-url]');
  if(!card) return;
  const u = card.dataset.lpUrl;
  if(u && /^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener,noreferrer');
});

// ── MSG OPS + READ + SOUND SİNYALLERİ ────────────────────────────
const _origHSfinal=handleSig;
handleSig=async(d)=>{
  // Duplikat kontrolü sadece burada — zincirin TEK giriş noktası
  if(d.msgId){if(seen.has(d.msgId))return;seen.add(d.msgId);if(seen.size>600){const it=seen.values();for(let i=0;i<150;i++)seen.delete(it.next().value);}}
  if(!ME) return;

  // Yeni mesaj operasyonları
  if(d.type==='msg_read'&&d.to===ME.user_id){
    const db=getDB();
    const k=[ME.user_id,d.from].sort().join('_');
    if(db.messages[k]){
      let ch=false;
      for(const m of db.messages[k]){
        if(m.from===ME.user_id){
          if(!m.readBy||!m.readBy.includes(d.from)){
            if(!m.readBy)m.readBy=[];
            m.readBy.push(d.from);ch=true;
          }
        }
        // lastMsgId belirtilmişse, o noktaya ulaşınca dur — sonraki
        // (henüz karşı tarafa iletilmemiş olabilecek) mesajları işaretleme
        if(d.lastMsgId&&m.id===d.lastMsgId) break;
      }
      if(ch){saveDB(db);if(chatId===d.from)renderChat();}
    }
    return;
  }
  if(d.type==='msg_edit'&&d.to===ME.user_id){
    const db=getDB();
    const k=d.groupId?'g_'+d.groupId:[ME.user_id,d.from].sort().join('_');
    const msg=(db.messages[k]||[]).find(m=>m.id===d.msgId);
    if(msg){msg.text=d.newText;msg.edited=true;saveDB(db);if(chatId===(d.groupId||d.from))renderChat();}
    return;
  }
  if(d.type==='msg_delete'&&d.to===ME.user_id){
    const db=getDB();
    // Private: key her iki kullanıcının adının sıralı birleşimi
    const k=d.groupId?'g_'+d.groupId:[ME.user_id,d.from].sort().join('_');
    const arr=db.messages[k]||[];
    const msg=arr.find(m=>m.id===d.msgId);
    if(msg){msg.deleted=true;msg.text='';msg.file=null;msg.img=null;saveDB(db);if(chatId===(d.groupId||d.from))renderChat();}
    return;
  }
  if(d.type==='msg_react'&&d.to===ME.user_id){
    const db=getDB();
    const k=d.groupId?'g_'+d.groupId:[ME.user_id,d.from].sort().join('_');
    const msg=(db.messages[k]||[]).find(m=>m.id===d.msgId);
    if(msg){if(!msg.reactions)msg.reactions={};if(d.emoji)msg.reactions[d.from]=d.emoji;else delete msg.reactions[d.from];saveDB(db);if(chatId===(d.groupId||d.from))renderChat();}
    return;
  }
  if(d.type==='group_read'&&d.to===ME.user_id){
    const db=getDB();
    const k='g_'+d.groupId;
    if(db.messages[k]){
      let ch=false;
      db.messages[k].forEach(m=>{
        if(m.from===ME.user_id){
          if(!m.readBy)m.readBy=[];
          if(!m.readBy.includes(d.from)){m.readBy.push(d.from);ch=true;}
        }
      });
      if(ch){saveDB(db);if(chatId===d.groupId)renderChat();}
    }
    return;
  }

  // 🛡️ [FIX] Burada AYRICA _notifyIncomingCall(d.from) çağrılıyordu — bu,
  // orijinal handleSig'in rtc_offer bloğuyla (aşağıda _origHSfinal üzerinden
  // çalışır) birlikte AYNI arama için fonksiyonun 2 KEZ tetiklenmesine sebep
  // oluyordu (bkz. _notifyIncomingCall içindeki not). Sessiz mod kontrolü artık
  // tek gerçek çağrı noktasına (orijinal handleSig, modal açılırken) taşındı;
  // burada tekrar çağırmaya gerek yok.
  if((d.type==='private_msg'||d.type==='group_msg')&&d.from!==ME.user_id){
    const isChatOpen=(chatId===d.from&&chatType==='private')||(d.groupId&&chatId===d.groupId);
    if(!isChatOpen && !isSilentMode()) playSound('msg');
    if(isChatOpen&&d.type==='private_msg') setTimeout(()=>markAsRead(d.from),300);
  }

  // Diğer her şeyi orijinal zincire ilet (seen zaten eklendi, orijinal dedup'u atla)
  // Orijinal handleSig'in dedup kontrolünü bypass etmek için msgId'yi geçici sil
  const savedId=d.msgId;
  delete d.msgId;
  await _origHSfinal(d);
  d.msgId=savedId;
};

// Sohbet açılınca okundu gönder
const _origSelChatFinal=window.selChat;
window.selChat=(id,type)=>{
  _origSelChatFinal(id,type);
  if(type==='private') setTimeout(()=>markAsRead(id),400);
  if(type==='group') setTimeout(()=>markGroupAllRead(id),400);
  if(window.innerWidth<=768) document.body.classList.add('chat-active');
};

// ── AVATAR ZOOM ───────────────────────────────────────────────────
window.openAvatarZoom=(src,name)=>{
  if(!src||!src.startsWith('data:'))return;
  $('avatarZoomImg').src=src;
  $('avatarZoomName').innerText=name||'';
  $('avatarZoom').classList.add('show');
  requestAnimationFrame(()=>requestAnimationFrame(()=>$('avatarZoomImg').classList.add('show')));
  document.addEventListener('keydown',_zoomKey);
};
window.closeAvatarZoom=()=>{
  $('avatarZoomImg').classList.remove('show');
  $('avatarZoom').classList.remove('show');
  document.removeEventListener('keydown',_zoomKey);
};
const _zoomKey=e=>{if(e.key==='Escape')closeAvatarZoom();};

// ── IMAGE VIEWER (for message photos) ────────────────────────────
window.openImageViewer=(src,name)=>{
  if(!src)return;
  $('imageViewerImg').src=src;
  $('imageViewerName').innerText=name||'';
  $('imageViewer').classList.add('show');
  requestAnimationFrame(()=>requestAnimationFrame(()=>$('imageViewerImg').classList.add('show')));
  document.addEventListener('keydown',_imgViewKey);
};
window.closeImageViewer=()=>{
  $('imageViewerImg').classList.remove('show');
  $('imageViewer').classList.remove('show');
  document.removeEventListener('keydown',_imgViewKey);
};
const _imgViewKey=e=>{if(e.key==='Escape')closeImageViewer();};
// ── EKran Paylaşımı Tam Ekran ────────────────────────────────────
window.toggleVideoFullscreen=()=>{
  const v=$('remoteVideo');
  if(v.classList.contains('hidden'))return;
  // Tarayıcı native fullscreen API
  if(!document.fullscreenElement){
    v.requestFullscreen().then(()=>{
      v.style.objectFit='contain';
    }).catch(()=>{
      // Fallback: CSS tam ekran
      v.classList.toggle('fullscreen-mode');
    });
  } else {
    document.exitFullscreen();
  }
};
// Fullscreen değişince butonu güncelle
document.addEventListener('fullscreenchange',()=>{
  const btn=$('screenFullBtn');
  if(btn) btn.textContent=document.fullscreenElement?'✕ Kapat':'⛶ Tam Ekran';
});
// ESC ile çık
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('remoteVideo').classList.contains('fullscreen-mode'))
    $('remoteVideo').classList.remove('fullscreen-mode');
});

window.zoomMyAvatar=()=>{
  if(ME&&ME.avatar&&ME.avatar.startsWith('data:'))openAvatarZoom(ME.avatar,ME.user_id);
};
window.zoomChatAvatar=()=>{
  if(!chatId)return;
  if(chatType==='private'){
    const src=avatars[chatId];
    if(src&&src.startsWith('data:'))openAvatarZoom(src,chatId);
  } else {
    const g=getDB().groups[chatId];
    if(g&&g.avatar&&g.avatar.startsWith('data:'))openAvatarZoom(g.avatar,g.name);
  }
};

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(title,desc){
  // 🛡️ [SAST-2 FIX] Stored XSS: title/desc ağdan gelen kullanıcı denetimli
  // veriler içerebilir (örn. grup adı, kullanıcı adı). Önceden innerHTML'e
  // escape edilmeden veriliyordu — 76 çağrı noktasının tek tek düzeltilmesi
  // yerine merkezi (defansif) escape burada uygulanır.
  const t=document.createElement('div');t.className='toast';
  t.innerHTML=`<strong style="display:block;margin-bottom:4px">${escHtml(String(title??''))}</strong><span style="font-size:13px;opacity:.9">${escHtml(String(desc??''))}</span>`;
  $('toastArea').appendChild(t);setTimeout(()=>t.remove(),4000);
}

// ── PRESENCE ──────────────────────────────────────────────────────
setInterval(sendPresence,12000);

// ── BOOT ─────────────────────────────────────────────────────────
// TURN sunucularını önceden yükle, sonra ağa bağlan
fetchIceServers().finally(()=>connectNetwork());
// Mikrofon sadece arama başlayınca açılır — güvenlik
renderLoginAccounts();

// ── ARKA PLAN SES ÇÖZÜMÜ ─────────────────────────────────────────
// Mobil tarayıcılar (iOS Safari, Android Chrome) arka plana geçince
// AudioContext suspend oluyor, WebRTC sesi kesiliyor.
// 3 katmanlı çözüm: Wake Lock + Silent Loop + Visibility Resume

let _bgWakeLock=null;
let _silentAudioCtx=null;
let _bgKaInterval=null;

// 1. Screen Wake Lock
async function requestWakeLock(){
  if(!('wakeLock' in navigator))return;
  try{
    _bgWakeLock=await navigator.wakeLock.request('screen');
    _bgWakeLock.addEventListener('release',()=>{
      if(document.visibilityState==='visible') requestWakeLock();
    });
  }catch(e){}
}

// 2. Silent oscillator — AudioContext'i aktif tutar (0.00001 gain, duyulmaz)
function startSilentAudio(){
  if(_silentAudioCtx&&_silentAudioCtx.state!=='closed') return;
  try{
    _silentAudioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:8000});
    const osc=_silentAudioCtx.createOscillator();
    const g=_silentAudioCtx.createGain();
    g.gain.value=0.00001;
    osc.connect(g); g.connect(_silentAudioCtx.destination);
    osc.start();
  }catch(e){}
}

// 3. Tüm ses kaynaklarını uyandır + track'leri kontrol et
async function resumeAllAudio(){
  if(_silentAudioCtx&&_silentAudioCtx.state==='suspended') _silentAudioCtx.resume().catch(()=>{});
  // Stream track kontrol
  if(_persistentRawStream){
    _persistentRawStream.getAudioTracks().forEach(t=>{
      if(t.readyState==='ended'){
        console.warn('📱 Mobil: track kesildi, yeniden başlatılıyor');
        if(ls) restartMicWithSettings().catch(()=>{});
      } else if(!isMuted) t.enabled=true;
    });
  }
  // WebRTC sender track'leri
  const conns=[pc,...Object.values(groupCallPeers||{}).map(p=>p.pc)].filter(Boolean);
  for(const conn of conns){
    for(const s of conn.getSenders()){
      if(s.track&&s.track.kind==='audio'&&s.track.readyState==='ended'&&!isMuted){
        try{
          const stream=await getMicStream();
          const t=stream.getAudioTracks()[0];
          if(t) await s.replaceTrack(t);
        }catch(e){}
      }
    }
  }
}

// Görünürlük değişince
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    resumeAllAudio();
    requestWakeLock();
    // MQTT bağlantısı kopmuşsa yeniden bağlan
    if(mq&&!mq.connected) schedRec();
  }
  if(document.visibilityState==='hidden'){
    const inCall=callIv!==null||Object.keys(groupCallPeers||{}).length>0;
    if(inCall) startSilentAudio();
    // Arama varsa MQTT bağlantısını canlı tut — reconnect yapmayı engelle
    if(inCall && mq && mq.connected){
      // Keepalive ping gönder
      try{ sendPresence(); }catch(e){}
    }
  }
});

// iOS pagehide — sayfa önbelleğe alınmadan önce tetiklenir
window.addEventListener('pagehide',(e)=>{
  const inCall=callIv!==null||Object.keys(groupCallPeers||{}).length>0;
  if(inCall){
    // Sayfa gerçekten kapanmıyorsa (bfcache) ses devam etsin
    if(e.persisted){
      startSilentAudio();
      requestWakeLock();
    }
  }
},{passive:true});

// iOS focus/blur
window.addEventListener('focus',resumeAllAudio,{passive:true});
window.addEventListener('pageshow',resumeAllAudio,{passive:true});

// Dokunuşta AudioContext unlock (iOS zorunlu)
document.addEventListener('touchstart',()=>{
  if(_silentAudioCtx&&_silentAudioCtx.state==='suspended') _silentAudioCtx.resume().catch(()=>{});
},{passive:true});

// Arama başlayınca aktif et
const _origSCUI=startCallUI;
startCallUI=(name)=>{
  _origSCUI(name);
  requestWakeLock();
  startSilentAudio();
  clearInterval(_bgKaInterval);
  _bgKaInterval=setInterval(()=>{
    if(_silentAudioCtx&&_silentAudioCtx.state==='suspended') _silentAudioCtx.resume().catch(()=>{});
  },4000);
};

// Arama bitince temizle
const _origECBg=endCall;
endCall=(reason)=>{
  clearInterval(_bgKaInterval); _bgKaInterval=null;
  if(_bgWakeLock){_bgWakeLock.release().catch(()=>{});_bgWakeLock=null;}
  if(_silentAudioCtx){try{_silentAudioCtx.close();}catch(e){} _silentAudioCtx=null;}
  _origECBg(reason);
};

(async()=>{
const saved=localStorage.getItem(SES_KEY);
if(saved){
  try{
    // 🛡️ [MED-03] Önce sessionStorage'dan şifreleme anahtarını geri yüklemeyi dene
    // (aynı sekmede F5/yenileme ise anahtar burada bulunur, şifre tekrar sorulmaz)
    const keyRestored = await _tryRestoreEncKeyFromSession();

    const db=getDB();
    const user=db.users&&db.users[saved];
    if(user){
      const sess=sessionGet();
      // 🛡️ [KRİTİK-V3-H1 / MED-03] Şifre koyulmuş bir hesapsa, sessiz otomatik
      // giriş İÇİN şifreleme anahtarının da kullanılabilir olması ŞART.
      // Anahtar yoksa (tarayıcı yeniden başlatılmış, sessionStorage temiz) —
      // mesaj geçmişi çözülemeyeceğinden şifre tekrar sorulur. Bu, gerçek
      // şifrelemenin kaçınılmaz bir UX bedelidir; aksi halde "şifreleme" sadece
      // dekoratif kalır (KRİTİK-V3-H1'in tam olarak işaret ettiği sorun).
      const needsKey = pwExists(saved);
      const sessionValid = sess && sess.u===saved.toLowerCase() && (!needsKey || keyRestored);

      if(sessionValid){
        // ✅ Aynı sekme oturumu devam ediyor (ve gerekiyorsa anahtar hazır) — şifre sormadan giriş
        ME=user; blocked=ME.blocked||[];
        $('authScreen').style.display='none';
        $('mainApp').classList.remove('hidden');
        document.body.classList.add('sv-logged-in');
        updateUI();setTimeout(sendPresence,2000);
        // ME.username tanımlandıktan hemen sonra bu fonksiyonu çağır:
        initPushNotifications();
      } else if(pwExists(saved)){
        // 🔒 Şifresi var ama anahtar/oturum yok → şifre sor
        $('authUsername').value=user.user_id;
        $('authPassword').value='';
        $('authStatus').innerText = (sess && needsKey && !keyRestored)
          ? '🔒 Mesaj geçmişinizi görmek için şifrenizi tekrar girin.'
          : 'Lütfen şifrenizi girin.';
        $('firstLoginBanner').style.display='none';
        $('authBtn').innerText='Giriş Yap';
        localStorage.removeItem(SES_KEY);
        setTimeout(()=>$('authPassword').focus(),150);
      } else {
        // Şifresi yok → şifre belirleme moduna geç
        $('authUsername').value=user.user_id;
        $('authPassword').value='';
        $('authStatus').innerText='';
        $('firstLoginBanner').style.display='block';
        $('authBtn').innerText='Şifre Belirle ve Giriş Yap';
        localStorage.removeItem(SES_KEY);
        setTimeout(()=>$('authPassword').focus(),150);
      }
    } else {
      // Kullanıcı bulunamadı — backup dene
      const backup=localStorage.getItem(DB_BACKUP_KEY);
      if(backup){
        const bdb=JSON.parse(backup);
        if(bdb.users&&bdb.users[saved]){
          const currentDb=getDB();
          currentDb.users=bdb.users;
          currentDb.groups=bdb.groups||currentDb.groups;
          saveDB(currentDb);
          const restoredUser=currentDb.users[saved];
          const sess=sessionGet();
          const needsKey2 = pwExists(saved);
          const sessionValid = sess && sess.u===saved.toLowerCase() && (!needsKey2 || keyRestored);
          if(sessionValid){
            ME=restoredUser; blocked=ME.blocked||[];
            $('authScreen').style.display='none';
            $('mainApp').classList.remove('hidden');
            document.body.classList.add('sv-logged-in');
            updateUI();setTimeout(sendPresence,2000);
            showToast('Hesap Geri Yüklendi','Hesabınız yedekten kurtarıldı.');
            // ME.username tanımlandıktan hemen sonra bu fonksiyonu çağır:
            initPushNotifications();
          } else if(pwExists(saved)){
            $('authUsername').value=restoredUser.user_id;
            $('authPassword').value='';
            $('authStatus').innerText = (sess && needsKey2 && !keyRestored)
              ? '🔒 Mesaj geçmişinizi görmek için şifrenizi tekrar girin.'
              : 'Lütfen şifrenizi girin.';
            $('firstLoginBanner').style.display='none';
            $('authBtn').innerText='Giriş Yap';
            localStorage.removeItem(SES_KEY);
            setTimeout(()=>$('authPassword').focus(),150);
          } else {
            $('authUsername').value=restoredUser.user_id;
            $('authPassword').value='';
            $('authStatus').innerText='';
            $('firstLoginBanner').style.display='block';
            $('authBtn').innerText='Şifre Belirle ve Giriş Yap';
            localStorage.removeItem(SES_KEY);
            setTimeout(()=>$('authPassword').focus(),150);
            showToast('Hesap Geri Yüklendi','Hesabınız yedekten kurtarıldı — şifre belirleyin.');
          }
        }
      }
    }
  }catch(e){
    console.error('Oturum restore hatası:',e);
    localStorage.removeItem(SES_KEY);
    sessionClear();
  }
}
})();

// ══════════════════════════════════════════════════════════════════
//  ① GLOBAL MESAJ ARAMA
// ══════════════════════════════════════════════════════════════════
window.openGlobalSearch=()=>{
  if(!ME)return;
  $('globalSearchModal').classList.add('open');
  setTimeout(()=>$('globalSearchInput').focus(),80);
  // Show active/online friends immediately
  showActiveUsersInSearch();
};
window.closeGlobalSearch=()=>{
  $('globalSearchModal').classList.remove('open');
  $('globalSearchInput').value='';
  $('globalSearchResults').innerHTML='<div class="gs-empty">Aramak istediğiniz kelimeyi yazın...</div>';
};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeGlobalSearch();closeStats();}});

// ── CALL UI MİNİMİZE (Küçültme) ──────────────────────────────────
window.minimizeCallUI=function(){
  const ui=$('callUI');
  if(!ui||ui.classList.contains('hidden')) return;
  // Arama devam ediyor ama UI gizleniyor — bildir
  showToast('Arama Devam Ediyor','Arama arka planda sürdürülüyor. Geri dönmek için tekrar arayın.');
  ui.classList.add('hidden');
};

// ── YAYINI HERKESİN GÖRMESİ İÇİN: Arama kapatıldığında rtc_end/grp_end broadcast ──
// endCallBtn'e hook — tam kapanış (endCall zaten broadcast yapıyor)
// Ek olarak: callUI'dan çıkıldığında (minimize veya endCall) tüm gruba bildir
const _origEndCallBroadcast = endCall;
endCall = (reason) => {
  // Grup araması için tüm üyelere grp_end gönder (zaten yapılıyor, burada güvence)
  const gid = activeChatId || chatId;
  if(gid && chatType === 'group' && Object.keys(groupCallPeers).length === 0) {
    // Grup aramasında peer kapatılmadan endCall çağrıldıysa broadcast et
    const g = getDB().groups[gid];
    if(g) g.members.forEach(m=>{if(m!==ME.user_id) broadcast({type:'grp_end',to:m,from:ME.user_id,groupId:gid});});
  }
  // Birebir arama için rtc_end gönder (zaten yapılıyor ama güvence)
  if(gid && chatType === 'private' && pc) {
    broadcast({type:'rtc_end',to:gid,from:ME.user_id});
  }
  _origEndCallBroadcast(reason);
};

// Show active (typing / recently online) users at top of search
function showActiveUsersInSearch(){
  if(!ME) return;
  const el=$('globalSearchResults');
  const db=getDB();
  const friends=(db.users[ME.user_id.toLowerCase()]?.friends)||[];
  // Online friends sorted: typing first, then recently active
  const activeFriends=friends
    .filter(f=>isOn(f))
    .sort((a,b)=>{
      const at=_typingUsers&&_typingUsers.has(a)?1:0;
      const bt=_typingUsers&&_typingUsers.has(b)?1:0;
      return bt-at;
    });
  if(!activeFriends.length){
    el.innerHTML='<div class="gs-empty">Aramak istediğiniz kelimeyi yazın...</div>';
    return;
  }
  const sectionLabel='<div class="gs-group">🟢 Şu an çevrimiçi</div>';
  const items=activeFriends.map(f=>{
    const rawAv=avatars[f];
    // 🛡️ [HIGH-06] Global arama avatar dogrulaması
    const safeRawAvGs=sanitizeAvatarUrl(rawAv);
    const avHTML=safeRawAvGs?`<img src="${safeRawAvGs}" style="width:100%;height:100%;object-fit:cover;">`:escHtml(f.charAt(0).toUpperCase());
    const isTyping=_typingUsers&&_typingUsers.has(f);
    const stColor={available:'#10b981',busy:'#ef4444',dnd:'#7c3aed',away:'#f59e0b'}[peerStatuses[f]||'available']||'#10b981';
    return `<div class="gs-active-user" data-act="_uiGsSelPrivate" data-a="${escHtml(f)}">
      <div class="gs-active-av" style="background:var(--primary)">
        ${avHTML}
        <span class="gs-typing-dot" style="background:${stColor}"></span>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(f)}</div>
        <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px">
          ${isTyping?`<span style="color:var(--ok);display:inline-flex;align-items:center;gap:3px">Yazıyor <span class="ta"><span></span><span></span><span></span></span></span>`:'<span style="color:'+stColor+'">Çevrimiçi</span>'}
        </div>
      </div>
      <span style="margin-left:auto;font-size:18px">💬</span>
    </div>`;
  }).join('');
  el.innerHTML=sectionLabel+items+'<div class="gs-group" style="border-top:1px solid var(--border);margin-top:4px">veya mesajlarda ara...</div>';
}

// Track who is currently typing (for search display)
// Track typing users — declared at top of state section

window.runGlobalSearch=q=>{
  const el=$('globalSearchResults');
  q=(q||'').trim();
  if(q.length<2){
    showActiveUsersInSearch();
    return;
  }
  const db=getDB();
  const qLow=q.toLowerCase();
  const results=[]; // {chatId, chatType, chatName, msg}

  // Özel mesajlar — hem mesaj hem kişi ismine göre ara
  const friends=(db.users[ME.user_id.toLowerCase()]?.friends)||[];
  friends.forEach(fid=>{
    // Kişi adı eşleşmesi — sohbeti göster
    if(fid.toLowerCase().includes(qLow)){
      const k=[ME.user_id.toLowerCase(),fid].sort().join('_');
      const msgs=db.messages[k]||[];
      const lastMsg=msgs.filter(m=>!m.deleted&&!m.sys).slice(-1)[0];
      if(lastMsg) results.push({chatId:fid,chatType:'private',chatName:fid,msg:lastMsg,nameMatch:true});
      else results.push({chatId:fid,chatType:'private',chatName:fid,msg:{text:'Sohbeti aç',time:''},nameMatch:true});
    }
    const k=[ME.user_id.toLowerCase(),fid].sort().join('_');
    (db.messages[k]||[]).forEach(m=>{
      if(!m.deleted&&!m.sys&&m.text&&m.text.toLowerCase().includes(qLow))
        results.push({chatId:fid,chatType:'private',chatName:fid,msg:m});
    });
  });
  // Grup mesajları
  Object.values(db.groups||{}).forEach(g=>{
    const k='g_'+g.id;
    (db.messages[k]||[]).forEach(m=>{
      if(!m.deleted&&!m.sys&&m.text&&m.text.toLowerCase().includes(qLow))
        results.push({chatId:g.id,chatType:'group',chatName:g.name,msg:m});
    });
  });

  if(!results.length){el.innerHTML=`<div class="gs-empty">🔍 "${escHtml(q)}" için sonuç bulunamadı.</div>`;return;}

  // Sohbete göre grupla
  const grouped={};
  results.forEach(r=>{
    const key=r.chatType+'::'+r.chatId;
    if(!grouped[key])grouped[key]={chatId:r.chatId,chatType:r.chatType,chatName:r.chatName,items:[]};
    grouped[key].items.push(r.msg);
  });

  const highlight=t=>escHtml(t).replace(new RegExp(escHtml(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<mark>${m}</mark>`);

  el.innerHTML=Object.values(grouped).map(g=>`
    <div class="gs-group">${g.chatType==='group'?'👥':''} ${escHtml(g.chatName)} (${g.items.length})</div>
    ${g.items.slice(0,5).map(m=>`
      <div class="gs-item" data-act="_uiGsSelChat" data-a="${escHtml(g.chatId)}" data-a2="${escHtml(g.chatType)}">
        <div class="gs-item-name">${escHtml(m.from||'')} · ${m.time||''}</div>
        <div class="gs-item-text">${highlight((m.text||'').substring(0,120))}</div>
      </div>`).join('')}
    ${g.items.length>5?`<div style="padding:6px 16px;font-size:11px;color:var(--muted)">+${g.items.length-5} sonuç daha...</div>`:''}
  `).join('');
};

// ══════════════════════════════════════════════════════════════════
//  ② LİNK ÖNİZLEME
// ══════════════════════════════════════════════════════════════════

// ── YouTube video ID çıkar ──────────────────────────────────────
function extractYoutubeId(url){
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── oEmbed ile YouTube metadata çek (API key gerektirmez) ────────
async function fetchYoutubeOEmbed(url){
  try{
    const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {signal: AbortSignal.timeout(5000)});
    if(!oe.ok) return null;
    return await oe.json();
  }catch(e){ return null; }
}

const _lpCache={};

async function fetchLinkPreview(url){
  if(_lpCache[url]) return _lpCache[url];

  let lp = null;

  // ── YouTube: oEmbed + thumbnail direkt ─────────────────────────
  const ytId = extractYoutubeId(url);
  if(ytId){
    const oe = await fetchYoutubeOEmbed(url);
    lp = {
      url,
      type: 'youtube',
      ytId,
      title:   oe?.title  || 'YouTube Video',
      author:  oe?.author_name || '',
      thumb:   `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      domain:  'youtube.com',
      favicon: 'https://www.youtube.com/favicon.ico',
    };
    _lpCache[url] = lp;
    return lp;
  }

  // ── Genel site: allorigins proxy ────────────────────────────────
  try{
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const r = await fetch(proxy, {signal: AbortSignal.timeout(6000)});
    if(!r.ok) return null;
    const j = await r.json();
    const html = j.contents || '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const g = (sel, attr) => { const el=doc.querySelector(sel); return el?(attr?el.getAttribute(attr):el.textContent?.trim()):null; };
    const title  = g('meta[property="og:title"]','content') || g('meta[name="twitter:title"]','content') || g('title') || '';
    const desc   = g('meta[property="og:description"]','content') || g('meta[name="description"]','content') || '';
    const image  = g('meta[property="og:image"]','content') || g('meta[name="twitter:image"]','content') || null;
    const domain = new URL(url).hostname.replace('www.','');
    const favicon= `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    lp = { url, type:'general', title:title.substring(0,120), desc:desc.substring(0,200), image, domain, favicon };
    _lpCache[url] = lp;
    return lp;
  }catch(e){ return null; }
}

// ── Mesaj gönderildikten sonra URL varsa önizleme çek ────────────
async function enrichWithLinkPreview(msgId, text, convKey){
  const urlMatch = text.match(/https?:\/\/[^\s<>"]{10,}/);
  if(!urlMatch) return;
  const lp = await fetchLinkPreview(urlMatch[0]);
  if(!lp || (!lp.title && lp.type !== 'youtube')) return;
  const db = getDB();
  const msgs = db.messages[convKey] || [];
  const m = msgs.find(x => x.id === msgId);
  if(m && !m.linkPreview){
    m.linkPreview = lp;
    saveDB(db);
    // Alıcıya da link preview verisini gönder (broadcast)
    const lpMsg = {type:'link_preview_update', msgId, convKey, lp};
    if(chatType==='private') broadcast({...lpMsg, to:chatId, from:ME.user_id});
    else{
      const g=db.groups[chatId];
      g&&g.members.forEach(mbr=>{ if(mbr!==ME.user_id) broadcast({...lpMsg, to:mbr, groupId:chatId, from:ME.user_id}); });
    }
    if(chatId&&(convKey===([ME.user_id,chatId].sort().join('_'))||convKey==='g_'+chatId)) renderChat();
  }
}

// ══════════════════════════════════════════════════════════════════
//  ③ ANKET / OYLAMA
// ══════════════════════════════════════════════════════════════════
window.openPollModal=()=>{
  if(!chatId){showToast('Anket','Önce bir sohbet açın.');return;}
  $('pollModal').classList.add('open');
  $('pollQuestion').value='';
  // Seçenekleri sıfırla
  $('pollOptions').innerHTML=`
    <div class="poll-opt-row"><input placeholder="Seçenek 1" class="poll-opt-inp"><button data-act="_uiRemovePollOpt" data-self="1" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:0;min-width:auto">✕</button></div>
    <div class="poll-opt-row"><input placeholder="Seçenek 2" class="poll-opt-inp"><button data-act="_uiRemovePollOpt" data-self="1" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:0;min-width:auto">✕</button></div>`;
};
window.closePollModal=()=>$('pollModal').classList.remove('open');
window.addPollOpt=()=>{
  const n=$('pollOptions').querySelectorAll('.poll-opt-row').length+1;
  if(n>8){showToast('Anket','Maksimum 8 seçenek.');return;}
  const row=document.createElement('div');row.className='poll-opt-row';
  row.innerHTML=`<input placeholder="Seçenek ${n}" class="poll-opt-inp"><button data-act="_uiRemovePollOpt" data-self="1" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:0;min-width:auto">✕</button>`;
  $('pollOptions').appendChild(row);
};
window.removePollOpt=btn=>{
  const rows=$('pollOptions').querySelectorAll('.poll-opt-row');
  if(rows.length<=2){showToast('Anket','En az 2 seçenek gerekli.');return;}
  btn.closest('.poll-opt-row').remove();
};
window.submitPoll=()=>{
  const q=$('pollQuestion').value.trim();
  if(!q){showToast('Anket','Soru giriniz.');return;}
  const opts=[...$('pollOptions').querySelectorAll('.poll-opt-inp')].map(i=>i.value.trim()).filter(Boolean);
  if(opts.length<2){showToast('Anket','En az 2 seçenek gerekli.');return;}
  closePollModal();
  const pollData={options:opts.map(o=>({text:o,voters:[]})),question:q};
  const msg={id:uid(),from:ME.user_id,text:`📊 ${q}`,time:gt(),type:'poll',poll:pollData};
  const db=getDB();
  if(chatType==='private'){
    const k=[ME.user_id,chatId].sort().join('_');
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push(msg);saveDB(db);
    broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg});
  }else{
    const k='g_'+chatId;
    if(!db.messages[k])db.messages[k]=[];
    db.messages[k].push(msg);saveDB(db);
    const g=db.groups[chatId];
    g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg});});
  }
  renderChat();
};

function renderPollHTML(m, isMe){
  const p=m.poll;
  if(!p) return `<span class="msg-text">📊 ${escHtml(m.text||'')}</span>`;
  const total=p.options.reduce((s,o)=>s+(o.voters||[]).length,0);
  const myVote=p.options.findIndex(o=>(o.voters||[]).includes(ME.user_id));
  const voted=myVote>=0;
  const opts=p.options.map((o,i)=>{
    const cnt=(o.voters||[]).length;
    const pct=total?Math.round(cnt/total*100):0;
    const isMyOpt=i===myVote;
    return `<div class="poll-option" data-act="castVote" data-a="${escHtml(m.id)}" data-a2="${i}">
      <div class="poll-bar-wrap">
        <div class="poll-bar${isMyOpt?' voted':''}" style="width:${voted?pct:0}%"></div>
        <div class="poll-bar-label">
          <span>${voted?'✓ ':''}<b>${escHtml(o.text)}</b></span>
          <span class="poll-bar-pct">${voted?pct+'%':''}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="poll-msg">
    <div class="poll-question">📊 ${escHtml(p.question)}</div>
    ${opts}
    <div class="poll-total">${total} oy${voted?'':' · oy vermek için tıkla'}</div>
  </div>`;
}

window.castVote=(msgId, optIdx)=>{
  if(!chatId) return;
  const db=getDB();
  const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
  const m=(db.messages[k]||[]).find(x=>x.id===msgId);
  if(!m||!m.poll) return;
  // Mevcut oyu kaldır
  m.poll.options.forEach(o=>{o.voters=(o.voters||[]).filter(v=>v!==ME.user_id);});
  // Yeni oy
  m.poll.options[optIdx].voters.push(ME.user_id);
  saveDB(db);
  // Karşıya bildir
  const upd={type:'poll_vote',msgId,optIdx,voter:ME.user_id};
  if(chatType==='private') broadcast({...upd,to:chatId,from:ME.user_id});
  else{const g=db.groups[chatId];g.members.forEach(mbr=>{if(mbr!==ME.user_id)broadcast({...upd,to:mbr,groupId:chatId,from:ME.user_id});});}
  renderChat();
};

// Poll oy sinyali al
const _origHSpollBefore=handleSig;
handleSig=async(d)=>{
  if(d.type==='poll_vote'&&d.to===ME.user_id){
    const db=getDB();
    const k=d.groupId?'g_'+d.groupId:[ME.user_id,d.from].sort().join('_');
    const m=(db.messages[k]||[]).find(x=>x.id===d.msgId);
    if(m&&m.poll){
      m.poll.options.forEach(o=>{o.voters=(o.voters||[]).filter(v=>v!==d.voter);});
      if(d.optIdx>=0&&d.optIdx<m.poll.options.length) m.poll.options[d.optIdx].voters.push(d.voter);
      saveDB(db);
      if(chatId&&(k===([ME.user_id,chatId].sort().join('_'))||k==='g_'+chatId)) renderChat();
    }
    return;
  }
  // Link önizleme güncellemesi — gönderen taraf çekip alıcıya iletir
  if(d.type==='link_preview_update'&&d.to===ME.user_id){
    if(!d.lp||typeof d.lp!=='object'||!d.msgId) return;
    const db=getDB();
    const k=d.groupId?'g_'+d.groupId:[ME.user_id,d.from].sort().join('_');
    const m=(db.messages[k]||[]).find(x=>x.id===d.msgId);
    // 🛡️ [SAST-7 FIX] Önceden d.lp doğrulanmadan/sınırlandırılmadan kabul
    // ediliyordu ve HERHANGİ bir msgId'ye iliştirilebiliyordu — yani bir
    // saldırgan kendi göndermediği (örn. SİZİN attığınız) bir mesaja sahte/
    // yanıltıcı başlık-açıklama-görsel ekleyebiliyordu. Artık: (a) önizleme
    // SADECE mesajı gerçekten gönderen kişiden geliyorsa kabul edilir, (b)
    // alanlar tip/uzunluk olarak sınırlandırılır, (c) url/image sanitizeLinkUrl
    // ile (render zaten escHtml uyguluyor, bu savunma derinliği).
    if(m && !m.linkPreview && m.from===d.from){
      const raw=d.lp;
      const safeLp={
        url:    typeof raw.url==='string' ? raw.url.slice(0,500) : '',
        type:   raw.type==='youtube' ? 'youtube' : 'general',
        title:  typeof raw.title==='string' ? raw.title.slice(0,120) : '',
        desc:   typeof raw.desc==='string'  ? raw.desc.slice(0,200)  : '',
        domain: typeof raw.domain==='string'? raw.domain.slice(0,80) : '',
        image:  typeof raw.image==='string' ? raw.image.slice(0,500): null,
        favicon:typeof raw.favicon==='string'? raw.favicon.slice(0,500): null,
        thumb:  typeof raw.thumb==='string' ? raw.thumb.slice(0,500) : undefined,
        ytId:   typeof raw.ytId==='string'  ? raw.ytId.slice(0,32)  : undefined,
        author: typeof raw.author==='string'? raw.author.slice(0,80): undefined,
      };
      if(!safeLp.title && safeLp.type!=='youtube') return; // render koşulu (lp.title) zaten bunu gerektiriyor
      m.linkPreview=safeLp;
      saveDB(db);
      if(chatId&&(k===([ME.user_id,chatId].sort().join('_'))||k==='g_'+chatId)) renderChat();
    }
    return;
  }
  await _origHSpollBefore(d);
};

// ══════════════════════════════════════════════════════════════════
//  ④ KAYBOLUCAK MESAJLAR
// ══════════════════════════════════════════════════════════════════
let _vanishMode=false;

window.toggleVanishMode=()=>{
  _vanishMode=!_vanishMode;
  const bar=$('vanishToggleBar'), btn=$('vanishBtn');
  if(_vanishMode){
    bar.classList.remove('hidden');
    btn.style.color='#ef4444';
    $('msgInput').placeholder='Kaybolucak mesaj yaz...';
    showToast('⏱️ Kaybolucak Mod','Mesajlar belirlenen süre sonra silinir.');
  }else{
    bar.classList.add('hidden');
    btn.style.color='var(--muted)';
    $('msgInput').placeholder='Mesajınızı yazın...';
  }
};

// Gönder butonuna vanish eklentisi
const _origSendClick=$('sendBtn').onclick;
$('sendBtn').onclick=()=>{
  if(!chatId){return;}  // 📱 Sohbet seçilmemişse hiçbir şey yapma
  if(_vanishMode&&chatId){
    const text=$('msgInput').value.trim();
    if(!text) return;
    const dur=parseInt($('vanishDurSel').value)||30;
    const expiresAt=Date.now()+dur*1000;
    const msg={id:uid(),from:ME.user_id,text,time:gt(),expiresAt};
    if(window._replyTo){msg.replyTo=window._replyTo;cancelReply();}
    const db=getDB();
    if(chatType==='private'){
      const k=[ME.user_id,chatId].sort().join('_');
      if(!db.messages[k])db.messages[k]=[];
      db.messages[k].push(msg);saveDB(db);
      broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg});
    }else{
      const k='g_'+chatId;
      if(!db.messages[k])db.messages[k]=[];
      db.messages[k].push(msg);saveDB(db);
      const g=db.groups[chatId];
      g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg});});
    }
    $('msgInput').value='';$('msgInput').focus();
    renderChat();msgParticles();
    return;
  }
  _origSendClick&&_origSendClick();
};

// Geri sayım timer — her saniye çalışır
setInterval(()=>{
  // Geri sayım etiketlerini güncelle
  document.querySelectorAll('.msg-timer[data-exp]').forEach(el=>{
    const rem=Math.ceil((parseInt(el.dataset.exp)-Date.now())/1000);
    if(rem<=0){el.textContent='0s';}
    else{el.textContent=rem>=60?Math.ceil(rem/60)+'dk':rem+'s';}
  });
  // Süresi dolan mesajları sil
  if(!ME) return;
  const db=getDB();
  let changed=false;
  const now2=Date.now();
  const allKeys=Object.keys(db.messages||{});
  allKeys.forEach(k=>{
    if(!Array.isArray(db.messages[k])) return;
    const before=db.messages[k].length;
    db.messages[k]=db.messages[k].filter(m=>{
      if(m.expiresAt&&m.expiresAt<=now2){changed=true;return false;}
      return true;
    });
    if(db.messages[k].length!==before) changed=true;
  });
  if(changed){saveDB(db);if(chatId)renderChat();}
},1000);

// ══════════════════════════════════════════════════════════════════
//  🎙️ SES MESAJI
// ══════════════════════════════════════════════════════════════════
let _vmRecorder=null, _vmChunks=[], _vmStartTime=0, _vmStream=null;

window.startVoiceRec=async()=>{
  if(!chatId){showToast('Ses Mesajı','Önce bir sohbet seçin.');return;}
  try{
    _vmStream=await navigator.mediaDevices.getUserMedia({audio:true});
    _vmChunks=[];
    _vmStartTime=Date.now();
    _vmRecorder=new MediaRecorder(_vmStream,{mimeType:MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm'});
    _vmRecorder.ondataavailable=e=>{if(e.data.size>0)_vmChunks.push(e.data);};
    _vmRecorder.onstop=_onVoiceStop;
    _vmRecorder.start();
    // Hem masaüstü hem mobil butona recording uygula
    const btn=$('voiceRecBtn')||$('mobileVoiceBtn');
    const mBtn=$('mobileVoiceBtn');
    [btn,mBtn].filter(Boolean).forEach(b=>{b.classList.add('recording');b.textContent='⏹️';});
    const ind=document.createElement('span');ind.className='rec-indicator';ind.id='recInd';ind.textContent='● REC';
    if(btn)btn.appendChild(ind);
  }catch(e){showToast('Ses Mesajı','Mikrofon erişimi reddedildi.');}
};

window.stopVoiceRec=()=>{
  if(!_vmRecorder||_vmRecorder.state==='inactive') return;
  const dur=Math.round((Date.now()-_vmStartTime)/1000);
  const _resetBtns=()=>{
    [$('voiceRecBtn'),$('mobileVoiceBtn')].filter(Boolean).forEach(b=>{b.classList.remove('recording');b.textContent='🎙️';});
    document.getElementById('recInd')?.remove();
  };
  if(dur<1){
    _vmRecorder.stream.getTracks().forEach(t=>t.stop());
    _vmRecorder=null;
    _resetBtns();
    return;
  }
  _vmRecorder._dur=dur;
  _vmRecorder.stop();
  _vmStream.getTracks().forEach(t=>t.stop());
  _resetBtns();
};

function _onVoiceStop(){
  const dur=_vmRecorder._dur||1;
  const blob=new Blob(_vmChunks,{type:_vmRecorder.mimeType||'audio/webm'});
  const reader=new FileReader();
  reader.onload=ev=>{
    const data=ev.target.result;
    const msgId=uid();
    _sessionFiles.set(msgId,data);
    const msg={id:msgId,from:ME.user_id,text:'🎙️ Ses mesajı',time:gt(),fileType:'voice',fileData:'__session__'+msgId,voiceDur:dur};
    const db=getDB();
    if(chatType==='private'){
      const k=[ME.user_id,chatId].sort().join('_');
      if(!db.messages[k])db.messages[k]=[];
      db.messages[k].push({...msg,fileData:'__session__'+msgId});
      saveDB(db);
      broadcast({type:'private_msg',to:chatId,from:ME.user_id,msg:{...msg,fileData:data}});
    }else{
      const k='g_'+chatId;
      if(!db.messages[k])db.messages[k]=[];
      db.messages[k].push({...msg,fileData:'__session__'+msgId});
      saveDB(db);
      const g=db.groups[chatId];
      g.members.forEach(m=>{if(m!==ME.user_id)broadcast({type:'group_msg',to:m,groupId:chatId,from:ME.user_id,msg:{...msg,fileData:data}});});
    }
    renderChat();
  };
  reader.readAsDataURL(blob);
}

// Ses oynatma — msgId üzerinden çalışır, büyük base64 string parametre olarak geçilmez
const _vmAudios={};
window.playVoiceMsg=(msgId,btn)=>{
  if(!_vmAudios[msgId]){
    // _sessionFiles'tan çöz
    const data=_sessionFiles.get(msgId);
    if(!data){showToast('Ses Mesajı','Ses verisi bu oturumda bulunamadı.\nAlıcı tarafında desteklenmez, lütfen uygulamayı yenileyin.');return;}
    const audio=new Audio(data);
    _vmAudios[msgId]=audio;
    const sid=`vm_${msgId}`;
    audio.addEventListener('timeupdate',()=>{
      const el=document.getElementById(sid+'_t');
      if(el){
        const rem=Math.max(0,Math.ceil(audio.duration-audio.currentTime));
        const m2=Math.floor(rem/60),s=rem%60;
        el.textContent=`${m2}:${s.toString().padStart(2,'0')}`;
      }
    });
    audio.addEventListener('ended',()=>{
      if(btn){btn.textContent='▶';btn.dataset.playing='0';}
      const el=document.getElementById(sid+'_t');
      const dur=Math.round(audio.duration)||0;
      if(el){const m2=Math.floor(dur/60),s=dur%60;el.textContent=`${m2}:${s.toString().padStart(2,'0')}`;}
    });
  }
  const audio=_vmAudios[msgId];
  if(btn&&btn.dataset.playing==='1'){
    audio.pause();btn.textContent='▶';btn.dataset.playing='0';
  }else{
    Object.values(_vmAudios).forEach(a=>{if(a!==audio&&!a.paused){a.pause();a.currentTime=0;}});
    document.querySelectorAll('.vm-play[data-playing="1"]').forEach(b=>{b.textContent='▶';b.dataset.playing='0';});
    audio.play().catch(e=>{console.error('Ses oynatma hatası:',e);showToast('Ses','Oynatılamadı: '+e.message);});
    if(btn){btn.textContent='⏸';btn.dataset.playing='1';}
  }
};

// ══════════════════════════════════════════════════════════════════
//  📵 CEVAPSİZ ARAMA GEÇMİŞİ
// ══════════════════════════════════════════════════════════════════
// Arama reddedilince ya da cevaplanmayınca sohbete "cevapsız arama" kartı ekle

// rtc_reject aldığımızda (karşı taraf reddetmiş) — arayan tarafta kayıt
const _origHSbeforeMissed=handleSig;
handleSig=async(d)=>{
  if(d.type==='rtc_reject'&&d.to===ME.user_id){
    // Arayan biz — karşı taraf reddetti → kendi sohbetimize cevapsız kart ekle
    endCall(`${d.from} aramayı reddetti.`);
    _saveMissedCall(d.from,'outgoing_rejected');
    return;
  }
  await _origHSbeforeMissed(d);
};

function _saveMissedCall(withUser, type){
  // Karşı taraf reddetti (bizim aramımız) veya biz cevaplamadık → kaydet
  const db=getDB();
  const k=[ME.user_id,withUser].sort().join('_');
  if(!db.messages[k])db.messages[k]=[];
  db.messages[k].push({
    sys:true, missedCall:true,
    from:type==='outgoing_rejected'?withUser:withUser,
    text:`📵 Cevapsız arama · ${withUser}`,
    time:gt(), id:uid()
  });
  saveDB(db);
  if(chatId===withUser&&chatType==='private') renderChat();
}

// Gelen arama cevaplanmadan kapatılırsa (callModal dismiss)
const _origRejectBtn=$('rejectCallBtn').onclick;
$('rejectCallBtn').onclick=()=>{
  _origRejectBtn&&_origRejectBtn();
  const o=window._offer;
  if(o&&!o.isGroup&&o.from){
    // Karşı taraf için "cevapsız" kayıt — karşı taraf rtc_reject alacak
    // Biz de kendi tarafımızda kayıt tutalım
    _saveMissedCall(o.from,'incoming_missed');
  }
};

// ══════════════════════════════════════════════════════════════════
//  📊 MESAJ İSTATİSTİKLERİ
// ══════════════════════════════════════════════════════════════════
window.openStats=()=>{
  if(!ME){showToast('İstatistik','Giriş yapın.');return;}
  $('statsContent').innerHTML=buildStats();
  $('statsModal').classList.add('open');
};
window.closeStats=()=>$('statsModal').classList.remove('open');
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeStats();});

function buildStats(){
  const db=getDB();
  const mk=ME.user_id.toLowerCase();
  let totalSent=0,totalRecv=0,totalVoice=0,totalFile=0,totalPoll=0;
  const friendCounts={}, hourCounts=new Array(24).fill(0);

  // Özel sohbetler
  const friends=(db.users[mk]?.friends)||[];
  friends.forEach(f=>{
    const k=[mk,f].sort().join('_');
    const msgs=db.messages[k]||[];
    msgs.forEach(m=>{
      if(m.sys||m.deleted) return;
      // Saat parse et — TÜM mesajlar için (gönderilen + alınan)
      const tp=m.time||'';
      const hm=tp.match(/(\d{1,2}):(\d{2})/);
      if(hm) hourCounts[parseInt(hm[1])]++;
      if(m.from===ME.user_id){
        totalSent++;
        if(m.fileType==='voice') totalVoice++;
        else if(m.fileType&&m.fileType!=='voice') totalFile++;
        else if(m.type==='poll') totalPoll++;
        if(!friendCounts[f]) friendCounts[f]=0;
        friendCounts[f]++;
      } else {
        totalRecv++;
        // Karşı tarafla toplam konuşma sayısına ekle (her iki yön)
        if(!friendCounts[f]) friendCounts[f]=0;
        friendCounts[f]++;
      }
    });
  });

  // Grup sohbetleri
  Object.values(db.groups||{}).forEach(g=>{
    const k='g_'+g.id;
    (db.messages[k]||[]).forEach(m=>{
      if(m.sys||m.deleted) return;
      const tp=m.time||'';
      const hm=tp.match(/(\d{1,2}):(\d{2})/);
      if(hm) hourCounts[parseInt(hm[1])]++;
      if(m.from===ME.user_id){
        totalSent++;
        if(m.fileType==='voice') totalVoice++;
        else if(m.fileType&&m.fileType!=='voice') totalFile++;
      } else {
        totalRecv++;
      }
    });
  });

  // En aktif saat
  const maxHourVal=Math.max(...hourCounts);
  const peakHour=maxHourVal>0?hourCounts.indexOf(maxHourVal):-1;
  const peakLabel=peakHour>=0?`${peakHour.toString().padStart(2,'0')}:00–${((peakHour+1)%24).toString().padStart(2,'0')}:00`:'—';

  // En çok konuşulan 5 kişi
  const top5=Object.entries(friendCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCnt=top5[0]?.[1]||1;

  // Saatlik dağılım — 4'er saatlik dilimler
  const timeSlots=[
    {label:'🌙 Gece',    range:'00-06', val:hourCounts.slice(0,6).reduce((a,b)=>a+b,0)},
    {label:'🌅 Sabah',   range:'06-12', val:hourCounts.slice(6,12).reduce((a,b)=>a+b,0)},
    {label:'☀️ Öğle',   range:'12-18', val:hourCounts.slice(12,18).reduce((a,b)=>a+b,0)},
    {label:'🌆 Akşam',  range:'18-24', val:hourCounts.slice(18,24).reduce((a,b)=>a+b,0)},
  ];
  const maxSlot=Math.max(...timeSlots.map(s=>s.val))||1;
  const total=totalSent+totalRecv;

  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val">${totalSent.toLocaleString()}</div><div class="stat-lbl">📤 Gönderilen</div></div>
      <div class="stat-card"><div class="stat-val">${totalRecv.toLocaleString()}</div><div class="stat-lbl">📥 Alınan</div></div>
      <div class="stat-card"><div class="stat-val">${totalVoice}</div><div class="stat-lbl">🎙️ Ses mesajı</div></div>
      <div class="stat-card"><div class="stat-val">${totalFile}</div><div class="stat-lbl">📎 Dosya</div></div>
    </div>
    ${peakHour>=0?`<div style="background:var(--sec);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">⏰</span>
      <div><div style="font-size:13px;font-weight:700;color:var(--text)">En aktif saat: ${peakLabel}</div>
      <div style="font-size:11px;color:var(--muted)">Bu saatte ${maxHourVal} mesaj — toplam ${total.toLocaleString()} mesaj</div></div>
    </div>`:''}
    ${top5.length?`
      <div class="stats-section">En çok konuştuğun kişiler</div>
      ${top5.map(([f,cnt])=>`
        <div class="stats-bar-row">
          <span class="stats-bar-label">${escHtml(f)}</span>
          <div class="stats-bar-wrap"><div class="stats-bar-fill" style="width:${Math.round(cnt/maxCnt*100)}%"></div></div>
          <span class="stats-bar-cnt">${cnt}</span>
        </div>`).join('')}`:''}
    <div class="stats-section">Günlük aktivite dağılımı</div>
    ${timeSlots.map(s=>`
      <div class="stats-bar-row">
        <span class="stats-bar-label" style="width:90px;font-size:12px">${s.label}</span>
        <div class="stats-bar-wrap" title="${s.range}"><div class="stats-bar-fill" style="width:${maxSlot?Math.round(s.val/maxSlot*100):0}%;transition:width .6s ease"></div></div>
        <span class="stats-bar-cnt">${s.val}</span>
      </div>`).join('')}
    ${total===0?'<p style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Henüz mesaj yok.</p>':''}
  `;
}

// ══════════════════════════════════════════════════════════════════
const _origSBClick2=$('sendBtn').onclick;
// Link preview'u gönderilen normal mesajlara ekle
const _hookLinkPreview=()=>{
  const origClick=$('sendBtn').onclick;
  $('sendBtn').onclick=async()=>{
    const text=$('msgInput').value.trim();
    origClick&&origClick();
    // Sadece normal (vanish olmayan) mesajlarda ve URL varsa
    if(!_vanishMode&&text&&chatId&&/https?:\/\/[^\s]{10,}/.test(text)){
      const k=chatType==='private'?[ME.user_id,chatId].sort().join('_'):'g_'+chatId;
      const db=getDB();
      const msgs=db.messages[k]||[];
      // Son eklenen mesajın id'sini bul
      const last=msgs[msgs.length-1];
      if(last&&last.from===ME.user_id) enrichWithLinkPreview(last.id, text, k);
    }
  };
};
// sendBtn.onclick zinciri tamamlandıktan sonra hook'u ekle
setTimeout(_hookLinkPreview, 100);

// ══════════════════════════════════════════════════════════════════
//  📱 MOBİL DRAWER — Sidebar aç/kapat
// ══════════════════════════════════════════════════════════════════
function toggleMobileSidebar(){
  if(!ME) return; // 🛡️ Login olmadan açılamaz
  const sb=$('sidebar');
  if(sb.classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
}
function openMobileSidebar(){
  if(!ME) return; // 🛡️ Login olmadan açılamaz
  $('sidebar').classList.add('mobile-open');
  // Overlay'i göster
  const ov=$('sidebarOverlay');
  if(ov) ov.style.display='block';
  document.body.style.overflow='hidden';
}
function closeMobileSidebar(){
  $('sidebar').classList.remove('mobile-open');
  const ov=$('sidebarOverlay');
  if(ov) ov.style.display='none';
  document.body.style.overflow='';
}
function showMobileSidebar(){
  // Chat'ten sidebar'a dön (mobil)
  if(window.innerWidth<=768) openMobileSidebar();
}

// selChat çağrısında mobil sidebar'ı kapat
const _origSelChatMobile=window.selChat;
window.selChat=(id,type)=>{
  _origSelChatMobile(id,type);
  if(window.innerWidth<=768){
    closeMobileSidebar();
    // Chat açıkken FAB gizle
    document.body.classList.add('chat-active');
    // Mobilde chat alanını ön plana çıkar — emptyState'i gizle
    const es=$('emptyState');
    if(es) es.classList.add('hidden');
    // Chat header + input'u görünür yap
    const ca=$('chatArea');
    if(ca) ca.style.zIndex='1';
    // Input'a odaklan (klavyeyi aç)
    setTimeout(()=>{ try{$('msgInput').focus();}catch(e){} },350);
  }
};

// Ekran dönüşünde sidebar durumunu sıfırla
window.addEventListener('resize',()=>{
  if(window.innerWidth>768){
    $('sidebar').classList.remove('mobile-open');
    const ov=$('sidebarOverlay');
    if(ov) ov.style.display='none';
    document.body.style.overflow='';
  }
});

// ── PWA: Service Worker kayıt ─────────────────────────────────────
(()=>{
  if(!('serviceWorker' in navigator)) return;
  // Inline SW — ayrı dosya gerekmez
  const swCode=`
const CACHE='sv-v1';
const ASSETS=['/'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  // Network first — çevrimdışı için cache fallback
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
// Push bildirimi
self.addEventListener('push',e=>{
  const d=e.data?e.data.json():{title:'openchat',body:'Yeni mesaj'};
  e.waitUntil(self.registration.showNotification(d.title||'openchat',{
    body:d.body||'',icon:d.icon||'/icon-192.png',badge:d.badge||'/icon-192.png',
    tag:d.tag||'sv-msg',renotify:true,
    vibrate:[200,100,200]
  }));
});
// Ana sayfadan gelen mesaj bildirimi isteği (background notif)
self.addEventListener('message',e=>{
  if(e.data&&e.data.type==='SHOW_NOTIF'){
    const d=e.data;
    const isCall=d.tag==='sv-call';
    const vibPattern=isCall
      ?[400,200,400,200,400,200,400] // Telefon zil titreşim paterni
      :[200,100,200];
    self.registration.showNotification(d.title||'openchat',{
      body:d.body||'',icon:d.icon||'/icon-192.png',badge:d.badge||'/icon-192.png',
      tag:d.tag||'sv',renotify:true,
      vibrate:vibPattern,
      requireInteraction:isCall, // Arama bildirimi kaybolmasın
      silent:false,
      data:{url:'/',isCall:isCall}
    });
  }
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
`;
  const blob=new Blob([swCode],{type:'application/javascript'});
  const url=URL.createObjectURL(blob);
  navigator.serviceWorker.register(url,{scope:'./'}).catch(()=>{});
})();

// ── Bildirim izni iste (mesaj/çağrı geldiğinde kullan) ───────────
window._notifGranted=false;
(async()=>{
  if(!('Notification' in window)) return;
  if(Notification.permission==='granted'){window._notifGranted=true;return;}
  if(Notification.permission!=='denied'){
    // Kullanıcı ilk mesaj gönderene kadar bekleme — sonra iste
    window._askNotifOnce=true;
  }
})();
async function _ensureNotifPerm(){
  if(!('Notification' in window)) return;
  // Zaten verilmiş
  if(Notification.permission==='granted'){ window._notifGranted=true; return; }
  // Kesin reddedilmiş — tekrar sormaya gerek yok
  if(Notification.permission==='denied') return;
  // 'default': daha önce sorulmamış veya sıfırlanmış — iste
  if(!window._askNotifOnce) return;
  window._askNotifOnce=false;
  try{
    const r=await Notification.requestPermission();
    window._notifGranted=(r==='granted');
    _updateMobilBildirimUI();
  }catch(e){}
}

// ── Ayarlardaki "Bildirimleri Aç" durumunu güncelle ─────────────────
function _updateMobilBildirimUI(){
  const el=$('mobilBildirimDurum');
  if(!el) return;
  if(!('Notification' in window)){ el.textContent='Desteklenmiyor'; return; }
  if(Notification.permission==='granted'){ el.textContent='✅ Açık'; el.style.color='var(--ok)'; }
  else if(Notification.permission==='denied'){ el.textContent='⛔ Engelli — Tarayıcıdan Aç'; el.style.color='var(--danger)'; }
  else{ el.textContent='Kapalı — Aç'; el.style.color='var(--muted)'; }
}
_updateMobilBildirimUI();

// ── Ayarlar > "Bildirimleri Aç" butonu — tıklayınca izin isteği tetikler ──
$on('mobilBildirimBtn','click', async ()=>{
  if(!('Notification' in window)){ showToast('Desteklenmiyor','Bu cihaz/tarayıcı bildirimleri desteklemiyor.'); return; }
  if(Notification.permission==='denied'){
    showToast('Bildirimler Engelli','Tarayıcı ayarlarından bu site için bildirim izni vermen gerekiyor.');
    return;
  }
  const r=await Notification.requestPermission();
  window._notifGranted=(r==='granted');
  window._askNotifOnce=false;
  _updateMobilBildirimUI();
  if(r==='granted'){
    showToast('Bildirimler Açıldı','Artık mesaj ve arama bildirimlerini alacaksın.');
    if(typeof initPushNotifications==='function') initPushNotifications().catch(()=>{});
  }else{
    showToast('Bildirimler Kapalı','İzin verilmedi.');
  }
});

// ── Stabilite: bildirimler kapalıysa günde bir kez otomatik izin iste ──
(function _dailyNotifPrompt(){
  if(!('Notification' in window)) return;
  if(Notification.permission!=='default') return; // zaten karar verilmiş (açık/engelli)
  const KEY='sv_last_notif_ask';
  const today=new Date().toDateString();
  let last=null;
  try{ last=localStorage.getItem(KEY); }catch(e){}
  if(last===today) return;
  try{ localStorage.setItem(KEY, today); }catch(e){}
  // Sayfa tamamen yüklendikten sonra, kullanıcı bir etkileşimde bulunduğunda iste
  const _ask=async()=>{
    document.removeEventListener('click', _ask);
    document.removeEventListener('keydown', _ask);
    if(Notification.permission!=='default') return;
    const r=await Notification.requestPermission();
    window._notifGranted=(r==='granted');
    _updateMobilBildirimUI();
  };
  document.addEventListener('click', _ask, {once:true});
  document.addEventListener('keydown', _ask, {once:true});
})();

// ── Gelişmiş Native Bildirim Sistemi ─────────────────────────────
// Uygulama arka planda / farklı sekmede / telefon kilitliyken bile çalışır

// Zil sesi — Web Audio ile sentezlenmiş gerçekçi zil
let _ringInterval=null;
function _playRingTone(){
  _stopRingTone();
  let count=0;
  function _oneRing(){
    try{
      const ac=new(window.AudioContext||window.webkitAudioContext)();
      // 📱 Mobilede AudioContext suspended başlayabilir — resume et
      const _doRing=()=>{
        try{
          // Çift tonlu telefon zili (DTMF benzeri 440Hz + 480Hz)
          const o1=ac.createOscillator(), o2=ac.createOscillator();
          const g=ac.createGain();
          o1.type='sine'; o1.frequency.value=440;
          o2.type='sine'; o2.frequency.value=480;
          o1.connect(g); o2.connect(g); g.connect(ac.destination);
          g.gain.setValueAtTime(0.35, ac.currentTime);
          g.gain.setValueAtTime(0.35, ac.currentTime+1.5);
          g.gain.linearRampToValueAtTime(0, ac.currentTime+1.8);
          o1.start(ac.currentTime); o1.stop(ac.currentTime+1.8);
          o2.start(ac.currentTime); o2.stop(ac.currentTime+1.8);
          setTimeout(()=>{ try{ac.close();}catch(e){} }, 2500);
        }catch(e){}
      };
      if(ac.state==='suspended'){
        ac.resume().then(_doRing).catch(()=>{});
      } else {
        _doRing();
      }
    }catch(e){}
  }
  _oneRing();
  _ringInterval=setInterval(()=>{ if(++count<15) _oneRing(); else _stopRingTone(); }, 3000);
}
function _stopRingTone(){
  if(_ringInterval){ clearInterval(_ringInterval); _ringInterval=null; }
}

// Mesaj sesi — uygulama arka planda ise çal
function _playMsgSound(){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const o=ac.createOscillator(); const g=ac.createGain();
    o.type='sine'; o.frequency.setValueAtTime(880,ac.currentTime);
    o.frequency.setValueAtTime(1100,ac.currentTime+0.08);
    g.gain.setValueAtTime(0.25,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.25);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime); o.stop(ac.currentTime+0.25);
    setTimeout(()=>{ try{ac.close();}catch(e){} }, 500);
  }catch(e){}
}

// Bildirim gönder — mesaj veya arama için
async function _sendNativeNotif(title, body, tag){
  await _ensureNotifPerm();
  const appVisible = document.visibilityState==='visible' && document.hasFocus();
  const isCall = tag==='sv-call';
  
  // Arama bildirimleri HER ZAMAN gönderilir (uygulama açık olsa da)
  // Mesaj bildirimleri sadece uygulama arka plandayken
  if(window._notifGranted && (!appVisible || isCall)){
    try{
      if(navigator.serviceWorker?.controller){
        navigator.serviceWorker.controller.postMessage({
          type:'SHOW_NOTIF', title, body, tag:tag||'sv',
          icon:'/icon-192.png', badge:'/icon-192.png'
        });
      } else {
        const vibPat=isCall?[400,200,400,200,400]:[200,100,200];
        const n=new Notification(title,{
          body, tag:tag||'sv', icon:'/icon-192.png',
          renotify:true, requireInteraction:isCall,
          silent:false, vibrate:vibPat
        });
        n.onclick=()=>{ window.focus(); n.close(); };
      }
    }catch(e){}
  }
}

// Gelen arama bildirimi — zil + sistem bildirimi
let _callNotifInterval=null;
async function _notifyIncomingCall(callerName){
  // 🛡️ [FIX] Bu fonksiyon birden fazla yerden (orijinal handleSig +
  // sarmalayıcı handleSig) tek bir aramada birden çok kez çağrılabiliyordu.
  // Önceki interval temizlenmeden yeni bir setInterval kurulduğu için her
  // fazladan çağrı, referansı kaybedilen ve ASLA durdurulamayan bir bildirim
  // döngüsü bırakıyordu — bu da "tek aramada sürekli bildirim spamı" sorunuydu.
  // Artık her çağrıda önce var olan interval temizlenir; en fazla BİR interval
  // aktif olabilir.
  if(_callNotifInterval){ clearInterval(_callNotifInterval); _callNotifInterval=null; }
  _playRingTone();

  // 📱 Mobil tespiti — userAgent tabanlı (güvenilir platform bilgisi)
  const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const appVisible = document.visibilityState==='visible' && document.hasFocus();

  // Mobilede HEMEN bildirim gönder (uygulama açık olsa da):
  //   — iOS/Android'de sistem banner'ı olmadan zil sesi geçmiyor olabilir
  //   — Ekran kilitli veya başka uygulamadaysa mutlaka gitsin
  // Masaüstünde: sadece arka planda / odak yoksa gönder (zil yeterli)
  if(!appVisible || isMobileDevice){
    // İlk bildirimi hemen gönder
    await _sendNativeNotif('📞 Gelen Arama', callerName + ' sizi arıyor — dokunun', 'sv-call');
    // 5 saniyede bir tekrarla — telefon zil sesi gibi
    _callNotifInterval=setInterval(async()=>{
      await _sendNativeNotif('📞 Gelen Arama', callerName + ' sizi arıyor — cevaplayın', 'sv-call');
    }, 5000);
  }
}
// Arama cevaplandı/reddedildi — zili ve bildirimleri durdur
function _stopCallNotif(){
  _stopRingTone();
  if(_callNotifInterval){ clearInterval(_callNotifInterval); _callNotifInterval=null; }
}

(()=>{
  let tx=0,ty=0;
  document.addEventListener('touchstart',e=>{
    tx=e.touches[0].clientX;
    ty=e.touches[0].clientY;
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(window.innerWidth>768) return;
    const dx=e.changedTouches[0].clientX-tx;
    const dy=e.changedTouches[0].clientY-ty;
    // Yatay swipe > 60px, dikey < 40px
    if(Math.abs(dx)>60&&Math.abs(dy)<40){
      if(dx>0&&tx<40) openMobileSidebar();   // sol kenardan sağa → aç
      if(dx<0) closeMobileSidebar();          // sola kaydır → kapat
    }
  },{passive:true});
})();

// ── Mobil başlangıç ayarları ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// 🛡️ [CSP-FIX] MERKEZİ EVENT DELEGATION SİSTEMİ
// Tüm dinamik (per-user/per-id) onclick/oncontextmenu/onerror
// inline handler'ları kaldırılıp data-act="..." attribute'una
// taşındı. Bu sayede CSP hash listesine hiçbir dinamik içerik
// eklenmesi gerekmiyor. Burada tek seferlik dinleyiciler kurulur.
// ══════════════════════════════════════════════════════════════════
(()=>{
  // ── Yardımcı fonksiyonlar ──────────────────────────────────────
  function _getAB(el){ return [el.getAttribute('data-a')||'', el.getAttribute('data-a2')||'']; }

  // ── CLICK delegation ───────────────────────────────────────────
  document.addEventListener('click', e=>{
    const el = e.target.closest('[data-act]');
    if(!el) return;
    if(el.getAttribute('data-stop')==='1') e.stopPropagation();
    const act = el.getAttribute('data-act');
    const [a, a2] = _getAB(el);

    // self: 1 = el kendisi, 2 = el (buton olarak)
    const self = el.getAttribute('data-self');

    switch(act){
      // ── Navigasyon / sohbet seçimi ──
      case 'selChat':         selChat(a, a2 || 'private'); break;
      case '_uiSelChatClose': selChat(a, a2 || 'private'); closeCtx(); break;
      case '_uiGsSelPrivate': closeGlobalSearch(); selChat(a, 'private'); break;
      case '_uiGsSelChat':    closeGlobalSearch(); selChat(a, a2); break;
      // ── Gruplar ──
      case 'openGroupDetail':   e.stopPropagation(); openGroupDetail(a); break;
      case '_uiNewGroup':       if(!window.ME) return; openGroupModal(); break;
      case 'addMemberToGroup':  addMemberToGroup(); break;
      case 'kickMember':        kickMember(a); break;
      case 'promoteAdmin':      promoteAdmin(a); break;
      case 'demoteAdmin':       demoteAdmin(a); break;
      // ── Arkadaşlar / engel ──
      case 'rmFriend':          rmFriend(a); break;
      case 'blkUser':           blkUser(a); break;
      case 'unblock':           unblock(a); break;
      case 'openPeerVolMenu':   if(el.getAttribute('data-pass-event')) openPeerVolMenu(e, a); break;
      // ── Mesaj eylemleri ──
      case 'startReply':        startReply(a); break;
      case 'openReactPicker':   openReactPicker(a, self==='2'?el:null); break;
      case 'editMsg':           editMsg(a); break;
      case 'deleteMsg':         deleteMsg(a); break;
      case 'toggleReaction':    toggleReaction(a, a2); break;
      case 'playVoiceMsg':      playVoiceMsg(a, self==='2'?el:null); break;
      case '_uiPlayVoiceFromWave':{
        const sid = a2;
        const btn = sid ? document.querySelector('#'+sid+' .vm-play') : null;
        if(btn) playVoiceMsg(a, btn);
        break;
      }
      case 'openImageViewer':   openImageViewer(a, a2); break;
      case 'openAvatarZoom':    openAvatarZoom(a, a2); break;
      case '_uiCallBack':       selChat(a,'private'); $('callBtn')?.click(); break;
      // ── Msg context menu ──
      case '_uiMsgCtxReply':   startReply(a); document.getElementById('msgCtxMenu')?.remove(); break;
      case '_uiMsgCtxReact':   openReactPicker(a, self==='2'?el:null); document.getElementById('msgCtxMenu')?.remove(); break;
      case '_uiMsgCtxEdit':    editMsg(a); document.getElementById('msgCtxMenu')?.remove(); break;
      case '_uiMsgCtxDelete':  deleteMsg(a); document.getElementById('msgCtxMenu')?.remove(); break;
      // ── İnline reaksiyon picker ──
      case '_uiPickReact':     toggleReaction(a, a2); document.getElementById('inlineReactPicker')?.remove(); break;
      // ── Emoji picker ──
      case 'switchEmojiCat':   switchEmojiCat(a); break;
      case 'insertEmoji':       insertEmoji(a); break;
      case 'csSelectCat':       csSelectCat(+a); break;
      case 'csPickEmoji':       csPickEmoji(a); break;
      case 'clearCustomStatus': e.stopPropagation(); clearCustomStatus(e); break;
      // ── Ses kontrol menüsü ──
      case 'closePeerVolMenu':  closePeerVolMenu(); break;
      case '_uiPvmStepDown':{
        const s=$('pvm-vol'); if(!s) break;
        const nv=Math.max(0,+s.value-10); s.value=nv; _pvmUpdate(a,nv); break;
      }
      case '_uiPvmStepUp':{
        const s=$('pvm-vol'); if(!s) break;
        const nv=Math.min(150,+s.value+10); s.value=nv; _pvmUpdate(a,nv); break;
      }
      case '_uiPvmFull':   _pvmUpdate(a,100); const sv=$('pvm-vol'); if(sv) sv.value=100; break;
      case '_uiPvmMute':   _pvmUpdate(a,0);   const mv=$('pvm-vol'); if(mv) mv.value=0;   break;
      // ── Anket ──
      case 'castVote':          castVote(a, +a2); break;
      case '_uiRemovePollOpt':  removePollOpt(el); break;
      // ── Link tıklama koruma (sadece propagation engelle) ──
      case '_uiNoop':           e.stopPropagation(); break;
    }
  });

  // ── CONTEXTMENU delegation ─────────────────────────────────────
  document.addEventListener('contextmenu', e=>{
    const el = e.target.closest('[data-ctx-act]');
    if(!el) return;
    const act = el.getAttribute('data-ctx-act');
    const a   = el.getAttribute('data-ctx-a')||'';
    const a2  = el.getAttribute('data-ctx-a2')||'';
    switch(act){
      case 'showCtx':         showCtx(e, a); break;
      case 'showMsgCtx':      showMsgCtx(e, a, a2); break;
      case 'openPeerVolMenu': if(el.getAttribute('data-ctx-pass-event')) openPeerVolMenu(e, a); break;
    }
  });

  // ── ERROR delegation (onerror yerine) ─────────────────────────
  document.addEventListener('error', e=>{
    const t = e.target;
    if(t.tagName !== 'IMG') return;
    const mode = t.getAttribute('data-onerror');
    if(mode === 'hide'){
      t.style.display='none';
    } else if(mode === 'ytfallback'){
      const ytId = t.getAttribute('data-ytid');
      if(ytId) t.src=`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
      else t.style.display='none';
    }
  }, true); // capture=true: error olayı bubble etmez

  // ── CHANGE/INPUT delegation (oninput yerine) ──────────────────
  document.addEventListener('input', e=>{
    const t = e.target;
    const act = t.getAttribute('data-oninput');
    if(!act) return;
    const a = t.getAttribute('data-oninput-a')||'';
    if(act === '_pvmUpdate') _pvmUpdate(a, +t.value);
  });
})();

(()=>{
  if(window.innerWidth>768) return;
  const esMsg=document.getElementById('emptyStateMsg');
  if(esMsg) esMsg.textContent='Sohbet seçmek için 💬 tuşuna dokun';
  window.addEventListener('load',()=>{
    setTimeout(()=>{
      if(window.ME && window.innerWidth<=768) openMobileSidebar();
    },200);
  });
})();
