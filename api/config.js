export default function handler(req, res) {
    // Güvenlik: Sadece GET isteklerine izin ver
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Yalnızca GET istekleri kabul edilir.' });
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
