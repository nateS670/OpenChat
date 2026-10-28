/**
 * OpenChat Edge AI — runs entirely in a Web Worker.
 * Models: Whisper Tiny (ASR) + Qwen2.5-0.5B / Phi-3 Mini (summarize).
 * Audio and chat text never leave this origin except Hugging Face model files.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;

const ASR_ID = 'Xenova/whisper-tiny';
const LLM_FAST = 'onnx-community/Qwen2.5-0.5B-Instruct';
const LLM_PHI = 'onnx-community/Phi-3-mini-4k-instruct-onnx-web';

let asr = null;
let llm = null;
let llmId = null;
let translateMode = 'off'; // off | en | tr
// ✨ [3.7] Ayarlar'dan gelen GPU tercihi (varsayılan: kapalı — daha az RAM).
let gpuEnabled = false;
let busyAsr = false;
let pcmQueue = [];
let pcmRate = 16000;
let pcmSpeaker = '';

function progressCb(kind){
  return (info)=>{
    try{
      const status = info?.status || '';
      const file = String(info?.file || info?.name || '');
      let pct = 0;
      if(typeof info?.progress === 'number') pct = info.progress;
      else if(info?.loaded && info?.total) pct = (info.loaded / info.total) * 100;
      self.postMessage({ type:'progress', kind, status, file: file.split('/').pop(), pct });
    }catch(_){}
  };
}

async function pickDevice(preferGpu){
  if(preferGpu){
    try{
      if(navigator.gpu){
        const ad = await navigator.gpu.requestAdapter();
        if(ad) return 'webgpu';
      }
    }catch(_){}
  }
  return 'wasm';
}

function resampleLinear(input, inRate, outRate){
  if(inRate === outRate) return input;
  const ratio = inRate / outRate;
  const n = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(n);
  for(let i=0;i<n;i++){
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0+1, input.length-1);
    const f = x - i0;
    out[i] = input[i0]*(1-f) + input[i1]*f;
  }
  return out;
}

async function ensureAsr(){
  if(asr) return asr;
  const device = await pickDevice(gpuEnabled);
  const dtype = device === 'webgpu' ? 'fp32' : 'q8';
  self.postMessage({ type:'status', kind:'asr', msg:'Whisper Tiny yükleniyor ('+device+')…' });
  try{
    asr = await pipeline('automatic-speech-recognition', ASR_ID, {
      device, dtype, progress_callback: progressCb('asr')
    });
  }catch(e){
    asr = await pipeline('automatic-speech-recognition', ASR_ID, {
      device: 'wasm', dtype: 'q8', progress_callback: progressCb('asr')
    });
  }
  self.postMessage({ type:'status', kind:'asr', msg:'Whisper Tiny hazır · tarayıcı içi' });
  return asr;
}

async function ensureLlm(which){
  const want = which === 'phi3' ? LLM_PHI : LLM_FAST;
  if(llm && llmId === want) return llm;
  llm = null;
  llmId = null;
  const device = await pickDevice(gpuEnabled);
  const dtype = device === 'webgpu' ? 'q4' : 'q8';
  const label = want === LLM_PHI ? 'Phi-3 Mini' : 'Qwen2.5 0.5B';
  self.postMessage({ type:'status', kind:'llm', msg: label+' yükleniyor ('+device+')… İlk indirme birkaç yüz MB olabilir, sonra önbellekte kalır.' });
  try{
    llm = await pipeline('text-generation', want, {
      device, dtype, progress_callback: progressCb('llm')
    });
    llmId = want;
  }catch(e){
    if(want !== LLM_FAST){
      self.postMessage({ type:'status', kind:'llm', msg:'Phi-3 açılamadı, Qwen2.5 0.5B deneniyor…' });
      llm = await pipeline('text-generation', LLM_FAST, {
        device: 'wasm', dtype: 'q8', progress_callback: progressCb('llm')
      });
      llmId = LLM_FAST;
    } else {
      throw e;
    }
  }
  self.postMessage({ type:'status', kind:'llm', msg: (llmId===LLM_PHI?'Phi-3 Mini':'Qwen2.5 0.5B')+' hazır · veriler bu cihazda' });
  return llm;
}

async function flushAsr(){
  if(busyAsr || !pcmQueue.length) return;
  const minSamples = 16000 * 1.6;
  let total = 0;
  for(const c of pcmQueue) total += c.length;
  if(total < minSamples) return;

  busyAsr = true;
  const speaker = pcmSpeaker;
  const merged = new Float32Array(total);
  let o = 0;
  for(const c of pcmQueue){ merged.set(c, o); o += c.length; }
  // keep ~0.6s overlap
  const keep = Math.floor(16000 * 0.6);
  if(merged.length > keep){
    pcmQueue = [merged.slice(merged.length - keep)];
  } else {
    pcmQueue = [];
  }
  try{
    const pipe = await ensureAsr();
    const opts = {
      language: translateMode === 'en' ? null : null,
      task: translateMode === 'en' ? 'translate' : 'transcribe',
      return_timestamps: false
    };
    const out = await pipe({ raw: merged, sampling_rate: 16000 }, opts);
    let text = (out?.text || '').replace(/\s+/g,' ').trim();
    if(text && !/^[\s.·…]+$/.test(text) && text.length > 1){
      if(translateMode === 'tr' && llm){
        try{
          const gen = await llm(chatMessages('Sadece Türkçe çevirisini yaz:\n'+text), {
            max_new_tokens: 80, temperature: 0.1, do_sample: false
          });
          const raw = Array.isArray(gen) ? gen[0]?.generated_text : gen?.generated_text;
          const tr = stripGenerated(raw);
          if(tr) text = tr;
        }catch(_){}
      }
      self.postMessage({ type:'caption', speaker, text, translated: translateMode !== 'off' });
    }
  }catch(err){
    self.postMessage({ type:'error', kind:'asr', msg: String(err?.message||err) });
  } finally {
    busyAsr = false;
    if(pcmQueue.length) setTimeout(flushAsr, 10);
  }
}

function chatMessages(userText){
  return [
    {
      role: 'system',
      content: 'Sen gizlilik odaklı bir sohbet asistanısın. Mesajlar kullanıcının cihazında kaldı. Türkçe, kısa ve somut yaz. Uydurma. Sadece istenen çıktıyı döndür.'
    },
    { role: 'user', content: userText }
  ];
}

function stripGenerated(raw, fallbackHint){
  let text = String(raw||'');
  const markers = ['<|im_start|>assistant', '<|assistant|>', 'assistant\n'];
  for(const m of markers){
    const i = text.lastIndexOf(m);
    if(i>=0) text = text.slice(i + m.length);
  }
  text = text.replace(/<\|im_end\|>[\s\S]*$/,'').replace(/<\|end\|>[\s\S]*$/,'').trim();
  if(!text && fallbackHint && String(raw||'').length > fallbackHint.length){
    text = String(raw).slice(fallbackHint.length).trim();
  }
  return text;
}

self.onmessage = async (ev)=>{
  const d = ev.data || {};
  try{
    if(d.type === 'set-gpu'){
      gpuEnabled = !!d.on;
      return;
    }
    if(d.type === 'warmup-asr'){
      await ensureAsr();
      return;
    }
    if(d.type === 'set-translate'){
      translateMode = d.mode === 'en' || d.mode === 'tr' ? d.mode : 'off';
      if(translateMode === 'tr'){
        try{ await ensureLlm('fast'); }catch(_){}
      }
      return;
    }
    if(d.type === 'audio'){
      const samples = d.samples;
      const rate = d.sampleRate || 48000;
      if(!(samples instanceof Float32Array) && !ArrayBuffer.isView(samples)) return;
      const f32 = samples instanceof Float32Array ? samples : new Float32Array(samples);
      const rs = resampleLinear(f32, rate, 16000);
      pcmSpeaker = d.speaker || '';
      pcmQueue.push(rs);
      let tot = 0;
      for(const c of pcmQueue) tot += c.length;
      if(tot > 16000 * 12){
        let drop = tot - 16000 * 8;
        while(drop > 0 && pcmQueue.length){
          drop -= pcmQueue[0].length;
          pcmQueue.shift();
        }
      }
      flushAsr();
      return;
    }
    if(d.type === 'reset-audio'){
      pcmQueue = [];
      busyAsr = false;
      return;
    }
    if(d.type === 'summarize'){
      const messages = Array.isArray(d.messages) ? d.messages : [];
      if(!messages.length){
        self.postMessage({ type:'summary', text:'Özetlenecek metin mesajı yok.' });
        return;
      }
      const pipe = await ensureLlm(d.model === 'phi3' ? 'phi3' : 'fast');
      const lines = messages.slice(-80).map(m=>{
        const who = m.from || '?';
        const t = String(m.text||'').replace(/\s+/g,' ').slice(0,400);
        return `${who}: ${t}`;
      }).join('\n');
      const gen = await pipe(chatMessages(
        'Bu sohbeti 4-6 cümlede özetle. Kim ne karar verdi, saat/yer varsa belirt.\n\n'+lines
      ), {
        max_new_tokens: 220,
        temperature: 0.3,
        do_sample: true,
        top_p: 0.9
      });
      const raw = Array.isArray(gen) ? gen[0]?.generated_text : gen?.generated_text;
      const text = stripGenerated(raw) || 'Özet üretilemedi.';
      self.postMessage({ type:'summary', text });
      return;
    }
  }catch(err){
    self.postMessage({ type:'error', kind: d.type, msg: String(err?.message||err) });
  }
};
