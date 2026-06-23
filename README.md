**🚀 OpenChat**


**OpenChat""; merkezi bir veritabanı sunucusuna ihtiyaç duymadan, tamamen Serverless (Sunucusuz) mimari üzerinde çalışan, Peer-to-Peer (P2P) ve Uçtan Uca Şifreli (E2EE) modern bir WebRTC mesajlaşma uygulamasıdır.

Mesajlarınız ve verileriniz hiçbir merkezi sunucuya uğramaz; doğrudan tarayıcıdan tarayıcıya (cihazdan cihaza) kriptografik olarak şifrelenmiş güvenli boru hatları (Data Channel) üzerinden akar.
-------------------------------------------
**📄 Lisans ve Özgür Kullanım (MIT License)**
Bu proje MIT Lisansı ile korunmaktadır. Projenin açık kaynak felsefesine ve topluluk gelişimine katkı sağlaması amacıyla, geliştiricilere ve teknoloji şirketlerine geniş haklar tanınmıştır.

Projeyi inceleyen, klonlayan veya forklayan herkes aşağıdaki haklara sahiptir:

Ticari ve Bireysel Kullanım: Bu kodları alıp kendi projelerinize (kurumsal veya bireysel fark etmeksizin) özgürce entegre edebilirsiniz.

Serbest Modifikasyon: Projenin tasarımını, backend işlevlerini, şifreleme altyapısını veya herhangi bir parçasını tamamen değiştirmekte, bozup yeniden inşa etmekte serbestsiniz.

Dağıtım Özgürlüğü: Kendi OpenChat versiyonunuzu oluşturup yayına alabilirsiniz. (Yalnızca kaynak kodun asıl sahibini belirtmek adına MIT lisans metnini korumanız yeterlidir.)
---------------------------------------------
**✨ Öne Çıkan Özellikler**
⚡ Tamamen P2P (Peer-to-Peer) Mimari: WebRTC teknolojisi sayesinde kullanıcılar arasında doğrudan bağlantı kurulur. Mesajlaşma anında aradaki sunucu yükü sıfıra iner.

🔒 Uçtan Uca Şifreleme (E2EE): Oturum açıldığı an tarayıcı belleğinde dinamik olarak ECDH (P-256) ve Ed25519 kriptografik anahtar çiftleri üretilir. Mesajlar yerel veritabanında bile asla düz metin (plaintext) olarak saklanmaz.

☁️ Serverless Sinyalleşme (Signaling): Kullanıcıların birbirini bulması için kullanılan sinyalleşme altyapısı Vercel Serverless Functions üzerinden güvenli bir şekilde yönetilir.

🛡️ Sıfır Gizli Sızıntısı (Zero-Secret Leak): MQTT Broker adresleri ve TURN/STUN (Metered.live) API anahtarları gibi kritik veriler kaynak kodda (frontend) kesinlikle barındırılmaz. Tamamı Vercel Environment Variables (Ortam Değişkenleri) arkasında maskelenmiştir.

🌐 Gelişmiş Güvenlik ve CSP: Sıkı bir Content Security Policy (CSP) yapısı kullanılarak XSS (Siteler arası kod çalıştırma) saldırıları tamamen engellenmiştir. Üretimde (Production) tarayıcı konsol logları otomatik olarak devre dışı bırakılır.

📱 PWA ve Akıllı Bildirimler: Aşamalı Web Uygulaması (PWA) desteği sayesinde cihaza yüklenebilir. Tarayıcı arka plandayken bile anlık yerel (native) bildirimler gönderir.
--------------------------------------------
**🛠️ Teknolojik Altyapı**
Frontend: Vanilla JavaScript (ES6+), HTML5, CSS3 (Custom Dark Theme)

Mesajlaşma & Veri İletimi: WebRTC (Peer-to-Peer Data Channels)

Sinyalleşme Protokolü (Signaling): MQTT (EMQX Broker üzerinden asenkron el sıkışma)

Backend Altyapısı: Node.js, Vercel Serverless Functions

NAT Geçişi (STUN/TURN): Metered.live API
---------------
**🏗️ Nasıl Çalışır?**
Güvenli Yapılandırma: Kullanıcı uygulamayı açtığında, frontend katmanı Vercel'deki /api/config ve /api/ice-servers.js uç noktalarına güvenli bir istek atarak şifreli broker bilgilerini ve dinamik TURN sunucu kimliklerini alır.

Kriptografik El Sıkışma: Kullanıcılar MQTT kanalı üzerinden birbirini benzersiz userId değerleriyle bulur ve kendi aralarında geçici (ephemeral) şifreleme anahtarlarını takas eder.

Doğrudan Tünel (P2P): El sıkışma bittiği an MQTT aradan çekilir. WebRTC tüneli açılır ve mesajlar doğrudan iki cihaz arasında akmaya başlar.
--------------------------------------------
**⚠️ Önemli Notlar ve Mimari Sınırlar (AI & P2P)**
Uygulamayı kullanırken veya üzerinde geliştirme yaparken projenin deneysel doğası gereği şu noktaları göz önünde bulundurmalısınız:

🤖 %100 AI Destekli Altyapı: Bu projenin mimarisi, kod yapısı ve optimizasyonları tamamen yapay zeka (AI) altyapısı desteğiyle baştan sona inşa edilmiştir. Yapay zekanın sunduğu bu ileri düzey ve dinamik kodlama yöntemi projeyi çok hızlı hale getirse de, deneysel doğasından ötürü bazen güvenlik konusunda ufak açıklar veya beklenmedik mantık hataları (edge cases) baş gösterebilir.

🌐 Eşzamanlı (Online) İletişim: Sistem tamamen Peer-to-Peer (P2P) mantığıyla çalıştığı için, kullanıcıların aynı anda online olması durumunda kusursuz ve en yüksek performansla çalışır.

📬 Çevrimdışı (Offline) Mesaj Kararsızlığı: Projede mesajları günlerce saklayan merkezi bir veritabanı sunucusu bulunmamaktadır. Bu nedenle, taraflar uzun süre offline (çevrimdışı) kaldığında veya tarayıcı bağlantıları tamamen koptuğunda, offline mesajların karşı tarafa zamanında aktarılamama veya kaybolma ihtimali mevcuttur.

🔒 Güvenli Veri Akışı (Hackera Geçit Yok): Sunucusuz (Serverless) mimari ve Uçtan Uca Şifreleme (E2EE) sayesinde, sistemde kod kaynaklı bir açık oluşsa dahi verileriniz asla üçüncü parti bir sunucuya akmaz. Ortada ele geçirilebilecek merkezi bir "mesaj veritabanı" yoktur. Veriler yalnızca iletişimdeki iki cihaz arasında kriptografik olarak barındırılır.

Geliştirici Notu: Bu proje, modern web protokollerinin sınırlarını zorlamak, sunucu maliyetlerini sıfıra indirerek uçtan uca güvenli ve sansürlenemez bir haberleşme kanalı oluşturmak amacıyla yapay zekanın gücüyle geliştirilmiştir. Tamamen açık, şeffaf ve geliştirilmeye hazırdır.


<img width="1917" height="907" alt="image" src="https://github.com/user-attachments/assets/090ad59c-24b7-4cab-8140-4740a6a000c6" />

<img width="1917" height="906" alt="image" src="https://github.com/user-attachments/assets/df15321b-869d-447d-9f24-9681d0b8e5f0" />

