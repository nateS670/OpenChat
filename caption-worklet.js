/* PCM tap for live captions — never routes to speakers. */
class CaptionCaptureProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this._chunks = [];
    this._len = 0;
    this._flush = Math.max(2048, Math.floor(sampleRate * 0.75));
  }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if(!ch || !ch.length) return true;
    this._chunks.push(new Float32Array(ch));
    this._len += ch.length;
    if(this._len >= this._flush){
      const out = new Float32Array(this._len);
      let o = 0;
      for(const p of this._chunks){ out.set(p, o); o += p.length; }
      this.port.postMessage({ samples: out, sampleRate }, [out.buffer]);
      this._chunks = [];
      this._len = 0;
    }
    return true;
  }
}
registerProcessor('caption-capture', CaptionCaptureProcessor);
