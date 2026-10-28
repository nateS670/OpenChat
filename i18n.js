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
    const syncTr = ()=>{
      const sel=document.getElementById('langSelect');
      if(sel){
        sel.value='tr';
        if(!sel._svBound){ sel._svBound=true; sel.addEventListener('change', ()=>setSvLang(sel.value)); }
      }
    };
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
    "Paylaşımı Durdur": "Stop Sharing",
    "🔐 PBKDF2-SHA256 · Şifren ağa gitmez · Mesajlar P2P şifreli (WebRTC)": "🔐 PBKDF2-SHA256 · Your password never leaves your device · Messages are P2P encrypted (WebRTC)",
    "⏹ Paylaşımı Durdur": "⏹ Stop Sharing",
    "Ekran Paylaşımı": "Screen Sharing",
    "Ekran Paylaşılıyor": "Screen Being Shared",
    "Ekran paylaşımı başlatılamadı:": "Couldn't start screen sharing:",
    "Ekran track hatası:": "Screen track error:",

    // ── Message stats panel ───────────────────────────────────────
    "🌙 Gece": "🌙 Night",
    "🌅 Sabah": "🌅 Morning",
    "☀️ Öğle": "☀️ Afternoon",
    "🌆 Akşam": "🌆 Evening",
    "📎 Dosya": "📎 File",
    "En aktif saat: ": "Most active hour: ",
    "Bu saatte ": "At this hour, ",
    " mesaj — toplam ": " messages — total ",
    " mesaj": " messages",
    "Henüz mesaj yok.": "No messages yet.",

    // ── System / activity messages (name prefix + this suffix) ────
    " aramadan ayrıldı.": " left the call.",
    " aramayı reddetti.": " declined the call.",
    " arkadaşlık isteğini kabul etti.": " accepted the friend request.",
    " artık arkadaşın değil.": " is no longer your friend.",
    " artık engelli değil.": " is no longer blocked.",
    " artık yönetici değil.": " is no longer an admin.",
    " artık yönetici.": " is now an admin.",
    " bağlantısı kesildi.": " connection lost.",
    " ekranını paylaşıyor.": " is sharing their screen.",
    " engellenmiş.": " blocked.",
    " grup adını \"": " changed the group name to \"",
    " gruptan çıkarıldı.": " was removed from the group.",
    " ile bağlantı kesildi.": " disconnected.",
    " ile ilk kez konuşuyorsunuz. Güvenlik kodunu mümkünse başka bir kanaldan doğrulayın.": " — this is your first conversation. Verify the security code through another channel if possible.",
    " izni daha önce reddedildi — tarayıcı ayarlarından açman gerekebilir.": " permission was previously denied — you may need to enable it in your browser settings.",
    " için anahtar değişti.": " — security key changed.",
    " kişisini engellemek istiyor musun?": " — do you want to block this person?",
    " kişisini gruptan çıkarmak istiyor musun?": " — do you want to remove this person from the group?",
    " kişisini çıkarmak istiyor musun?": " — do you want to remove this person?",
    " kişi aktif": " people active",
    " kişi)": " people)",
    " kişi": " people",
    " listeden çıkarıldı.": " removed from the list.",
    " sizi listeden çıkardı.": " removed you from the list.",
    " sonuç": " results",
    " tarafından kapatıldı.": " — closed it.",
    " yeni yönetici oldu.": " is the new admin.",
    " zaten paylaşıyor.": " is already sharing.",
    " · Süre: ": " · Duration: ",
    " üye · ": " members · ",
    " Üye": " Member",
    " üye": " member",
    " şu anda başka bir aramada.": " is currently in another call.",
    "Çıkar": "Remove",
    " grubundan ayrıldınız.": " — you left the group.",
    " grubundan ayrılmak istiyor musun?": " — do you want to leave this group?",
    " grubundan çıkardı.": " — removed you from the group.",
    " hesabı kaldırıldı": " — account removed",
    " için sonuç bulunamadı.": ": no results found.",
    " olarak değiştirdi.": " (updated).",
    "% (Sağ tık: ayarla)": "% (Right-click to set)",
    "Video kalitesi ayarlandı: ": "Video quality set to: ",
    "ms Kayıp:": "ms Loss:",
    "Çağrı ": "Call ",
    "👥 Grup Araması · ": "👥 Group Call · ",
    "📞 Aramaya Katıl (": "📞 Join Call (",
    "📞 Grup araması sona erdi": "📞 Group call ended",
    "📵 Cevapsız arama · ": "📵 Missed call · ",
    "🔒 Çok fazla yanlış deneme! ": "🔒 Too many incorrect attempts! ",
    "Hiç grup yok.": "No groups at all.",
    " (düzenlendi)": " (edited)",
    "🔊 Aktif Arama — Katıl": "🔊 Active Call — Join",
    "Yüklenemedi": "Failed to load",
    "Seçenek ": "Option ",

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

    // ── Edge AI (in-browser Whisper + local LLM) ──────────────────
    "Canlı Altyazı (Whisper Tiny, tarayıcı içi)": "Live Captions (Whisper Tiny, in-browser)",
    "Karşı taraf konuşunca altyazı burada akar.": "Captions from the other person appear here.",
    "Whisper Tiny · tarayıcı içi · sunucusuz": "Whisper Tiny · in-browser · serverless",
    "Konuşulan dil (transkripsiyon)": "Spoken language (transcription)",
    "İngilizceye çevir (Whisper)": "Translate to English (Whisper)",
    "Türkçeye çevir (yerel LLM)": "Translate to Turkish (local LLM)",
    "Altyazı / çeviri": "Captions / translation",
    "AI Chat Butler — sohbeti cihazda özetle": "AI Chat Butler — summarize this chat on-device",
    "Mesajlar tarayıcı RAM'inde kalır": "Messages stay in browser RAM",
    "Uçtan uca şifre kırılmaz: özet buluta gitmez. Transformers.js + WebGPU ile Qwen2.5-0.5B (hızlı) veya Phi-3 Mini (daha güçlü, büyük indirme) bu cihazda çalışır.": "E2E encryption stays intact: the summary never goes to the cloud. Transformers.js + WebGPU run Qwen2.5-0.5B (fast) or Phi-3 Mini (stronger, large download) on this device.",
    "Hızlı · Qwen2.5 0.5B": "Fast · Qwen2.5 0.5B",
    "Güçlü · Phi-3 Mini (WebGPU)": "Strong · Phi-3 Mini (WebGPU)",
    "Özetle": "Summarize",
    "Önce bir sohbet aç.": "Open a chat first.",
    "Bu sohbette özetlenecek metin mesajı yok.": "No text messages to summarize in this chat.",
    "Hızlı taslak (cihaz içi, model öncesi):": "Quick draft (on-device, before the model):",
    "Özetlenecek metin yok.": "Nothing to summarize.",
    "mesaj cihazda hazır · model henüz çalışmadı": "messages ready on-device · model has not run yet",
    "Yerel model yükleniyor… mesajlar RAM’de kalır, sunucuya gitmez.": "Loading the local model… messages stay in RAM and never hit a server.",
    "Edge LLM çalışıyor…": "Edge LLM is running…",
    "Özet bu cihazda üretildi · mesajlar dışarı çıkmadı": "Summary produced on this device · messages never left",
    "Özetlenecek metin mesajı yok.": "No text messages to summarize.",
    "Özet üretilemedi.": "Couldn't produce a summary.",
    "Whisper Tiny yükleniyor": "Loading Whisper Tiny",
    "Whisper Tiny hazır · tarayıcı içi": "Whisper Tiny ready · in-browser",

    // ── Changelog / What's New modal ─────────────────────────────
    "Yenilikler": "What's New",
    "Sürüm 3.7": "Version 3.7",
    "Sürüm 3.6": "Version 3.6",
    "Eski sürüm": "Old version",
    "Yapay Zeka": "Artificial Intelligence",
    "✨ Yerel Yapay Zeka": "✨ On-device AI",
    "Canlı altyazı ve AI Chat Butler. Kapalıyken model hiç indirilmez / RAM kullanmaz.": "Live captions and AI Chat Butler. When off, no model is downloaded and no RAM is used.",
    "🖥️ GPU hızlandırma (WebGPU)": "🖥️ GPU acceleration (WebGPU)",
    "Hızlı ama daha çok bellek kullanır. Kapalıyken WASM (daha yavaş, daha az RAM) ile çalışır.": "Faster but uses more memory. When off, it runs on WASM (slower, less RAM).",
    "Ayarlar → Yerel Yapay Zeka anahtarını aç.": "Turn on Settings → On-device AI first.",
    "Sunucu ayarları alınamadı. Otomatik olarak yeniden denenecek.": "Server settings could not be loaded. Retrying automatically.",
    "⚙️ Yeni: Ayarlar → Yerel Yapay Zeka anahtarı — AI tamamen kapatılıp açılabilir; kapalıyken model indirilmez, worker açılmaz, RAM kullanılmaz": "⚙️ New: Settings → On-device AI switch — the AI can be turned off entirely; when off, no model is downloaded, no worker starts and no RAM is used",
    "🖥️ Yeni: Ayarlar → GPU hızlandırma (WebGPU) anahtarı — varsayılan kapalı (daha az bellek); açınca model GPU'da çalışıp hızlanır": "🖥️ New: Settings → GPU acceleration (WebGPU) switch — off by default (less memory); when on, the model runs on the GPU and is faster",
    "🔔 Bağlantı/yapılandırma hatalarında toast spam'i giderildi: tek bildirim + üstel geri çekilme (4s→60s), internet dönünce otomatik yeniden bağlanma": "🔔 Fixed notification spam on connection/config errors: one notification + exponential backoff (4s→60s), auto-reconnect when the network returns",
    "✨ Giriş/kayıt sonrası karşılama animasyonu — ekran yumuşakça oturur, avatarın ortada büyüyerek kısa bir \"Hoş geldin\" gösterir (hareket azaltma ayarına saygılı)": "✨ Welcome animation after sign-in/sign-up — the screen settles in smoothly and your avatar pops up with a short \"Welcome\" (respects reduced-motion)",
    "🎙️ Yeni: Canlı altyazı — aramalarda konuşulanlar Whisper Tiny ile tarayıcının içinde yazıya dökülür (WebGPU varsa hızlandırılır, yoksa WASM)": "🎙️ New: Live captions — speech in calls is transcribed inside the browser with Whisper Tiny (accelerated by WebGPU when available, otherwise WASM)",
    "🌍 Yeni: Altyazı çeviri modları — konuşulan dil, İngilizceye çeviri (Whisper) veya yerel LLM ile Türkçeye çeviri; arama sırasında canlı değiştirilebilir": "🌍 New: Caption translation modes — spoken language, translate to English (Whisper) or to Turkish with a local LLM; switchable during the call",
    "🔊 Altyazı için karşı tarafın sesi ayrı bir AudioWorklet ile yakalanır — hoparlöre hiç yönlendirilmez, çift ses/echo oluşmaz": "🔊 For captions the remote audio is tapped through a separate AudioWorklet — never routed to the speakers, so no double audio or echo",
    "✨ Yeni: AI Chat Butler — sohbeti cihazda özetler (Qwen2.5 0.5B hızlı, Phi-3 Mini güçlü); model henüz yüklenmemişse anında kural tabanlı özet gösterilir": "✨ New: AI Chat Butler — summarizes the chat on-device (Qwen2.5 0.5B for speed, Phi-3 Mini for quality); a rule-based draft appears instantly while the model loads",
    "🔒 Yapay zeka tamamen cihaz içi: mesajlar ve ses hiçbir sunucuya gitmez, sadece model dosyaları indirilir ve önbelleğe alınır (Transformers.js)": "🔒 The AI runs fully on-device: messages and audio never reach a server, only the model files are downloaded and cached (Transformers.js)",
    "⚙️ Otomatik geri düşme: WebGPU açılamazsa otomatik WASM'a, Phi-3 yüklenemezse Qwen2.5'e geçilir; model indirme yüzdesi canlı gösterilir": "⚙️ Automatic fallback: switches to WASM if WebGPU fails and to Qwen2.5 if Phi-3 can't load; model download progress is shown live",
    "🧹 Arama bitince altyazı otomatik kapanır, ses tamponları ve model işçisi temizlenir": "🧹 Captions stop automatically when a call ends; audio buffers and the model worker are cleaned up",
    "🔒 Kapsamlı güvenlik sıkılaştırması: mesaj bazlı imzalama, DataChannel/e2e kimlik sahteciliği koruması, grup yönetici yetki kontrolleri": "🔒 Extensive security hardening: per-message signing, DataChannel/e2e identity spoofing protection, group admin permission checks",
    "🛡️ CSP (Content Security Policy) sıkılaştırıldı; eksik güvenlik başlıkları ve SRI eklendi": "🛡️ Tightened the Content Security Policy; added missing security headers and SRI",
    "📋 Yeni: Kayıt/giriş sırasında kullanım şartları ve sistem bilgilendirme onayı": "📋 New: Terms of use and system notice acceptance during sign-up/sign-in",
    "🖥️ Nav rail: gruplar arası boşluk ve ince ayırıcılar eklendi, ayarlar ikonu hizalaması düzeltildi": "🖥️ Nav rail: added spacing and thin dividers between groups, fixed settings icon alignment",
    "📶 Bağlantı göstergesine üzerine gelince detaylı P2P/sinyal durumu gösteren tooltip eklendi": "📶 Added a tooltip on the connection indicator showing detailed P2P/signal status",
    "📞 Grup aramalarında bazı katılımcılara yeni gelen kişinin görünmemesi/duyulmaması sorunu giderildi": "📞 Fixed new joiners sometimes not being seen/heard by some participants in group calls",

    // ── Status strings produced by the Edge AI worker ─────────────
    "Model indiriliyor ·": "Downloading model ·",
    "Bilinmeyen hata": "Unknown error",
    "Edge AI worker hatası": "Edge AI worker error",

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
    if(sel && !sel._svBound){
      sel._svBound = true;
      sel.addEventListener('change', ()=>setSvLang(sel.value));
    }
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
