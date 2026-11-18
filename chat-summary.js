/* ================================================================
   openchat — Sohbet Özeti (3.8)
   ------------------------------------------------------------------
   Basit KURAL TABANLI özet; tamamen cihazında çalışır, ağa hiçbir şey
   göndermez ve dışarıdan dosya/model indirmez.
   Ayarlar → Sohbet Özeti açıkken sohbet başlığında 📝 butonu görünür.
   Gösterilenler: mesaj sayıları, kim ne kadar yazdı, öne çıkan satırlar,
   linkler, cevap bekleyen sorular, sık geçen kelimeler.
   Not: DOM'a yazılan her metin textContent ile eklenir (XSS güvenli).
   ================================================================ */
(function(){
  'use strict';
  const KEY = 'sv_summary_on';
  const $ = id => document.getElementById(id);

  const enabled = () => { try{ return localStorage.getItem(KEY)==='1'; }catch(e){ return false; } };
  const setEnabled = v => { try{ localStorage.setItem(KEY, v?'1':'0'); }catch(e){} };

  // Uygulamanın üst düzey değişkenlerine (let/const) güvenli erişim
  const cur = () => {
    try{
      return {
        me: (typeof ME!=='undefined' && ME) ? ME.user_id : null,
        id: (typeof chatId!=='undefined') ? chatId : null,
        type: (typeof chatType!=='undefined') ? chatType : null,
      };
    }catch(e){ return {me:null,id:null,type:null}; }
  };

  function currentMessages(){
    const c = cur();
    if(!c.me || !c.id) return [];
    try{
      const db = getDB();
      const k = c.type==='group' ? 'g_'+c.id : [c.me, c.id].sort().join('_');
      return (db.messages && db.messages[k]) || [];
    }catch(e){ return []; }
  }

  const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
  const STOP = new Set(('ve bir bu da de ile için ama ben sen o biz siz onlar mi mı mu mü ne ki çok daha en gibi var yok ' +
    'şu şey evet hayır tamam ok the a an and or to of in on is it you i we they for with that this was are be at as ' +
    'not no yes ya ha he hı bi bu şu ben sana beni bana seni').split(/\s+/));

  function words(text){
    return (text||'').toLocaleLowerCase('tr').replace(URL_RE,' ')
      .split(/[^a-zçğıöşü0-9]+/i).filter(w=>w.length>=3 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  function analyze(){
    const c = cur();
    const msgs = currentMessages().filter(m => m && !m.sys && !m.deleted);
    const res = {total:msgs.length, byUser:{}, links:[], questions:[], highlights:[], topWords:[], mine:0, theirs:0};
    const freq = {};
    msgs.forEach((m,i)=>{
      const from = m.from || '?';
      res.byUser[from] = (res.byUser[from]||0)+1;
      if(from===c.me) res.mine++; else res.theirs++;
      const isFile = !!m.fileType;
      const text = isFile ? '' : String(m.text||'');
      (text.match(URL_RE)||[]).forEach(u=>res.links.push({url:u, from, time:m.time||''}));
      if(!text) return;
      words(text).forEach(w=>{ freq[w]=(freq[w]||0)+1; });
      // Cevap bekleyen soru: '?' ile biten ve sonrasında başka birinden mesaj gelmemiş
      if(/\?\s*$/.test(text)){
        const answered = msgs.slice(i+1).some(n => n.from !== from);
        if(!answered) res.questions.push({text, from, time:m.time||''});
      }
      // Öne çıkan satır puanı
      let score = Math.min(text.length, 160)/40;
      if(/\b\d{1,2}[:.]\d{2}\b/.test(text)) score += 2;                 // saat
      if(/\b\d{1,2}[./]\d{1,2}([./]\d{2,4})?\b/.test(text)) score += 2; // tarih
      if(/\d{3,}/.test(text)) score += 1;
      if(/!/.test(text)) score += .5;
      if(/\b(önemli|acil|unutma|lütfen|toplantı|teslim|saat|yarın|bugün|important|urgent|remember|meeting|deadline|tomorrow)\b/i.test(text)) score += 2.5;
      if(text.length>=12) res.highlights.push({text, from, time:m.time||'', score, i});
    });
    res.highlights = res.highlights.sort((a,b)=>b.score-a.score).slice(0,5).sort((a,b)=>a.i-b.i);
    res.topWords = Object.entries(freq).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,10);
    res.links = res.links.slice(-8);
    res.questions = res.questions.slice(-5);
    return res;
  }

  // ── küçük DOM yardımcıları ──
  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text!=null) e.textContent = text;
    return e;
  }
  function section(title, child){
    const w = el('div');
    w.appendChild(el('div','svs-sec-t',title));
    w.appendChild(child);
    return w;
  }
  function row(time, who, txt, tag){
    const r = el('div','svs-row');
    if(time) r.appendChild(el('span','svs-time',time));
    if(who)  r.appendChild(el('span','svs-who',who));
    r.appendChild(el('span','svs-txt',txt));
    if(tag)  r.appendChild(el('span','svs-tag',tag));
    return r;
  }

  let lastPlain = '';

  function render(){
    const body = $('summaryBody');
    if(!body) return;
    body.textContent = '';
    const r = analyze();
    const c = cur();
    if(!r.total){
      body.appendChild(el('div','svs-empty','Bu sohbette özetlenecek mesaj yok.'));
      lastPlain = '';
      return;
    }

    const chips = el('div','svs-chips');
    [[r.total,'Mesaj'],[r.mine,'Sen'],[r.theirs,'Karşı taraf'],[r.links.length,'Link'],[r.questions.length,'Bekleyen soru']]
      .forEach(([n,l])=>{ const ch=el('div','svs-chip'); ch.appendChild(el('b',null,String(n))); ch.appendChild(el('span',null,l)); chips.appendChild(ch); });
    body.appendChild(chips);

    // Kim ne kadar yazdı
    const bars = el('div','svs-bars');
    const max = Math.max(...Object.values(r.byUser));
    Object.entries(r.byUser).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([u,n])=>{
      const b = el('div','svs-bar');
      b.appendChild(el('span','svs-bar-n', u===c.me ? 'Sen' : u));
      const t = el('div','svs-bar-t'); const i = el('i'); i.style.width = Math.max(4, Math.round(n/max*100))+'%'; t.appendChild(i);
      b.appendChild(t);
      b.appendChild(el('span','svs-bar-c',String(n)));
      bars.appendChild(b);
    });
    body.appendChild(section('Kim ne kadar yazdı', bars));

    if(r.highlights.length){
      const l = el('div','svs-list');
      r.highlights.forEach(h=>l.appendChild(row(h.time, h.from===c.me?'Sen':h.from, h.text)));
      body.appendChild(section('Öne çıkan satırlar', l));
    }
    if(r.questions.length){
      const l = el('div','svs-list');
      r.questions.forEach(q=>l.appendChild(row(q.time, q.from===c.me?'Sen':q.from, q.text, 'cevapsız')));
      body.appendChild(section('Cevap bekleyen sorular', l));
    }
    if(r.links.length){
      const l = el('div','svs-list');
      r.links.forEach(k=>{ const x=row(k.time, k.from===c.me?'Sen':k.from, ''); x.querySelector('.svs-txt').replaceWith(el('span','svs-txt svs-url',k.url)); l.appendChild(x); });
      body.appendChild(section('Linkler', l));
    }
    if(r.topWords.length){
      const w = el('div','svs-words');
      r.topWords.forEach(([k,n])=>w.appendChild(el('span','svs-word',k+' ×'+n)));
      body.appendChild(section('Sık geçen kelimeler', w));
    }

    // Kopyalanacak düz metin
    const P = [];
    P.push('📝 Sohbet Özeti — '+(c.type==='group'?'Grup ':'')+c.id);
    P.push(`Mesaj: ${r.total} (Sen: ${r.mine}, Karşı taraf: ${r.theirs})`);
    if(r.highlights.length){ P.push('\nÖne çıkanlar:'); r.highlights.forEach(h=>P.push(`- [${h.time}] ${h.from===c.me?'Sen':h.from}: ${h.text}`)); }
    if(r.questions.length){ P.push('\nCevap bekleyen sorular:'); r.questions.forEach(q=>P.push(`- [${q.time}] ${q.from===c.me?'Sen':q.from}: ${q.text}`)); }
    if(r.links.length){ P.push('\nLinkler:'); r.links.forEach(k=>P.push('- '+k.url)); }
    lastPlain = P.join('\n');
  }

  function openPanel(){ const p=$('summaryPanel'); if(!p) return; render(); p.classList.remove('hidden'); }
  function closePanel(){ const p=$('summaryPanel'); if(p) p.classList.add('hidden'); }

  // Buton: yalnızca özellik açıkken ve bir sohbet seçiliyken görünür
  function syncButton(){
    const b = $('summaryBtn');
    if(!b) return;
    const show = enabled() && !!cur().id;
    b.style.display = show ? '' : 'none';
    if(!show) closePanel();
  }

  window.svSummarySyncSettings = function(){
    const t = $('toggleSummary');
    if(t) t.checked = enabled();
    syncButton();
  };

  function init(){
    const t = $('toggleSummary');
    if(t){
      t.checked = enabled();
      t.addEventListener('change', ()=>{ setEnabled(t.checked); syncButton(); });
    }
    $('summaryBtn')?.addEventListener('click', openPanel);
    $('summaryClose')?.addEventListener('click', closePanel);
    $('summaryRefresh')?.addEventListener('click', render);
    $('summaryPanel')?.addEventListener('click', e=>{ if(e.target===$('summaryPanel')) closePanel(); });
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closePanel(); });
    $('summaryCopy')?.addEventListener('click', async ()=>{
      if(!lastPlain) return;
      try{
        await navigator.clipboard.writeText(lastPlain);
        if(typeof showToast==='function') showToast('Kopyalandı','Sohbet özeti panoya kopyalandı.');
      }catch(e){
        if(typeof showToast==='function') showToast('Hata','Panoya kopyalanamadı.');
      }
    });
    // Sohbet değişince butonu güncelle (app.js sohbet geçişi için olay yayınlamıyor)
    let lastId = null;
    setInterval(()=>{ const id = cur().id; if(id!==lastId){ lastId=id; syncButton(); } }, 600);
    syncButton();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
