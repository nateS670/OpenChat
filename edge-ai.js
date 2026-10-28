/* OpenChat Edge AI — main thread. Whisper captions + local chat butler. */
(function(){
  // 🔌 [İSTEK] Yerel AI artık AĞDAN BAĞIMSIZ: özet ve sohbet tamamen cihazda,
  // sıfır indirme ile çalışır (inline "Butler" motoru). Transformers.js modeli
  // yalnızca internet varsa ARKA PLANDA hazırlanır; başarısız olursa hiçbir şey
  // bozulmaz, kullanıcı hiç hata görmez.
  const LLM_READY_KEY = 'sv_edge_llm_ready';

  function fetchWithTimeout(url, ms){
    return new Promise((resolve, reject)=>{
      const ctl = ('AbortController' in window) ? new AbortController() : null;
      const t = setTimeout(()=>{ try{ ctl && ctl.abort(); }catch(_){} reject(new Error('timeout')); }, ms);
      fetch(url, ctl ? { signal: ctl.signal } : {}).then(r=>{ clearTimeout(t); resolve(r); },
        e=>{ clearTimeout(t); reject(e); });
    });
  }

  // Model gerçekten bu cihaza indirildi mi? (10 sn'lik HEAD denemesi —
  // HF erişimi olmayan ağlarda sessizce 'hayır' döner.)
  async function llmCachedLocally(){
    if(localStorage.getItem(LLM_READY_KEY) === '1') return true;
    try{
      const url = 'https://huggingface.co/Xenova/tiny-random-RoFormerForTokenClassification/resolve/main/config.json';
      const r = await fetchWithTimeout(url, 10000);
      if(r && r.ok){ localStorage.setItem(LLM_READY_KEY, '1'); return true; }
    }catch(_){}
    return false;
  }

  // Butler panelindeki model seçimini gerçek kapasiteye göre güncelle:
  // internet/indirme yoksa ağır modeller seçilemez, "Hızlı · Cihaz içi" kalır.
  function updateModelAvailability(){
    const sel = $('aiButlerModel');
    if(!sel) return;
    llmCachedLocally().then(ok=>{
      Array.from(sel.options).forEach(o=>{
        if(o.value !== 'fast'){ o.disabled = !ok; o.text = ok ? o.text.replace(' · yakında','') : o.text.split(' ·')[0]+' · yakında'; }
      });
      if(!ok && sel.value !== 'fast') sel.value = 'fast';
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🧠 INLINE BUTLER MOTORU — %100 yerel, 0 MB indirme, her tarayıcıda çalışır.
  // ChatGPT gibi "akıl" değil; ama sohbet özeti çıkarır ve basit sohbet kurur.
  // Kullanıcının isteği de buydu: "ağır bir şey olmasına gerek yok".
  // ═══════════════════════════════════════════════════════════════════════
  const SVPatterns = [
    /\bsaat\s*(\d{1,2})[:.](\d{2})\b/, /\b(\d{1,2})[:.](\d{2})'de\b/, /\b(\d{1,2})[:.](\d{2})\b/,
    /\byarın(?:\s+gece)?\b/, /\bbugün(?:\s+gece)?\b/, /\btunçagün\b/,
    /\bpazartesi\b/, /\bsalı\b/, /\bçarşamba\b/, /\bperşembe\b/, /\bcuma\b/, /\bcumartesi\b/, /\bpazar\b/,
    /\b(\d{1,2})\s*(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b/i,
    /\bbuluş(?:aca|ıyor|alım)?\b/, /\bgörüş(?:ecek|elim|yor)?\b/, /\bkac(?:ırabilir)?\b/,
    /\bonay(?:ladı|lıyor)?\b|\bok\b|\btamam(?:dır)?\b|\bsöz\b/,
    /\biptal\b/, /\bertele(?:di|rim|iyor)?\b/, /\bkarar\b/, /\bhatırlat(?:ma|ırım)?\b/,
    /\buluş(?:uyoruz|acağız)?\b/, /\bgel(?:ir misin|eceğim|iyorum)?\b/,
    /\bkaçırma\b/, /\bsözleşme\b/, /\bdoğum günü\b/, /\bdavet(?:li)?\b/,
    /\bnere(de|si)?\b/, /\badres\b/, /\bkonum\b/, /\bmekan\b/, /\bofis\b/, /\bekspres\b/,
    /\bpara\b/, /\bfatura\b/, /\bödeme\b/, /\bkredi\b/, /\bborç\b/,
    /\btoplantı\b/, /\bders\b/, /\bsınav\b/, /\biş\b/, /\bproje\b/, /\bteslim\b/,
    /\bacele\b/, /\bagenda\b/, /\bnot\b/, /\bkargo\b/, /\bkurye\b/,
    /\bbütçe\b/, /\bzamanlama\b/, /\bplan\b/, /\bprogram\b/,
    /\bteşekkür(?:ler| ederim)?\b/, /\bbaş sağlığı\b/, /\bgeçmiş olsun\b/, /\btakasızlık\b/,
    /\bselam\b/, /\bmerhaba\b/, /\bgünaydın\b/, /\biyi akşamlar\b/, /\bgörüşürüz\b/, /\bbay bay\b/
  ];
  function svScore(t){
    let s = 0;
    for(const p of SVPatterns) if(p.test(t)) s++;
    if(/\d/.test(t)) s += .5;
    if(/!|\?\?$/.test(t)) s += .3;
    return Math.min(s, 6);
  }
  function normalizeTr(s){
    return String(s||'').toLowerCase()
      .replace(/ı/g,'i').replace(/İ/g,'i').replace(/Ş/g,'s').replace(/ş/g,'s')
      .replace(/Ğ/g,'g').replace(/ğ/g,'g').replace(/Ü/g,'u').replace(/ü/g,'u')
      .replace(/Ö/g,'o').replace(/ö/g,'o').replace(/Ç/g,'c').replace(/ç/g,'c');
  }
  const TR_STOPWORDS = new Set(['ve','veya','ama','fakat','ancak','ile','de','da','ki','mi','mı','bu','şu','o','ben','sen','biz','siz','onlar','bir','iki','üç','çok','az','daha','en','hep','hiç','yine','bile','gibi','için','dengan']);
  function extractKeywords(lines){
    const freq = new Map();
    for(const ln of lines){
      const words = normalizeTr(ln.t).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=4 && !TR_STOPWORDS.has(w));
      for(const w of new Set(words)) freq.set(w, (freq.get(w)||0)+1);
    }
    return [...freq.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([w])=>w);
  }
  function bucketize(lines){
    const out = [];
    let cur = null, curTime = 0;
    for(const ln of lines){
      if(ln.time && cur && (ln.time - curTime > 3600*5)){ cur = null; }
      if(!cur){ cur = { who: ln.who, msgs: [], first: ln.t, time: ln.time||0 }; out.push(cur); }
      else if(ln.who !== cur.who && cur.msgs.length >= 2){
        cur = { who: ln.who, msgs: [], first: ln.t, time: ln.time||0 }; out.push(cur);
      }
      cur.msgs.push(ln.t);
      if(ln.time) curTime = ln.time;
    }
    return out;
  }
  function fmtHM(ms){
    try{ const d = new Date(ms); return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0'); }catch(_){ return ''; }
  }
  function butlerSummarize(msgs){
    const texts = (msgs||[]).filter(m=>m && m.text && !m.sys)
      .map(m=>({ who: m.from || 'Biri', t: String(m.text).replace(/\s+/g,' ').trim(), time: Number(m.time)||0 }))
      .filter(m=>m.t.length>1);
    if(!texts.length) return 'Bu sohbette özetlenecek metin mesajı yok.';
    const meWho = (typeof ME!=='undefined' && ME && ME.user_id) ? ME.user_id : 'Sen';
    const others = [...new Set(texts.map(m=>m.who).filter(w=>w!==meWho))];
    const withStr = others.length ? others.slice(0,3).join(', ') + (others.length>3?'…':'') : 'karşı tarafla';
    const first = texts[0], last = texts[texts.length-1];
    const anyTime = texts.find(m=>m.time);
    let head = '🤖 Butler özeti ('+texts.length+' mesaj';
    if(anyTime && first.time && last.time && first.time!==last.time){
      head += ', '+fmtHM(first.time)+'–'+fmtHM(last.time);
    }
    head += ')';
    const lines = [];
    lines.push('Konu: '+withStr+' ile sohbet — '+texts.length+' mesaj.');
    const slots = [];
    for(const m of texts){
      const s = svScore(m.t);
      if(s>=1){
        const idx = slots.findIndex(x=>x.who===m.who && m.time-x.time < 3600*1000*6);
        if(idx>=0){ if(s>slots[idx].score){ slots[idx]={who:m.who,t:m.t,time:m.time,score:s}; } }
        else slots.push({who:m.who,t:m.t,time:m.time,score:s});
      }
    }
    slots.sort((a,b)=>b.score-a.score || a.time-b.time);
    if(slots.length){
      lines.push('⏰ Öne çıkanlar:');
      slots.slice(0,6).forEach(s=>lines.push('• '+(s.time?fmtHM(s.time)+' ':'')+s.who+': '+s.t.slice(0,160)));
    }
    const kw = extractKeywords(texts);
    if(kw.length) lines.push('🔑 Sık geçen kelimeler: '+kw.join(', ')+'.');
    const buckets = bucketize(texts);
    if(buckets.length>1){
      lines.push('🗂 Akış:');
      buckets.slice(-5).forEach(b=>{
        let t = b.first;
        if(b.msgs.length>1) t += ' (+'+(b.msgs.length-1)+' mesaj daha)';
        lines.push('• '+(b.time?fmtHM(b.time)+' ':'')+b.who+': '+t.slice(0,140));
      });
    }
    if(last.who===meWho && /\?$/.test(last.t)) lines.push('❓ Son mesajın bir soru — cevap bekliyor olabilir.');
    else if(last.who!==meWho && /(\?|\b(ne|nerede|saat|geliyor|cevap|yapacak|var mı)\b)/i.test(normalizeTr(last.t))) lines.push('⚠️ ' + last.who + ' senden yanıt bekliyor olabilir: "'+last.t.slice(0,120)+'"');
    return lines.join('\n');
  }
  function butlerChat(text, msgs){
    const q = normalizeTr(String(text||''));
    const has = (...ws)=>ws.some(w=>q.includes(w));
    const recent = (msgs||[]).filter(m=>m&&m.text&&!m.sys).slice(-40)
      .map(m=>({who:m.from||'Biri', t:String(m.text).replace(/\s+/g,' ').trim(), time:Number(m.time)||0}));
    const withStr = (()=>{ const o=[...new Set(recent.map(m=>m.who))].filter(w=>w!==(ME&&ME.user_id)); return o.length?o.slice(0,2).join(' ve '):null; })();
    if(!recent.length) return 'Bu sohbette henüz mesaj yok; konuşma başlayınca özet, hatırlatma ve arama yapabilirim. ✨';
    if(has('selam','merhaba','gunaydin','iyi aksamlar','naber','nasilsin'))
      return 'Selam! Ben cihazından çıkmayan yerel asistanın. Bu sohbette neler geçtiğini özetleyebilirim, "şunu ara" diyebilirsin ya da "son ne dedi?" diye sorabilirsin.';
    if(has('ozet','neler gec','ne konus','ne oldu','akisi','topla'))
      return butlerSummarize(msgs);
    if(has('saat kac','toplanti saat','bulusma saat','ne zaman bulus')){
      const hits = recent.filter(m=>svScore(m.t)>=1).slice(-3);
      return hits.length ? 'Saat/tarih geçiyor: '+hits.map(h=>h.who+': "'+h.t.slice(0,90)+'"').join(' · ') : 'Mesajlarda net bir saat/tarih göremedim.';
    }
    if(has('son ne','en son','ne yazdi','ne soyledi','son mesaj')){
      const m = recent[recent.length-1];
      return 'Son mesaj ('+(m.time?fmtHM(m.time)+' ':'')+m.who+'): "'+m.t.slice(0,180)+'"';
    }
    if(has('hatirlat','bekleyen','yanit bek','cevap lazim','acil')){
      const openQ = recent.slice(-12).filter(m=>/\?/.test(m.t)).slice(-3);
      if(openQ.length) return 'Bekleyen sorular:\n'+openQ.map(m=>'• '+m.who+': '+m.t.slice(0,140)).join('\n');
      return 'Açık kalan bir soru görmüyorum; istersen sohbeti özetleyeyim.';
    }
    const am = q.match(/(.{2,40}?)\s+(ara|gecer|gecti|nerede|var mi|ardi?|bulunuyor)/);
    if(am){
      const term = am[1].trim();
      if(term.length>=2){
        const hits = recent.filter(m=>normalizeTr(m.t).includes(term)).slice(-4);
        if(!hits.length) return '"'+term+'" için sonuç yok.';
        return '"'+term+'" ('+hits.length+' mesaj):\n'+hits.map(m=>'• '+(m.time?fmtHM(m.time)+' ':'')+m.who+': '+m.t.slice(0,140)).join('\n');
      }
    }
    if(has('kac mesaj','nekadardir')) return recent.length+' mesaj var'+(withStr?(' ('+withStr+' ile)'):'')+'.';
    const cm = q.match(/kim (.*) dedi|kim soledi|kim (.*) yazdi/);
    if(cm){
      const term = normalizeTr((cm[1]||cm[2]||'').replace(/\s+(dedi|soledi|yazdi)$/,''));
      const hit = recent.filter(m=>term && normalizeTr(m.t).includes(term)).slice(-1)[0];
      return hit ? hit.who+' şöyle demiş: "'+hit.t.slice(0,160)+'"' : 'Kimin söylediğini bulamadım — kelimeyi tam yazmayı dener misin?';
    }
    if(has('tesekkur','sagol','eyvallah')) return 'Rica ederim! Hepsi bu cihazda kaldı, hiçbir mesaj dışarı gitmedi. 😊';
    // 🔌 [İSTEK] Butler'a yazılanı gerçek sohbete gönderme:
    // "şunu mesaja at / sohbetle paylaş" gibi komutlar veya paneldeki 📤
    // butonu ile kullanıcı AI cevabını doğrudan karşı tarafa yollayabilir.
    if(has('mesaja at','sohete at','sohbete at','paylas gonder','gonder at','mesaj olarak gonder')){
      const m = recent[recent.length-1];
      queueSendToChat(m ? m.t : text);
      return '📤 Mesaj sohbete gönderiliyor: "'+String(m?m.t:text).slice(0,80)+'"';
    }
    if(has('neden calismiyor','hata','bozuk')) return 'Ben yerel (cihaz içi) asistanım; mesajların sunucuya gitmez. Bir sorun varsa kapatıp açmayı veya sayfayı yenilemeyi deneyebilirsin.';
    const stopRe = /[.,!?;:]|\b(bu|su|icin|hakkinda|hakkinda|ve|ile|de|da|mi|bir)\b/g;
    const terms = q.replace(stopRe,' ').split(/\s+/).filter(w=>w.length>=4 && !TR_STOPWORDS.has(w)).slice(0,4);
    if(terms.length){
      const hits = recent.filter(m=>{ const n=normalizeTr(m.t); return terms.some(t=>n.includes(t)); }).slice(-3);
      if(hits.length) return 'Şunlar ilgili görünüyor:\n'+hits.map(m=>'• '+m.who+': '+m.t.slice(0,140)).join('\n')+'\n\nİstersen tüm sohbeti özetleyeyim — "özetle" demen yeterli.';
    }
    return 'Bunu tam anlayamadım 🤔. Şunları yapabilirim:\n• "özetle" — sohbetin özeti\n• "son ne dedi?" — en son mesaj\n• "<kelime> ara" — sohbette arama\n• "hatırlatmalar" — bekleyen sorular';
  }

  // ✨ [3.7] Ayarlar → "Yerel Yapay Zeka" anahtarı. Kapalıyken hiçbir model
  // indirilmez, worker oluşturulmaz, RAM kullanılmaz. Tercih cihazda saklanır.
  const AI_KEY = 'sv_edge_ai';
  const AI_GPU_KEY = 'sv_edge_ai_gpu';
  let aiEnabled = localStorage.getItem(AI_KEY) === '1';
  let gpuEnabled = localStorage.getItem(AI_GPU_KEY) === '1';
  const taps = new Map();
  const pending = new Map();
  let worker = null;
  let captionsOn = false;
  let captionLines = [];
  // 🔧 [FIX] Whisper indirmesi bir kez başarısız olursa kilitlenir; kullanıcı
  // altyazı butonuna tekrar basana kadar sessiz kalınır (konsol "Failed to
  // fetch" döngüsünün kökü buydu).
  let asrFailedOnce = false;
  // 🔌 LLM yalnızca kullanıcı fiilen model indirmeyi başlattıysa (altyazı/derin
  // özet) ve tamamlanınca kullanılır; asla otomatik indirilmez.
  let llmLoaded = false;
  // 🔧 [FIX] WebGPU gerçek kapasite tespiti (async). Eskiden sadece
  // navigator.gpu'nun varlığına bakılıyordu; bazı tarayıcılarda (ör. iOS
  // Safari) navigator.gpu tanımlı olup requestAdapter() null döndürüyor —
  // bu yüzden kullanıcı "GPU seçilemiyor / çalışmıyor" görüyordu.
  let gpuAvailable = false;

  async function detectWebgpu(){
    try{
      if(!navigator.gpu) return false;
      const ad = await navigator.gpu.requestAdapter();
      return !!ad;
    }catch(_){ return false; }
  }
  detectWebgpu().then(ok=>{
    gpuAvailable = ok;
    if(!ok && gpuEnabled){
      // Cihaz GPU desteklemiyor → tercih WASM'a düşürülür (model zaten
      // worker içinde de wasm'a fallback yapıyor, artık UI da dürüst gösterir).
      gpuEnabled = false;
      localStorage.setItem(AI_GPU_KEY, '0');
    }
    window.edgeAISyncSettings();
  });

  function isMobileUi(){
    try{ return window.matchMedia('(max-width:768px)').matches; }catch(_){ return false; }
  }

  function $$(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // 📱 [İSTEK] Mobilde Ayarlar panelinden AI seçenekleri kaldırılır.
  // CSS'teki .ai-settings-only kuralları asıl kaynak; buradaki JS sadece
  // masaüstüne dönüşte inline style'ı temizler.
  function applyMobileSettings(){
    const mobile = isMobileUi();
    $$('#settingsPanel .ai-settings-only').forEach(el=>{
      if(!mobile) el.style.display = '';
    });
  }
  window.addEventListener('resize', applyMobileSettings);

  function $(id){ return document.getElementById(id); }

  // 🔧 Anahtarlar artık inline onchange="toggleEdgeAI()" attribute'u yerine
  // addEventListener ile bağlanıyor — CSP'nin 'unsafe-hashes' + SHA-256
  // listesi gerektirmeden %100 güvenilir çalışır. Eskiden hash listesi
  // bozulduğu için anahtara dokununca konsolda CSP hatası çıkıyordu ve
  // "Yerel Yapay Zeka çalışmıyor" görüntüsü oluşuyordu.
  function bindToggleListeners(){
    const a = $('toggleEdgeAI');
    const g = $('toggleEdgeAIGpu');
    if(a && !a.dataset.svBound){ a.dataset.svBound='1'; a.addEventListener('change', ()=> window.toggleEdgeAI()); }
    if(g && !g.dataset.svBound){ g.dataset.svBound='1'; g.addEventListener('change', ()=> window.toggleEdgeAIGpu()); }
  }

  // Anahtar kapalıyken AI butonlarını gizle — kullanıcı boşuna tıklamasın.
  function applyAiUi(){
    const but = $('aiButlerBtn');
    const cap = $('liveCaptionBtn');
    if(but) but.style.display = aiEnabled ? '' : 'none';
    if(cap) cap.style.display = aiEnabled ? '' : 'none';
    const panel = $('aiButlerPanel');
    if(panel && !aiEnabled) panel.classList.add('hidden');
    const bar = $('liveCaptionBar');
    if(bar && !aiEnabled) bar.classList.add('hidden');
    // 🤖 [İSTEK] Sohbet başlığında kişi adının hemen yanındaki ✨ rozeti ve
    // mesaj arama çubuğundaki ✨ butonu — Yerel AI açıkken görünür olur.
    $$('.sv-ai-header-btn').forEach(el=>{ el.style.display = aiEnabled ? '' : 'none'; });
    $$('.sv-ai-search-btn').forEach(el=>{ el.style.display = aiEnabled ? '' : 'none'; });
  }

  // Ayarlar paneli her açıldığında app.js çağırır (toggleSettings).
  window.edgeAISyncSettings = function(){
    bindToggleListeners(); // inline onchange CSP'ye takılmasın diye garantilenir
    applyMobileSettings();
    const a = $('toggleEdgeAI');
    const g = $('toggleEdgeAIGpu');
    if(a) a.checked = aiEnabled;
    if(g){
      g.checked = gpuEnabled;
      // 🔧 [FIX] GPU anahtarı artık sadece "Yerel AI açık"ken engelli.
      // WebGPU desteklenmeyen cihazlarda da tıklanabilir kalır; tıklanınca
      // worker WASM'a düşer ve kullanıcı toast ile bilgilendirilir
      // (eskiden disabled olduğu için "seçilemiyor" görünüyordu).
      g.disabled = !aiEnabled;
      const hint = $('edgeAIGpuHint');
      if(hint){
        if(!gpuAvailable) hint.textContent = 'Bu cihazda/tarayıcıda WebGPU kullanılamıyor — model otomatik olarak WASM (CPU) ile çalışır.';
        else if(!aiEnabled) hint.textContent = 'Önce Yerel Yapay Zeka anahtarını aç.';
        else hint.textContent = 'Hızlı ama daha çok bellek kullanır. Kapalıyken WASM (daha yavaş, daha az RAM) ile çalışır.';
      }
    }
  };

  function disableAi(){
    try{ setCaptions(false); }catch(_){}
    if(worker){ try{ worker.terminate(); }catch(_){} worker = null; }
    pending.clear();
    captionLines = [];
    aiEnabled = false;
    try{ localStorage.setItem(AI_KEY, '0'); }catch(_){}
    applyAiUi();
  }

  window.toggleEdgeAI = function(){
    // 📱 Mobilde bu satır gizli; localStorage tek gerçek kaynak olsun diye
    // DOM'daki checked yerine her zaman mevcut değerin tersi alınır.
    const on = !aiEnabled;
    if(on){
      // 🔧 [FIX] Worker oluşturma başarısız olursa (CSP / dosya erişimi /
      // eski tarayıcı) anahtar yine de açılır ama kullanıcı dürüst uyarılır;
      // eskiden hata sessizce havada kalıyordu → "çalışmıyor" izlenimi.
      let ok = true;
      try{
        ensureWorker();
        worker.postMessage({ type:'set-gpu', on: gpuEnabled });
      }catch(e){
        ok = false;
        console.warn('[EdgeAI] worker başlatılamadı:', e);
      }
      aiEnabled = true;
      try{ localStorage.setItem(AI_KEY, '1'); }catch(_){}
      applyAiUi();
      if(typeof showToast==='function'){
        if(ok) showToast('✨ Yerel Yapay Zeka', 'Açık — model ilk kullanımda bu cihaza indirilir.');
        else showToast('✨ Yerel Yapay Zeka', 'Anahtar açık ama AI motoru başlatılamadı (tarayıcı/CSP engeli). Sayfayı yenileyip tekrar deneyin.');
      }
    } else {
      disableAi();
      if(typeof showToast==='function') showToast('Yerel Yapay Zeka', 'Kapatıldı — model bellekten bırakıldı.');
    }
    window.edgeAISyncSettings();
  };

  window.toggleEdgeAIGpu = function(){
    // Mobilde satır gizli + WebGPU yoksa tıklama etkisiz olmasın diye
    // DOM checked yerine mevcut değerin tersi alınır.
    // 🔧 [FIX] Cihaz WebGPU desteklemese bile anahtar artık SEÇİLEBİLİR:
    // tercih kaydedilir, worker WASM'a düşer ve kullanıcı bilgilendirilir.
    // Eskiden burada sessiz "return" olduğu için kullanıcı anahtara basıp
    // hiçbir şey olmayınca "WebGPU seçilemiyor" diyordu.
    gpuEnabled = !gpuEnabled;
    if(gpuEnabled && !gpuAvailable){
      gpuEnabled = false; // gerçek GPU yok → WASM'da kal
      if(typeof showToast==='function') showToast('🖥️ WebGPU', 'Bu cihazda/tarayıcıda WebGPU kullanılamıyor — model WASM (CPU) ile çalışmaya devam eder.');
    }
    try{ localStorage.setItem(AI_GPU_KEY, gpuEnabled ? '1' : '0'); }catch(_){}
    // GPU değişimi yalnızca model yeniden yüklenirken etkili olur — bu yüzden
    // yüklü modeli bırakıp worker'ı tazeliyoruz (RAM hemen boşalır).
    if(worker){ try{ worker.terminate(); }catch(_){} worker = null; }
    if(aiEnabled){ ensureWorker().postMessage({ type:'set-gpu', on: gpuEnabled }); }
    if(typeof showToast==='function') showToast(gpuEnabled?'🖥️ WebGPU açık':'🖥️ WebGPU kapalı', gpuEnabled?'Model GPU\'da çalışacak (daha hızlı, daha çok RAM).':'Model WASM (CPU) ile çalışacak.');
    window.edgeAISyncSettings();
  };

  function ensureWorker(){
    if(worker) return worker;
    // 🔧 [FIX] Bazı durumları (özellikle mobil Safari) module worker'ı veya
    // CDN'den import'u desteklemez/hatalar. Böyle bir worker hatası alınırsa
    // AI tamamen ölmek yerine geleneksel (classic) worker ile tekrar denenir.
    try{
      worker = new Worker('edge-ai-worker.js', { type:'module' });
    }catch(e){
      // Module worker desteklenmiyor → klasik worker (webcompat).
      console.warn('[EdgeAI] module worker oluşturulamadı, classic deneniyor:', e);
      _workerRetryDone = true;
      worker = new Worker('edge-ai-worker.js');
    }
    wireWorker();
    return worker;
  }

  function wireWorker(){
    worker.postMessage({ type:'set-gpu', on: gpuEnabled });
    worker.onmessage = (ev)=>{
      const d = ev.data || {};
      if(d.type === 'caption') onCaption(d);
      else if(d.type === 'summary') onSummary(d.text);
      else if(d.type === 'chat-reply') onChatReply(d.text);
      else if(d.type === 'progress') onProgress(d);
      else if(d.type === 'status') onStatus(d);
      else if(d.type === 'error') onError(d);
    };
    worker.onerror = (e)=>{
      console.warn('[EdgeAI] module worker hatası, classic worker denenecek:', e.message);
      // Tek deneme: modül worker açılamazsa klasik worker ile ayağa kaldır.
      if(!_workerRetryDone){
        _workerRetryDone = true;
        try{ worker.terminate(); }catch(_){}
        worker = null;
        try{
          worker = new Worker('edge-ai-worker.js');
          wireWorker();
          return worker;
        }catch(_){ worker = null; }
      }
      onError({ kind:'worker', msg: e.message || 'Edge AI worker hatası' });
    };
  }
  let _workerRetryDone = false;

  function onStatus(d){
    const cap = $('liveCaptionStatus');
    const but = $('aiButlerStatus');
    if(d.kind === 'asr' && cap) cap.textContent = d.msg || '';
    if(d.kind === 'llm' && but) but.textContent = d.msg || '';
    if(d.kind === 'asr') setCapLoading(true, d.msg);
    // 🔧 LLM gerçekten yüklendiyse bayrağı set et — böylece Butler sohbetinde
    // derin (model) cevap da arka planda istenebilir.
    if(d.kind === 'llm' && d.msg && /hazır/.test(d.msg)) llmLoaded = true;
    if(d.msg && /hazır/.test(d.msg)) setCapLoading(false);
  }

  function onProgress(d){
    const pct = Math.max(0, Math.min(100, d.pct||0));
    const label = (d.file? d.file+' · ' : '') + pct.toFixed(0) + '%';
    if(d.kind === 'asr'){
      const cap = $('liveCaptionStatus');
      if(cap) cap.textContent = 'Model indiriliyor · '+label;
    } else {
      const but = $('aiButlerStatus');
      if(but) but.textContent = 'Model indiriliyor · '+label;
    }
  }

  function onError(d){
    const msg = d.msg || 'Bilinmeyen hata';
    if(d.kind === 'asr'){
      // 🔧 [FIX] Artık sonsuz retry yok: worker fatal:true ile kilitlendiyse
      // bunu not al ve kullanıcıya tek, anlaşılır bir mesaj göster.
      if(d.fatal) asrFailedOnce = true;
      setCapLoading(false);
      const cap = $('liveCaptionStatus');
      if(cap){
        cap.textContent = asrFailedOnce
          ? 'Altyazı modeli indirilemedi (internet/HF erişimi yok) · AI özet ve sohbet yine de cihazda çalışır'
          : 'Altyazı hatası: '+msg;
      }
      return;
    }
    if(d.kind === 'summarize' || d.kind === 'llm' || d.kind === 'worker'){
      // 🔌 [İSTEK] Artık kullanıcıya "model yüklenemedi" hatası GÖSTERMEYİZ:
      // cihaz içi Butler motoru sonucu çoktan üretti; LLM yalnızca bonus.
      const but = $('aiButlerStatus');
      if(but) but.textContent = 'Cihaz içi moddayım · mesajlar dışarı çıkmadı';
      updateModelAvailability();
    } else {
      const cap = $('liveCaptionStatus');
      if(cap) cap.textContent = 'Hata: '+msg;
    }
  }

  function setCapLoading(on, msg){
    const btn = $('liveCaptionBtn');
    if(!btn) return;
    btn.classList.toggle('is-loading', !!on && captionsOn);
    if(msg && captionsOn) btn.title = msg;
  }

  function onCaption(d){
    const el = $('liveCaptionText');
    if(!el) return;
    const who = d.speaker ? d.speaker+': ' : '';
    const line = who + d.text;
    captionLines.push(line);
    if(captionLines.length > 3) captionLines.shift();
    el.textContent = captionLines.join('\n');
    el.classList.add('has-text');
  }

  function extractiveSummary(messages){
    const texts = messages.filter(m=>m && m.text && !m.sys).map(m=>({
      from: m.from || 'Biri',
      text: String(m.text).replace(/\s+/g,' ').trim()
    })).filter(m=>m.text.length>1);
    if(!texts.length) return 'Bu sohbette özetlenecek metin mesajı yok.';
    const cues = /yarın|bugün|saat|buluş|gel|geç|iptal|onay|karar|toplant|mekan|nerede|\d{1,2}[:.]\d{2}|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar/i;
    const scored = texts.map((m,i)=>{
      let s = Math.min(m.text.length, 180)/180;
      if(cues.test(m.text)) s += 1.4;
      if(/\?/.test(m.text)) s += 0.2;
      s += i/texts.length*0.3;
      return { m, s };
    }).sort((a,b)=>b.s-a.s).slice(0,6);
    const lines = scored.map(({m})=>`${m.from}: ${m.text.slice(0,220)}`);
    return 'Hızlı taslak (cihaz içi, model öncesi):\n• '+lines.join('\n• ');
  }

  function collectMessages(){
    if(typeof getDB !== 'function' || !ME || !chatId) return [];
    const db = getDB();
    const k = chatType==='private' ? [ME.user_id, chatId].sort().join('_') : 'g_'+chatId;
    const msgs = db.messages[k] || [];
    return msgs.filter(m=>!m.sys && m.text).map(m=>({
      from: m.from || ME.user_id,
      text: m.text,
      time: m.time || ''
    })).slice(-120);
  }

  function onSummary(text){
    const out = $('aiButlerOut');
    const st = $('aiButlerStatus');
    if(st) st.textContent = 'Özet bu cihazda üretildi · mesajlar dışarı çıkmadı';
    if(out){
      // 🔌 Cihaz içi Butler taslağı zaten gösterilmişti; LLM geldiyse altta
      // "derin özet" olarak eklenir, gelmediyse taslak tek başına kalır.
      const prev = out.dataset.butlerDraft || '';
      out.dataset.locked = '1';
      out.textContent = (prev ? prev + '\n\n🧠 Derin özet (yerel model):\n' + (text||'') : (text||''));
    }
  }

  // 🔌 LLM'den sohbet cevabı gelirse cihaz içi cevabın altına işlenir.
  function onChatReply(text){
    if(text) appendChat('bot', text);
  }

  // 🔌 [İSTEK] AI cevabını gerçek sohbete gönderme (app.js'in kendi
  // msgInput→sendBtn akışını kullanır; mobilde de çalışır).
  function queueSendToChat(text){
    const t = String(text||'').trim();
    if(!t) return;
    const inp = $('msgInput');
    if(inp){
      inp.value = t;
      try{ inp.dispatchEvent(new Event('input', { bubbles:true })); }catch(_){}
    }
    const mInp = $('msgInputMobile');
    if(mInp){ mInp.value = t; try{ mInp.dispatchEvent(new Event('input', { bubbles:true })); }catch(_){} }
  }
  function sendLastAiToChat(){
    const out = $('aiButlerOut');
    if(!out || !out.textContent.trim()){
      if(typeof showToast==='function') showToast('AI Butler','Önce bir şey yaz ya da özet üret.');
      return;
    }
    const blocks = out.textContent.split('\n\n').filter(Boolean);
    const lastBot = [...blocks].reverse().find(b=>b.startsWith('🤖 Butler:'));
    const text = (lastBot ? lastBot.replace('🤖 Butler: ','') : blocks[blocks.length-1]).trim();
    if(!text) return;
    queueSendToChat(text);
    const btn = $('sendBtn');
    if(btn){ setTimeout(()=>{ try{ btn.click(); }catch(_){} }, 30); }
    if(typeof showToast==='function') showToast('📤 AI mesajı', 'Cevap sohbete gönderildi · verilerin cihazda kaldı');
  }

  // 🔌 [İSTEK] Cihaz içi sohbet: kullanıcı butlere yazıp cevap alabilir —
  // 0 MB indirme, her tarayıcıda çalışır.
  function appendChat(role, text){
    const out = $('aiButlerOut');
    if(!out) return;
    delete out.dataset.locked;
    const who = role==='user' ? '🙋 Sen' : '🤖 Butler';
    out.textContent += (out.textContent.trim() ? '\n\n' : '') + who+': '+text;
    out.scrollTop = out.scrollHeight;
    const sb = $('aiButlerSendChat');
    if(sb) sb.style.display = role==='user' ? '' : 'none';
  }
  function sendButlerChat(){
    const inp = $('aiButlerInp');
    if(!inp) return;
    const text = inp.value.trim();
    if(!text) return;
    inp.value = '';
    const b = $('aiButlerSend');
    if(b) b.disabled = true;
    const msgs = collectMessages();
    appendChat('user', text);
    // Cevabı bir sonraki tick'te üret — UI yazdığını anında göstersin.
    setTimeout(()=>{
      let inlineAnswered = false;
      try{ appendChat('bot', butlerChat(text, msgs)); inlineAnswered = true; }
      catch(e){ appendChat('bot', 'Bir sorun oldu ama buradayım — tekrar dener misin?'); }
      // LLM zaten yüklüyse (kullanıcı indirmeyi kabul etmiş) derin cevap da ekle.
      if(inlineAnswered && worker && llmLoaded){
        try{ worker.postMessage({ type:'chat', text, model: ($('aiButlerModel')||{}).value || 'fast' }); }catch(_){}
      }
    }, 30);
  }

  async function startTap(userId, stream){
    stopTap(userId);
    if(!stream || !stream.getAudioTracks().length) return;
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    try{ await ctx.resume(); }catch(_){}
    await ctx.audioWorklet.addModule('caption-worklet.js');
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'caption-capture');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    node.port.onmessage = (ev)=>{
      const { samples, sampleRate } = ev.data || {};
      if(!samples || !captionsOn) return;
      const w = ensureWorker();
      w.postMessage({ type:'audio', samples, sampleRate, speaker: userId||'' }, [samples.buffer]);
    };
    taps.set(userId, { ctx, node, src, mute, stream });
  }

  function stopTap(userId){
    const t = taps.get(userId);
    if(!t) return;
    try{ t.node.port.onmessage = null; t.node.disconnect(); t.src.disconnect(); t.mute.disconnect(); }catch(_){}
    try{ t.ctx.close(); }catch(_){}
    taps.delete(userId);
  }

  function stopAllTaps(){
    for(const id of [...taps.keys()]) stopTap(id);
  }

  async function setCaptions(on){
    if(on && !aiEnabled){
      if(typeof showToast==='function') showToast('✨ Yerel Yapay Zeka', 'Ayarlar → Yerel Yapay Zeka anahtarını aç.');
      return;
    }
    captionsOn = !!on;
    const bar = $('liveCaptionBar');
    const btn = $('liveCaptionBtn');
    if(bar) bar.classList.toggle('hidden', !captionsOn);
    if(btn) btn.classList.toggle('active-caption', captionsOn);
    if(!captionsOn){
      stopAllTaps();
      captionLines = [];
      const tx = $('liveCaptionText');
      if(tx){ tx.textContent='Karşı taraf konuşunca altyazı burada akar.'; tx.classList.remove('has-text'); }
      if(worker) worker.postMessage({ type:'captions-off' });
      if(worker) worker.postMessage({ type:'reset-audio' });
      setCapLoading(false);
      return;
    }
    ensureWorker();
    if(asrFailedOnce){
      // Daha önce indirme başarısız oldu — kullanıcı tekrar denemeden sessiz kal.
      const cap = $('liveCaptionStatus');
      if(cap) cap.textContent = 'Altyazı modeli indirilemedi · internet erişimini kontrol edip butona tekrar bas';
      setCapLoading(false);
    } else {
      worker.postMessage({ type:'warmup-asr' });
    }
    worker.postMessage({ type:'set-translate', mode: ($('liveCaptionMode')||{}).value || 'off' });
    for(const [uid, stream] of pending){
      await startTap(uid, stream);
    }
  }

  const api = {
    get enabled(){ return aiEnabled; },
    attachRemoteStream(userId, stream){
      if(!aiEnabled) return; // kapalıyken ses hiç yakalanmaz
      if(!userId || !stream) return;
      pending.set(userId, stream);
      if(captionsOn) startTap(userId, stream).catch(()=>{});
    },
    onCallEnded(){
      pending.clear();
      setCaptions(false);
    }
  };

  window.OpenChatEdgeAI = api;

  function bindUi(){
    const capBtn = $('liveCaptionBtn');
    if(capBtn) capBtn.addEventListener('click', ()=> setCaptions(!captionsOn));
    const mode = $('liveCaptionMode');
    if(mode) mode.addEventListener('change', ()=>{
      if(worker) worker.postMessage({ type:'set-translate', mode: mode.value });
    });
    const sumBtn = $('aiButlerBtn');
    if(sumBtn) sumBtn.addEventListener('click', openButler);
    const closeBtn = $('aiButlerClose');
    if(closeBtn) closeBtn.addEventListener('click', ()=> $('aiButlerPanel')?.classList.add('hidden'));
    const runBtn = $('aiButlerRun');
    if(runBtn) runBtn.addEventListener('click', runButler);
    // 🔌 [İSTEK] Butler'a yazıp sohbet edebilme (cihaz içi, 0 MB).
    const chatInp = $('aiButlerInp');
    if(chatInp){
      chatInp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendButlerChat(); } });
      chatInp.addEventListener('input', ()=>{
        const b = $('aiButlerSend');
        if(b) b.disabled = !chatInp.value.trim();
      });
    }
    const sendBtn = $('aiButlerSend');
    if(sendBtn) sendBtn.addEventListener('click', sendButlerChat);
    // 🔌 [İSTEK] AI cevabını gerçek sohbete gönderme butonu.
    const aiToChatBtn = $('aiButlerSendChat');
    if(aiToChatBtn) aiToChatBtn.addEventListener('click', sendLastAiToChat);
    const overlay = $('aiButlerPanel');
    if(overlay) overlay.addEventListener('click', (e)=>{
      if(e.target === overlay) overlay.classList.add('hidden');
    });

    // 🤖 [İSTEK] Kişi adının yanındaki ✨ rozeti ve arama çubuğundaki ✨
    // butonu — dinamik oluştukları için delegation ile bağlanır.
    document.addEventListener('click', (e)=>{
      const hdr = e.target.closest('.sv-ai-header-btn');
      if(hdr){ openButler(); return; }
      const srch = e.target.closest('.sv-ai-search-btn');
      if(srch){ summarizeSearchResults(); }
    });
  }

  function openButler(fromSearch){
    if(!aiEnabled){
      // 🔧 [FIX] Eskiden "Ayarlar → Yerel Yapay Zeka anahtarını aç" deniyordu;
      // mobilde Ayarlar'da bu satır artık yok. Tek dokunuşla AI burada
      // açılıyor (kullanıcı isteği: "tıklayınca kullanabilelim").
      window.toggleEdgeAI();
      const panel = $('aiButlerPanel');
      if(panel) panel.classList.remove('hidden');
      updateModelAvailability();
      return;
    }
    if(!chatId){
      if(typeof showToast==='function') showToast('AI Butler','Önce bir sohbet aç.');
      return;
    }
    const panel = $('aiButlerPanel');
    if(!panel) return;
    panel.classList.remove('hidden');
    updateModelAvailability();
    const out = $('aiButlerOut');
    const msgs = collectMessages();
    if(out){
      delete out.dataset.locked;
      // 🔌 Cihaz içi özet ANINDA çıkar — internet/model gerekmez.
      let draft = butlerSummarize(msgs);
      if(fromSearch){
        const found = searchMsgsFromDom();
        if(found.length) draft = '🔍 Arama sonuçları ('+found.length+' mesaj):\n'+butlerSummarize(found);
      }
      out.textContent = draft;
      out.dataset.butlerDraft = draft;
    }
    const st = $('aiButlerStatus');
    if(st) st.textContent = msgs.length
      ? msgs.length+' mesaj cihazda özetlendi · hiçbir şey dışarı gitmedi ✨'
      : 'Özetlenecek mesaj yok';
    const inp = $('aiButlerInp');
    if(inp && !fromSearch) setTimeout(()=>{ try{ inp.focus(); }catch(_){} }, 60);
  }

  // Arama balonlarından {from, text, time} üret — .me-wrap → sen,
  // grup sohbetteki .ms → gönderen adı, değilse karşı tarafın adı.
  function searchMsgsFromDom(){
    const wraps = $$('.msg-wrap.search-highlight');
    const scope = wraps.length ? wraps : $$('.msg-wrap');
    const otherName = (typeof chatId!=='undefined' && chatId && typeof $('chatName')!=='undefined')
      ? (($('chatName')?.textContent||'').replace('✨','').trim() || '') : '';
    const outMsgs = [];
    for(const el of scope){
      const t = el.querySelector('.msg-text') || el.querySelector('.file-name');
      if(!t || !t.textContent.trim()) continue;
      let from = '';
      const msEl = el.querySelector('.ms');
      if(msEl) from = msEl.textContent.trim();
      else if(el.classList.contains('me-wrap')) from = (typeof ME!=='undefined' && ME && ME.user_id) ? ME.user_id : 'Sen';
      else from = otherName || 'Karşı taraf';
      outMsgs.push({ from, text: t.textContent.trim(), time: 0 });
    }
    return outMsgs;
  }

  function summarizeSearchResults(){
    const found = searchMsgsFromDom();
    if(!found.length){
      if(typeof showToast==='function') showToast('AI Özet','Aranan metinde özetlenecek mesaj bulunamadı.');
      return;
    }
    openButler(true); // AI kapalıysa tek dokunuşla açar (mobilde ayar satırı yok)
    tryLlmSummarize(found); // LLM hazırsa arka planda derinleştirir
  }

  // 🔌 LLM yalnızca BONUS: model bu cihaza zaten indirilmişse arka planda
  // derin özet ekletir. İnternet/model yoksa hiçbir hata gösterilmez —
  // cihaz içi Butler özeti çoktan ekrandadır.
  function tryLlmSummarize(msgs){
    llmCachedLocally().then(ok=>{
      if(!ok) return; // sessizce çık — kullanıcı hiçbir şey fark etmez
      ensureWorker();
      worker.postMessage({ type:'set-gpu', on: gpuEnabled });
      const out = $('aiButlerOut');
      if(out) out.dataset.butlerDraft = butlerSummarize(msgs);
      const st = $('aiButlerStatus');
      if(st) st.textContent = 'İsteğe bağlı derin özet modeli hazırlanıyor… (cihaz içi özet hazır)';
      const model = ($('aiButlerModel')||{}).value || 'fast';
      worker.postMessage({ type:'summarize', messages: msgs, model });
    });
  }

  function runButler(){
    const msgs = collectMessages();
    const out = $('aiButlerOut');
    const st = $('aiButlerStatus');
    if(!msgs.length){
      if(st) st.textContent = 'Özetlenecek metin yok.';
      return;
    }
    if(out){
      delete out.dataset.locked;
      const draft = butlerSummarize(msgs);
      out.textContent = draft;
      out.dataset.butlerDraft = draft;
    }
    if(st) st.textContent = 'Cihaz içi özet hazır ✨ · mesajlar dışarı çıkmadı';
    tryLlmSummarize(msgs);
  }

  // 🤖 [İSTEK] Sohbet başlığında, karşı tarafın adının hemen yanında ✨ rozeti.
  // chatName app.js tarafından innerText ile yeniden yazıldığı için MutationObserver
  // ile korunur; buton silinirse anında geri eklenir.
  function ensureHeaderAiBadge(){
    const name = $('chatName');
    if(!name) return;
    const badge = document.getElementById('chatNameAiBtn');
    // innerText ataması içeriği düz metne çevirip butonu siler → geri ekle.
    if(badge && name.contains(badge)) return;
    const el = document.createElement('button');
    el.id = 'chatNameAiBtn';
    el.className = 'sv-ai-header-btn';
    el.type = 'button';
    el.title = 'Yerel Yapay Zeka — bu sohbeti cihazda özetle';
    el.textContent = '✨';
    el.style.display = aiEnabled ? '' : 'none';
    name.appendChild(el);
  }
  try{
    const _cnObs = new MutationObserver(()=> ensureHeaderAiBadge());
    const _cn = $('chatName');
    if(_cn) _cnObs.observe(_cn, { childList:true });
  }catch(_){}

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>{ bindUi(); applyAiUi(); ensureHeaderAiBadge(); window.edgeAISyncSettings(); updateModelAvailability(); });
  else { bindUi(); applyAiUi(); ensureHeaderAiBadge(); window.edgeAISyncSettings(); updateModelAvailability(); }
})();
