/* OpenChat Edge AI — main thread. Whisper captions + local chat butler. */
(function(){
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

  function $(id){ return document.getElementById(id); }

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
  }

  // Ayarlar paneli her açıldığında app.js çağırır (toggleSettings).
  window.edgeAISyncSettings = function(){
    const a = $('toggleEdgeAI');
    const g = $('toggleEdgeAIGpu');
    if(a) a.checked = aiEnabled;
    if(g){ g.checked = gpuEnabled; g.disabled = !aiEnabled; }
  };

  function disableAi(){
    try{ setCaptions(false); }catch(_){}
    if(worker){ try{ worker.terminate(); }catch(_){} worker = null; }
    pending.clear();
    captionLines = [];
    aiEnabled = false;
    localStorage.setItem(AI_KEY, '0');
    applyAiUi();
  }

  window.toggleEdgeAI = function(){
    const cb = $('toggleEdgeAI');
    const on = !!(cb && cb.checked);
    if(on){
      aiEnabled = true;
      localStorage.setItem(AI_KEY, '1');
      applyAiUi();
      ensureWorker();
      worker.postMessage({ type:'set-gpu', on: gpuEnabled });
    } else {
      disableAi();
    }
    window.edgeAISyncSettings();
  };

  window.toggleEdgeAIGpu = function(){
    const cb = $('toggleEdgeAIGpu');
    gpuEnabled = !!(cb && cb.checked);
    localStorage.setItem(AI_GPU_KEY, gpuEnabled ? '1' : '0');
    // GPU değişimi yalnızca model yeniden yüklenirken etkili olur — bu yüzden
    // yüklü modeli bırakıp worker'ı tazeliyoruz (RAM hemen boşalır).
    if(worker){ try{ worker.terminate(); }catch(_){} worker = null; }
    if(aiEnabled){ ensureWorker().postMessage({ type:'set-gpu', on: gpuEnabled }); }
    window.edgeAISyncSettings();
  };

  function ensureWorker(){
    if(worker) return worker;
    worker = new Worker('edge-ai-worker.js', { type:'module' });
    worker.postMessage({ type:'set-gpu', on: gpuEnabled });
    worker.onmessage = (ev)=>{
      const d = ev.data || {};
      if(d.type === 'caption') onCaption(d);
      else if(d.type === 'summary') onSummary(d.text);
      else if(d.type === 'progress') onProgress(d);
      else if(d.type === 'status') onStatus(d);
      else if(d.type === 'error') onError(d);
    };
    worker.onerror = (e)=>{
      onError({ kind:'worker', msg: e.message || 'Edge AI worker hatası' });
    };
    return worker;
  }

  function onStatus(d){
    const cap = $('liveCaptionStatus');
    const but = $('aiButlerStatus');
    if(d.kind === 'asr' && cap) cap.textContent = d.msg || '';
    if(d.kind === 'llm' && but) but.textContent = d.msg || '';
    if(d.kind === 'asr') setCapLoading(true, d.msg);
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
    if(d.kind === 'summarize' || d.kind === 'llm'){
      const but = $('aiButlerStatus');
      if(but) but.textContent = 'Hata: '+msg;
      const out = $('aiButlerOut');
      if(out && !out.dataset.locked) out.textContent = 'Yerel model yüklenemedi. Aşağıda hızlı (kural tabanlı) özet duruyor. WebGPU’li bir tarayıcı ve ilk indirme için Hugging Face erişimi gerekir.';
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
      out.dataset.locked = '1';
      out.textContent = text || '';
    }
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
      if(worker) worker.postMessage({ type:'reset-audio' });
      return;
    }
    ensureWorker();
    worker.postMessage({ type:'warmup-asr' });
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
    const overlay = $('aiButlerPanel');
    if(overlay) overlay.addEventListener('click', (e)=>{
      if(e.target === overlay) overlay.classList.add('hidden');
    });
  }

  function openButler(){
    if(!aiEnabled){
      if(typeof showToast==='function') showToast('✨ Yerel Yapay Zeka', 'Ayarlar → Yerel Yapay Zeka anahtarını aç.');
      return;
    }
    if(!chatId){
      if(typeof showToast==='function') showToast('AI Butler','Önce bir sohbet aç.');
      return;
    }
    const panel = $('aiButlerPanel');
    if(!panel) return;
    panel.classList.remove('hidden');
    const out = $('aiButlerOut');
    const msgs = collectMessages();
    if(out){
      delete out.dataset.locked;
      out.textContent = extractiveSummary(msgs);
    }
    const st = $('aiButlerStatus');
    if(st) st.textContent = msgs.length
      ? msgs.length+' mesaj cihazda hazır · model henüz çalışmadı'
      : 'Özetlenecek mesaj yok';
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
      out.textContent = extractiveSummary(msgs)+'\n\nYerel model yükleniyor… mesajlar RAM’de kalır, sunucuya gitmez.';
    }
    if(st) st.textContent = 'Edge LLM çalışıyor…';
    const model = ($('aiButlerModel')||{}).value || 'fast';
    ensureWorker().postMessage({ type:'summarize', messages: msgs, model });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>{ bindUi(); applyAiUi(); window.edgeAISyncSettings(); });
  else { bindUi(); applyAiUi(); window.edgeAISyncSettings(); }
})();
