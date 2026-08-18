/* ================================================================
   openchat — i18n (Language) layer
   ------------------------------------------------------------------
   The app's source code and templates remain Turkish (unchanged).
   This file translates what's shown ON SCREEN only:
     - Default language: English (site opens in English by default)
     - User can switch to Turkish from Settings → Language
     - Choice is remembered (localStorage) per device
   How it works: instead of editing every one of the hundreds of
   Turkish strings scattered across app.js, we watch the DOM (which
   app.js constantly re-renders via innerHTML) and swap any known
   Turkish phrase for its English translation, live, using a single
   combined regex built from the dictionary below. Nothing is touched
   if the user has chosen Turkish — the original strings pass through
   untouched in that case.
   ================================================================ */
(function(){
  const LANG_KEY = 'sv_lang';

  // 'en' = default (first run). 'tr' = user opted in via Settings.
  window.SV_LANG = localStorage.getItem(LANG_KEY) || 'en';

  window.setSvLang = function(lang){
    if(lang!=='en' && lang!=='tr') return;
    localStorage.setItem(LANG_KEY, lang);
    location.reload();
  };

  document.documentElement.lang = window.SV_LANG === 'tr' ? 'tr' : 'en';

  if(window.SV_LANG === 'tr'){
    // Native language — nothing to translate, skip building the
    // (fairly large) regex engine entirely. Still make sure the
    // Settings dropdown reflects the current choice.
    const syncTr = ()=>{ const sel=document.getElementById('langSelect'); if(sel) sel.value='tr'; };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', syncTr);
    else syncTr();
    return;
  }

  // ── TR → EN dictionary ──────────────────────────────────────────
  // Longest phrases are matched first (see build step below) so a
  // full sentence like "Yeni şifre (en az 6 karakter):" wins over a
  // shorter fragment like "Yeni". Keys are case-sensitive, exact
  // Turkish substrings as they appear in the source.
  const DICT = {
    // ── Auth / Login ──────────────────────────────────────────────
    "Hoş Geldin": "Welcome",
    "Hesabınla giriş yap veya yeni hesap oluştur": "Sign in to your account or create a new one",
    "Güvenli, hızlı ve şifreli mesajlaşma platformu.": "A secure, fast, and encrypted messaging platform.",
    "Kullanıcı Adı": "Username",
    "Kullanıcı adını girin...": "Enter your username...",
    "en az 3 karakter, harf/rakam/_": "at least 3 characters, letters/numbers/_",
    "Şifre": "Password",
    "Şifreyi göster/gizle": "Show/hide password",
    "en az 6 karakter": "at least 6 characters",
    "Şifren cihazında saklanır, ağa gitmez": "Your password is stored on your device, never sent over the network",
    "Giriş Yap": "Log In",
    "veya": "or",
    "Şifre Belirle ve Giriş Yap": "Set Password and Log In",
    "🔒 İlk şifreni belirle": "🔒 Set your first password",
    "Yeni şifre (en az 6 karakter):": "New password (at least 6 characters):",
    "Yeni şifreyi tekrar girin:": "Re-enter the new password:",
    "Kullanıcı adı: 3-16 karakter, harf/rakam/_ kullanın.": "Username: 3-16 characters, use letters/numbers/_.",
    "Kullanıcı adı değiştirilemez — bu senin kalıcı kimliğin.": "Username can't be changed — it's your permanent identity.",
    "Lütfen şifrenizi girin.": "Please enter your password.",
    "Şifrenizi girin.": "Enter your password.",
    "Geçersiz şifre": "Invalid password",
    "Şifreler eşleşmiyor!": "Passwords don't match!",
    "Şifre en az 6 karakter olmalı.": "Password must be at least 6 characters.",
    "İsim 3-16 karakter olmalı": "Name must be 3-16 characters",
    "Bu isim şu an başka biri tarafından kullanılıyor!": "This name is currently taken by someone else!",
    "Doğrulanıyor...": "Verifying...",
    "Hazırlanıyor...": "Preparing...",
    "Şifre oluşturuluyor...": "Setting up password...",
    "Hesabınız yedekten kurtarıldı — şifre belirleyin.": "Your account was restored from backup — set a password.",
    "Hesabınız yedekten kurtarıldı.": "Your account was restored from backup.",
    "Hesap Geri Yüklendi": "Account Restored",
    "Şifre Değiştirildi": "Password Changed",
    "✅ Yeni şifreniz kaydedildi.": "✅ Your new password has been saved.",
    "❌ Mevcut şifre yanlış!": "❌ Current password is incorrect!",
    "Mevcut şifreniz:": "Your current password:",
    "🔒 Şifre Değiştir": "🔒 Change Password",
    "Geçersiz.": "Invalid.",

    // ── Sidebar / Chat list ──────────────────────────────────────
    "Sohbetler": "Chats",
    "🔍  Tüm sohbetlerde ara...": "🔍  Search all chats...",
    "Arkadaşlar": "Friends",
    "Arkadaşlar:": "Friends:",
    "Gruplar": "Groups",
    "+ Yeni": "+ New",
    "Henüz grup yok.": "No groups yet.",
    "Henüz kimse yok.": "No one here yet.",
    "İstekler sekmesinden arkadaş ekle!": "Add friends from the Requests tab!",
    "İstekler": "Requests",
    "Gelen İstekler": "Incoming Requests",
    "Yeni İstek": "New Request",
    "İstek gönderildi.": "Request sent.",
    "Arkadaş Ekle": "Add Friend",
    "İsim veya Totem kodu...": "Name or Totem code...",
    "En az 1 arkadaş seç.": "Select at least 1 friend.",
    "Önce arkadaş ekleyin.": "Add a friend first.",
    "Önce bir sohbet seçin.": "Select a chat first.",
    "Mesajlaşmak için soldan bir sohbet seçin.": "Select a chat on the left to start messaging.",
    "Sohbeti aç": "Open chat",
    "Arkadaşlıktan çıkar": "Remove friend",
    "🗑️ Arkadaşlıktan Çıkar": "🗑️ Remove Friend",
    "Arkadaşlık Bitti": "Friendship Ended",
    "Arkadaşların kısa süre içinde görecek.": "Your friends will see this shortly.",
    "Engellenmiş Kullanıcılar": "Blocked Users",
    "Engellenmiş kullanıcı yok.": "No blocked users.",
    "Engel Kaldırıldı": "Unblocked",
    "Çıkarıldı": "Removed",
    "Menü": "Menu",
    "Ara": "Search",
    "Mesajlarda Ara": "Search Messages",
    "Mesajlarda ara...": "Search messages...",
    "Aramak istediğiniz kelimeyi yazın...": "Type the word you want to search for...",
    "🟢 Şu an çevrimiçi": "🟢 Currently online",
    "(hiç bağlantı yok)": "(no connections)",
    "Az önce": "Just now",
    "dk önce": "min ago",
    "Çevrimiçi": "Online",
    "Çevrimdışı": "Offline",
    "Uzakta": "Away",
    "Meşgul": "Busy",
    "Müsait": "Available",
    "Rahatsız Etme": "Do Not Disturb",
    "🔴 Meşgul": "🔴 Busy",
    "🟢 Müsait": "🟢 Available",
    "🟣 Rahatsız Etme": "🟣 Do Not Disturb",
    "Durum": "Status",
    "Özel Durum": "Custom Status",
    "Özel durum yok — yukarıdan ekle": "No custom status — add one above",
    "✅ Durum güncellendi!": "✅ Status updated!",
    "0 üye": "0 members",
    "Üyeler": "Members",
    "· Yönetici": "· Admin",
    "Yöneticiler:": "Admins:",
    "Yöneticisin": "You're an admin",
    "Yönetici Oldun!": "You're now an admin!",
    "Yönetici Yapıldı": "Made Admin",
    "Yöneticilik Devredildi": "Admin Rights Transferred",
    "Artık bu grubun yöneticisisin.": "You're now this group's admin.",
    "Üye Eklendi": "Member Added",
    "Üye Çıkarıldı": "Member Removed",
    "Yönetici Ayarları": "Admin Settings",
    "Grup detayı / ayrıl": "Group details / leave",
    "🚪 Gruptan Çık": "🚪 Leave Group",
    "Gruptan Ayrıldın": "You Left the Group",
    "Gruptan Çıkarıldın": "You Were Removed from the Group",
    "Gruptan çıkarıldınız — arama sonlandı.": "You were removed from the group — call ended.",
    "Yeni Grup Oluştur": "Create New Group",
    "Grubu Kur": "Create Group",
    "Grup Adı": "Group Name",
    "Yeni grup adı": "New group name",
    "Grup adı boş olamaz.": "Group name can't be empty.",
    "Grup Adı Güncellendi": "Group Name Updated",
    "🖼️ Grup Fotoğrafı Değiştir": "🖼️ Change Group Photo",
    "Grup Fotoğrafı Güncellendi": "Group Photo Updated",
    "Fotoğraf değiştir (sadece yönetici)": "Change photo (admin only)",
    "Hesabı Kaldır": "Remove Account",
    "🗑️ Hesabı Kalıcı Sil": "🗑️ Permanently Delete Account",
    "🚪 Çıkış Yap": "🚪 Log Out",

    // ── Profile / Settings ────────────────────────────────────────
    "Profil": "Profile",
    "🖼️ Profil Fotoğrafını Değiştir": "🖼️ Change Profile Photo",
    "Fotoğraf değiştir": "Change photo",
    "Fotoğraf Güncellendi": "Photo Updated",
    "Kimlik Güncellendi": "Identity Updated",
    "Totem: ...": "Totem: ...",
    "🔑 Totem Kodun": "🔑 Your Totem Code",
    "Kopyalandı": "Copied",
    "Ayarlar": "Settings",
    "⚙️ Ayarlar": "⚙️ Settings",
    "Görünüm": "Appearance",
    "Koyu": "Dark",
    "🌙 Koyu Mod": "🌙 Dark Mode",
    "Tema değiştir": "Change theme",
    "Hesap": "Account",
    "Bağlantı": "Connection",
    "İstatistikler": "Statistics",
    "📊 Mesaj İstatistikleri": "📊 Message Statistics",
    "📊 Mesaj İstatistiklerim": "📊 My Message Statistics",
    "En çok konuştuğun kişiler": "People you talk to most",
    "Günlük aktivite dağılımı": "Daily activity breakdown",
    "📤 Gönderilen": "📤 Sent",
    "📥 Alınan": "📥 Received",
    "🎙️ Ses mesajı": "🎙️ Voice message",
    "💬 Mesaj Gönder": "💬 Send Message",
    "Henüz kimse görmedi": "No one has seen this yet",
    "🎆 Mesaj Efektleri": "🎆 Message Effects",
    "Beta 3.5": "Beta 3.5",
    "WebRTC P2P Bağlantıları": "WebRTC P2P Connections",
    "Mesajlar P2P — broker görmez (WebRTC DC)": "Messages are P2P — the broker never sees them (WebRTC DC)",
    "İzin Reddedildi": "Permission Denied",
    "İzinler Verildi": "Permissions Granted",
    "Yetki Alındı": "Permission Granted",

    // ── Chat area / composer ─────────────────────────────────────
    "Mesajınızı yazın...": "Type your message...",
    "Gönder": "Send",
    "Gönder ✈": "Send ✈",
    "Cevapla": "Reply",
    "Yanıtla": "Reply",
    "↩ Yanıtlanıyor:": "↩ Replying to:",
    "Mesajı düzenle:": "Edit message:",
    "Düzenle": "Edit",
    "Bu mesajı herkesten silmek istiyor musun?": "Do you want to delete this message for everyone?",
    "Bu mesaj silindi": "This message was deleted",
    "Mesaj Gönderilemedi": "Message Could Not Be Sent",
    "Emoji": "Emoji",
    "Yüzler": "Faces",
    "GIF": "GIF",
    "GIF Gönder": "Send GIF",
    "🎬 GIF Gönder": "🎬 Send GIF",
    "GIF URL'si yapıştır (tenor.com, giphy.com...)": "Paste a GIF URL (tenor.com, giphy.com...)",
    "Yalnızca Tenor, Giphy veya Imgur bağlantılarına izin veriliyor.": "Only Tenor, Giphy, or Imgur links are allowed.",
    "Galeri": "Gallery",
    "Dosya/Resim Gönder": "Send File/Image",
    "Dosyayı buraya bırak": "Drop the file here",
    "Max 10MB · Resim, video, PDF, müzik...": "Max 10MB · Image, video, PDF, music...",
    "Dosya Çok Büyük": "File Too Large",
    "Belge": "Document",
    "Müzik": "Music",
    "Sesli mesaj (basılı tut)": "Voice message (press and hold)",
    "Anket": "Poll",
    "📊 Anket Oluştur": "📊 Create Poll",
    "Soru...": "Question...",
    "Seçenek 1": "Option 1",
    "Seçenek 2": "Option 2",
    "+ Seçenek Ekle": "+ Add Option",
    "Anketi Gönder 📊": "Send Poll 📊",
    "Kaybolucak Mesaj": "Disappearing Message",
    "Süreli": "Timed",
    "Süreli Mesaj": "Timed Message",
    "⏱️ Kaybolucak mesaj modu açık": "⏱️ Disappearing message mode is on",
    "10 sn": "10 sec",
    "30 sn": "30 sec",
    "1 dk": "1 min",
    "5 dk": "5 min",
    "1 saat": "1 hour",
    "Özel Mesaj": "Private Message",
    "🔒 Mesaj geçmişinizi görmek için şifrenizi tekrar girin.": "🔒 Re-enter your password to view your message history.",
    "🔒 Güvenlik kodu (göster)": "🔒 Security code (show)",

    // ── Calls / screen share ─────────────────────────────────────
    "Görüntülü": "Video",
    "Görüntülü Ara": "Video Call",
    "Sesli Ara": "Voice Call",
    "Sesli arama geliyor...": "Incoming voice call...",
    "Çağrılıyor": "Calling",
    "Aramayı Kapat": "Close Call",
    "Aramayı İptal Et": "Cancel Call",
    "Reddet": "Decline",
    "Kabul Et": "Accept",
    "Kamera Aç/Kapat": "Toggle Camera",
    "Kamera Aç": "Turn On Camera",
    "Kamerayı Kapat": "Turn Off Camera",
    "Kamera Hatası": "Camera Error",
    "Kamera açılamadı, yalnızca sesli devam ediliyor.": "Couldn't open camera, continuing audio-only.",
    "Kamera izni alınamadı veya cihaz bulunamadı.": "Couldn't get camera permission or no device found.",
    "Kamera kapatıldı.": "Camera turned off.",
    "📷 Kamera kapatıldı (arama bitti)": "📷 Camera turned off (call ended)",
    "Mikrofon": "Microphone",
    "Mikrofon başka bir uygulama tarafından kullanılıyor.": "Microphone is being used by another app.",
    "Mikrofon bulunamadı.": "Microphone not found.",
    "Mikrofon bulunamadı. Cihazı bağlı olduğundan emin ol.": "Microphone not found. Make sure the device is connected.",
    "Mikrofon erişimi reddedildi. Tarayıcı ayarlarından izin ver.": "Microphone access denied. Allow it from your browser settings.",
    "Mikrofon izni alınamadı, yalnızca görüntü gönderilecek.": "Couldn't get microphone permission, video-only will be sent.",
    "Mikrofon izni alınamadı.": "Couldn't get microphone permission.",
    "🎤 Mikrofon izni olmadan arama yapılamaz.": "🎤 Can't make a call without microphone permission.",
    "🎤 Mikrofon kapatıldı (arama bitti)": "🎤 Microphone turned off (call ended)",
    "Bu tarayıcı/bağlantı mikrofonu desteklemiyor (HTTPS gerekli olabilir).": "This browser/connection doesn't support the microphone (HTTPS may be required).",
    "Aramalar için tarayıcı ayarlarından izin verebilirsin.": "You can grant permission for calls from your browser settings.",
    "✅ Mikrofon ve kamera hazır. Artık arayabilirsin.": "✅ Microphone and camera are ready. You can call now.",
    "Ses": "Audio",
    "Hoparlör": "Speaker",
    "Hoparlör ": "Speaker ",
    "🔊 Varsayılan Hoparlör": "🔊 Default Speaker",
    "Cihaz listesi alınamadı:": "Couldn't get device list:",
    "Ekran Paylaş": "Share Screen",
    "⏹ Paylaşımı Durdur": "⏹ Stop Sharing",
    "Ekran Paylaşımı": "Screen Sharing",
    "Ekran Paylaşılıyor": "Screen Being Shared",
    "Ekran paylaşımı başlatılamadı:": "Couldn't start screen sharing:",
    "Ekran track hatası:": "Screen track error:",
    "Görüntülü arama başladı 📷": "Video call started 📷",
    "Çağrıyı sonlandırdınız.": "You ended the call.",
    "Arama arka planda sürdürülüyor. Geri dönmek için tekrar arayın.": "The call is continuing in the background. Call again to return.",
    "Arama zaten başlatılıyor, atlanıyor.": "Call is already starting, skipping.",
    "🔙 Aramaya Dön": "🔙 Return to Call",
    "📞 Aktif Arama": "📞 Active Call",
    "📞 Aktif Grup Araması": "📞 Active Group Call",
    "📞 Aramaya Katıl": "📞 Join Call",
    "Küçült": "Minimize",
    "Büyüt": "Maximize",
    "⛶ Tam Ekran": "⛶ Full Screen",
    "Çift tıkla: Tam Ekran": "Double-click: Full Screen",
    "Cevapsız Arama": "Missed Call",
    "· Süre:": "· Duration:",
    "Süre:": "Duration:",
    "kapatıldı": "closed",
    "sonlandırdınız": "ended",
    "kullanıcı": "user",
    "Yayın kalitesi": "Stream quality",
    "📶 Yayın Kalitesi": "📶 Stream Quality",
    "📶 Ağ Kalitesi": "📶 Network Quality",
    "Otomatik moda geçildi": "Switched to Auto mode",
    "İzleniyor...": "Watching...",

    // ── Connection / network status & errors ─────────────────────
    "● Bağlanıyor...": "● Connecting...",
    "Bağlanıyor...": "Connecting...",
    "Ağa bağlanılıyor...": "Connecting to network...",
    "● Ağa Bağlı": "● Connected to Network",
    "● Bağlantı Kesildi": "● Disconnected",
    "Bağlantı Hatası": "Connection Error",
    "Bağlantı kurulamadı.": "Couldn't establish connection.",
    "⚠️ Bağlantı Hatası": "⚠️ Connection Error",
    "⚠️ Bağlantı kesildi": "⚠️ Connection lost",
    "⚠️ Güvenlik Uyarısı": "⚠️ Security Warning",
    "⚠️ ICE başarısız": "⚠️ ICE failed",
    "⚠️ Yapılandırma Hatası": "⚠️ Configuration Error",
    "✅ Bağlantı kuruldu:": "✅ Connection established:",
    "❌ Bağlantı başarısız (ICE restart sonrası).": "❌ Connection failed (after ICE restart).",
    "❌ Bağlantı kurulamadı.": "❌ Couldn't establish connection.",
    "❌ Bağlantı yeniden kurulamadı (zaman aşımı).": "❌ Couldn't reconnect (timed out).",
    "❌ ICE başarısız:": "❌ ICE failed:",
    "❌ ICE restart başarısız.": "❌ ICE restart failed.",
    "ICE başarısız — yeniden bağlanılıyor...": "ICE failed — reconnecting...",
    "ICE hazırlanıyor...": "Preparing ICE...",
    "ICE yeniden bağlanıyor...": "ICE reconnecting...",
    "Sınırlı bağlantı (TURN yok — sunucu hatası)": "Limited connection (no TURN — server error)",
    "Uzak bağlantı çalışmayabilir.": "The remote connection may not work.",
    "Sunucu ayarları alınamadı, tekrar denenecek.": "Couldn't fetch server settings, will retry.",
    "MQTT kütüphanesi yüklenemedi. Sayfa yenileyin.": "Couldn't load the MQTT library. Please refresh the page.",
    "getDB parse hatası, backup deneniyor:": "getDB parse error, trying backup:",
    "Backup\\'tan kurtarıldı:": "Restored from backup:",
    "Oturum restore hatası:": "Session restore error:",
    "🔐 Yeni Güvenli Bağlantı": "🔐 New Secure Connection",
    "için yeni anahtar kabul edildi.": "a new key was accepted for.",
    "için yeni güvenlik anahtarı kabul edildi.": "a new security key was accepted for.",
    "için pinlenen kimlik anahtarıyla eşleşmiyor.": "doesn't match the pinned identity key for.",
    "\" için kimlik doğrulanamadı, bağlantı kurulmadı.": "\" could not be verified, connection not established.",
    "\" için kimlik doğrulanamadı, bağlantı reddedildi.": "\" could not be verified, connection rejected.",
    "— atlandı": "— skipped",

    // ── Misc labels seen in HTML frame ────────────────────────────
    "İptal": "Cancel",
    "Ekle": "Add",
    "Kaydet": "Save",
    "Kapat": "Close",
    "Geri": "Back",
    "Sil 🗑️": "Delete 🗑️",
    "openchat": "openchat",
  };

  // Build a single regex from all keys, longest-first so full
  // phrases win over their own shorter substrings. Each key also
  // gets a Turkish-aware word-boundary check (JS's built-in \b
  // doesn't understand ç/ğ/ı/ö/ş/ü) so a short key like "Ara" can
  // never eat part of an unrelated word like "Arama".
  const TR_WORD = "A-Za-zÇçĞğİıÖöŞşÜü0-9_";
  const isWordChar = ch => new RegExp('['+TR_WORD+']').test(ch);
  const keys = Object.keys(DICT).sort((a,b)=>b.length-a.length);
  const parts = keys.map(k=>{
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pre = isWordChar(k[0]) ? '(?<!['+TR_WORD+'])' : '';
    const post = isWordChar(k[k.length-1]) ? '(?!['+TR_WORD+'])' : '';
    return pre+esc+post;
  });
  const RE = new RegExp(parts.join('|'), 'g');

  function translateStr(s){
    if(!s) return s;
    return s.replace(RE, m => DICT[m] !== undefined ? DICT[m] : m);
  }
  window._t = translateStr; // exposed in case app.js-side code wants it later

  const ATTRS = ['title','placeholder','aria-label'];

  function translateEl(el){
    if(el.nodeType!==1) return;
    for(const a of ATTRS){
      if(el.hasAttribute && el.hasAttribute(a)){
        const v = el.getAttribute(a);
        const nv = translateStr(v);
        if(nv!==v) el.setAttribute(a, nv);
      }
    }
  }

  function translateTextNode(node){
    const v = node.nodeValue;
    if(!v || !v.trim()) return;
    const nv = translateStr(v);
    if(nv!==v) node.nodeValue = nv;
  }

  function translateSubtree(root){
    if(root.nodeType===3){ translateTextNode(root); return; }
    if(root.nodeType!==1) return;
    translateEl(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while((n = walker.nextNode())) translateTextNode(n);
    // also translate attrs on all descendants
    root.querySelectorAll && root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(translateEl);
  }

  function syncLangSelect(){
    const sel = document.getElementById('langSelect');
    if(sel) sel.value = window.SV_LANG;
  }

  function init(){
    translateSubtree(document.body);
    syncLangSelect();
    const mo = new MutationObserver(muts=>{
      for(const m of muts){
        if(m.type==='childList'){
          m.addedNodes.forEach(translateSubtree);
        } else if(m.type==='characterData'){
          translateTextNode(m.target);
        } else if(m.type==='attributes'){
          translateEl(m.target);
        }
      }
    });
    mo.observe(document.body, {
      childList:true, subtree:true, characterData:true,
      attributes:true, attributeFilter: ATTRS
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
