// Open Sports Soundboard Pro
// 8,640 pads (72 banks * 120 pads), instant play via Web Audio API, color-coded pads,
// custom cue control, import/export, offline (PWA), drag & drop uploads, keyboard + MIDI learn.

const APP_VERSION = 'v1.0.1';
const PADS_PER_PAGE = 120;     // 12 x 10 grid
const PAGES = 72;              // 72 banks
const TOTAL_PADS = PADS_PER_PAGE * PAGES;

const qs = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const $ = qs;

// Elements
const gridEl = $('#grid');
const pageSelect = $('#pageSelect');
const pageInfo = $('#pageInfo');
const btnPrev = $('#prevPage');
const btnNext = $('#nextPage');
const searchBox = $('#searchBox');
const fileInput = $('#fileInput');
const assignInput = $('#assignInput');
const btnAdd = $('#btnAdd');
const btnStopAll = $('#btnStopAll');
const btnExport = $('#btnExport');
const btnImport = $('#btnImport');
const importDialog = $('#importDialog');
const exportDialog = $('#exportDialog');
const confirmExport = $('#confirmExport');
const exportWithAudio = $('#exportWithAudio');
const importFile = $('#importFile');
const confirmImport = $('#confirmImport');
const btnSettings = $('#btnSettings');
const settingsDialog = $('#settingsDialog');
const settingWaveformHQ = $('#settingWaveformHQ');
const settingKeyPreview = $('#settingKeyPreview');
const settingMidi = $('#settingMidi');
const masterVol = $('#masterVol');
const latencyLabel = $('#latency');
const statusEl = $('#status');
const btnInstall = $('#btnInstall');
const btnArmAudio = $('#btnArmAudio');

// Editor elements
const editor = $('#editor');
const closeEditor = $('#closeEditor');
const padForm = $('#padForm');
const padName = $('#padName');
const padColor = $('#padColor');
const padTags = $('#padTags');
const padMode = $('#padMode');
const padGroup = $('#padGroup');
const padVol = $('#padVol');
const padDetune = $('#padDetune');
const padRate = $('#padRate');
const padFadeIn = $('#padFadeIn');
const padFadeOut = $('#padFadeOut');
const padStart = $('#padStart');
const padEnd = $('#padEnd');
const padKey = $('#padKey');
const btnLearnKey = $('#btnLearnKey');
const padMidi = $('#padMidi');
const btnLearnMidi = $('#btnLearnMidi');
const btnAssignAudio = $('#btnAssignAudio');
const audioName = $('#audioName');
const btnDuplicatePad = $('#btnDuplicatePad');
const btnDeletePadAudio = $('#btnDeletePadAudio');

const waveCanvas = $('#wave');
const waveCtx = waveCanvas.getContext('2d');
const cueList = $('#cueList');
const btnAddCue = $('#btnAddCue');
const btnClearCues = $('#btnClearCues');

$('#version').textContent = APP_VERSION;

// --- Utilities ---
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function fmtTime(sec){
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }
function padId(page, index){ return `${page}:${index}`; }
function parsePadId(id){ const [p,i]=id.split(':').map(n=>+n); return {page:p,index:i}; }

// --- Audio Engine ---
class AudioEngine{
  constructor(){
    this.context = null;
    this.master = null;
    this.buffers = new Map(); // soundId -> AudioBuffer
    this.playing = new Map(); // instanceId -> {source, gain, padId, soundId, group, loop}
    this.armed = false;
    this.latencyHint = 'interactive';
  }
  async arm(){
    if (!this.context){
      this.context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: this.latencyHint
      });
      this.master = this.context.createGain();
      this.master.gain.value = parseFloat(masterVol.value);
      this.master.connect(this.context.destination);
      latencyLabel.textContent = `${(this.context.baseLatency*1000|0)} ms`;
    }
    if (this.context.state !== 'running'){
      await this.context.resume();
    }
    this.armed = true;
    status('Audio armed ✓');
  }
  setMasterVolume(v){
    if (this.master) this.master.gain.value = v;
  }
  async ensureBuffer(sound){
    if (!sound || !sound.id) return null;
    if (this.buffers.has(sound.id)) return this.buffers.get(sound.id);
    const arrBuf = await sound.blob.arrayBuffer();
    const audioBuf = await this.context.decodeAudioData(arrBuf.slice(0));
    this.buffers.set(sound.id, audioBuf);
    return audioBuf;
  }
  stopAll(fadeOutSec=0.05){
    for (const {gain, source} of this.playing.values()){
      try{
        if (fadeOutSec>0){
          const t = this.context.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setTargetAtTime(0.0001, t, Math.max(0.005, fadeOutSec/5));
          source.stop(t + fadeOutSec);
        }else{
          source.stop();
        }
      }catch{}
    }
    this.playing.clear();
  }
  stopGroup(group){
    for (const [id, inst] of this.playing){
      if (inst.group === group){
        try{ inst.source.stop(); }catch{}
        this.playing.delete(id);
      }
    }
  }
  getPlayingInstanceByPadId(padId){
    for (const [id, p] of this.playing){
      if (p.padId === padId) return {id, ...p};
    }
    return null;
  }
  stopPad(padId, fadeOutSec=0.03){
    const inst = this.getPlayingInstanceByPadId(padId);
    if (!inst) return;
    const t = this.context.currentTime;
    try{
      inst.gain.gain.cancelScheduledValues(t);
      inst.gain.gain.setTargetAtTime(0.0001, t, Math.max(0.005, fadeOutSec/5));
      inst.source.stop(t + fadeOutSec);
    }catch{}
    this.playing.delete(inst.id);
  }
  async play({pad, sound, when=0, cueTime=null, loop=false}){
    if (!this.armed) return;
    if (!sound || !sound.id) return;

    const ctx = this.context;
    const now = ctx.currentTime;
    const startAt = now + Math.max(0, when);

    const instanceId = uuid();
    const gain = ctx.createGain();
    const out = gain;

    const group = pad.group?.trim() || null;
    if (group){ this.stopGroup(group); } // exclusive groups

    const rate = clamp(parseFloat(pad.rate||1.0), 0.25, 4);
    const detune = parseFloat(pad.detune||0);
    const vol = clamp(parseFloat(pad.vol||1), 0, 2);

    const fadeIn = Math.max(0, parseFloat(pad.fadeIn||0.03));
    const fadeOut = Math.max(0, parseFloat(pad.fadeOut||0.03));

    const startSec = Math.max(0, parseFloat(pad.start||0));
    const endSec = Math.max(0, parseFloat(pad.end||0));

    const playFrom = cueTime != null ? Math.max(0, cueTime) : startSec;

    const buffer = await this.ensureBuffer(sound);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    if ('detune' in source) source.detune.value = detune;

    source.connect(out);
    out.connect(this.master);
    gain.gain.value = 0.0001;

    const dur = buffer.duration;
    const realEnd = endSec>0 ? Math.min(endSec, dur) : dur;
    const maxPlay = Math.max(0, realEnd - playFrom);

    // Loop support (for toggle mode)
    if (loop){
      source.loop = true;
      source.loopStart = playFrom;
      source.loopEnd = realEnd;
    }

    // Fade-in
    const t = startAt;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + Math.max(0.005, fadeIn));

    let stopAt = null;
    if (!loop && pad.mode === 'oneshot'){
      stopAt = t + maxPlay + fadeOut;
      gain.gain.setTargetAtTime(0.0001, stopAt - fadeOut, Math.max(0.005, fadeOut/5));
    }

    source.onended = () => {
      this.playing.delete(instanceId);
    };

    source.start(t, playFrom);
    if (stopAt) source.stop(stopAt);

    this.playing.set(instanceId, {source, gain, padId: pad.id, soundId: sound.id, group, loop});
    return instanceId;
  }
}

const audio = new AudioEngine();

// --- IndexedDB ---
const DB_NAME = 'ossb-pro';
const DB_VERSION = 3;
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('sounds')){
        const s = d.createObjectStore('sounds', { keyPath: 'id' });
        s.createIndex('by_name', 'name');
      }
      if (!d.objectStoreNames.contains('pads')){
        const p = d.createObjectStore('pads', { keyPath: 'id' });
        p.createIndex('by_page', 'page');
      } else {
        // Upgrade path: nothing specific here
      }
      if (!d.objectStoreNames.contains('meta')){
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}

async function savePad(pad){
  return new Promise((resolve,reject)=>{
    const req = tx('pads', 'readwrite').put(pad);
    req.onsuccess = ()=> resolve(pad);
    req.onerror = ()=> reject(req.error);
  });
}

async function getPad(id){
  return new Promise((resolve,reject)=>{
    const req = tx('pads').get(id);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function getPadsByPage(page){
  return new Promise((resolve,reject)=>{
    const index = tx('pads').index('by_page');
    const range = IDBKeyRange.only(page);
    const req = index.getAll(range);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function ensurePagePads(page){
  const pads = await getPadsByPage(page);
  if (pads.length === PADS_PER_PAGE) return pads;
  const existing = new Map(pads.map(p=>[p.index,p]));
  const toSave = [];
  for (let i=0;i<PADS_PER_PAGE;i++){
    if (!existing.has(i)){
      toSave.push({
        id: padId(page, i),
        page, index:i,
        name: '',
        color: '#1f2937',
        tags: [],
        mode: 'oneshot',
        group: '',
        vol: 1,
        detune: 0,
        rate: 1,
        fadeIn: 0.03,
        fadeOut: 0.03,
        start: 0,
        end: 0,
        key: '',
        midi: null,
        soundId: '',
        cues: []
      });
    }
  }
  await Promise.all(toSave.map(p=>savePad(p)));
  return getPadsByPage(page);
}

async function saveSound(sound){
  return new Promise((resolve,reject)=>{
    const req = tx('sounds','readwrite').put(sound);
    req.onsuccess = ()=> resolve(sound);
    req.onerror = ()=> reject(req.error);
  });
}

async function getSound(id){
  return new Promise((resolve,reject)=>{
    const req = tx('sounds').get(id);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function deleteSound(id){
  return new Promise((resolve,reject)=>{
    const req = tx('sounds','readwrite').delete(id);
    req.onsuccess = ()=> resolve(true);
    req.onerror = ()=> reject(req.error);
  });
}

async function exportBoard(includeAudio=false){
  const pads = await new Promise((resolve,reject)=>{
    const req = tx('pads').getAll();
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  const soundIds = new Set(pads.map(p=>p.soundId).filter(Boolean));
  const sounds = [];
  if (includeAudio){
    for (const id of soundIds){
      const s = await getSound(id);
      if (!s) continue;
      const ab = await s.blob.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
      sounds.push({ id:s.id, name:s.name, type:s.type, data:`data:${s.type};base64,${b64}` });
    }
  }
  return { version: APP_VERSION, pads, sounds, createdAt: new Date().toISOString() };
}

async function importBoard(data){
  if (!data || !Array.isArray(data.pads)) throw new Error('Invalid board file');
  // Clear pads
  await new Promise((resolve,reject)=>{
    const r = tx('pads','readwrite').clear();
    r.onsuccess = ()=> resolve();
    r.onerror = ()=> reject(r.error);
  });
  // Insert pads
  await Promise.all(data.pads.map(p=>savePad(p)));
  // Sounds (if included)
  if (Array.isArray(data.sounds)){
    for (const s of data.sounds){
      if (!s.data) continue;
      const blob = dataURItoBlob(s.data);
      await saveSound({ id:s.id, name:s.name, type:s.type, blob, createdAt: Date.now() });
    }
  }
}

// --- Data URI -> Blob ---
function dataURItoBlob(uri){
  const [h, b64] = uri.split(',');
  const mime = (h.match(/data:(.*?);base64/)||[])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i=0;i<len;i++) u8[i]=bin.charCodeAt(i);
  return new Blob([u8], {type:mime});
}

// --- UI State ---
let currentPage = 1;
let selectedPadId = null;
let learningKey = false;
let learningMidi = false;
let keyPreview = true;

// --- Rendering ---
function makePadEl(pad){
  const el = document.createElement('div');
  el.className = 'pad';
  el.dataset.id = pad.id;
  el.setAttribute('role','button');
  el.setAttribute('tabindex','0');
  el.setAttribute('aria-label', pad.name || `Pad ${pad.index+1}`);
  el.innerHTML = `
    <div class="colorbar" style="--pad-color:${pad.color||'#1f2937'}"></div>
    <span class="name">${escapeHtml(pad.name||'—')}</span>
    <div class="meta">
      <span class="badge">${pad.mode==='toggleLoop' ? 'Loop' : pad.mode==='gate' ? 'Gate' : 'One'}</span>
      <span class="key">${pad.key ? escapeHtml(pad.key) : ''}</span>
    </div>
  `;

  // Mouse / touch interactions for Gate/Toggle
  el.addEventListener('pointerdown', async (e)=>{
    if (e.button===2){ return; } // right click handled below
    const id = el.dataset.id;
    const pad = await getPad(id);
    if (e.shiftKey){ openEditor(pad); return; }

    if (pad.mode === 'gate'){
      el.classList.add('active');
      triggerPad(pad);
      const stop = ()=>{
        el.classList.remove('active');
        audio.stopPad(pad.id);
        window.removeEventListener('pointerup', stop);
        el.removeEventListener('pointerleave', stop);
      };
      window.addEventListener('pointerup', stop, { once:true });
      el.addEventListener('pointerleave', stop, { once:true });
    } else if (pad.mode === 'toggleLoop'){
      const playing = audio.getPlayingInstanceByPadId(pad.id);
      if (playing){ audio.stopPad(pad.id); el.classList.remove('active'); }
      else { triggerPad(pad, null, {loop:true}); el.classList.add('active'); }
    } else {
      el.classList.add('active');
      triggerPad(pad);
      setTimeout(()=>el.classList.remove('active'), 130);
    }
  });

  el.addEventListener('contextmenu', async (e)=>{
    e.preventDefault();
    const id = el.dataset.id;
    const pad = await getPad(id);
    openEditor(pad);
  });

  return el;
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[c]));
}

async function renderPage(page){
  currentPage = page;
  const pads = await ensurePagePads(page);
  gridEl.innerHTML = '';
  const term = (searchBox.value||'').trim().toLowerCase();
  for (const pad of pads){
    if (term){
      const hay = [pad.name, ...(pad.tags||[]), pad.color].join(' ').toLowerCase();
      if (!hay.includes(term)) continue;
    }
    const el = makePadEl(pad);
    gridEl.appendChild(el);
  }
  pageInfo.textContent = `Showing ${gridEl.children.length}/${PADS_PER_PAGE} pads`;
}

// --- Pad triggering ---
async function triggerPad(pad, cue=null, options={}){
  const sound = pad.soundId ? await getSound(pad.soundId) : null;
  if (!sound){
    status('This pad has no audio yet. Right‑click to assign.', 2000);
    return;
  }
  const cueTime = cue != null ? cue.time : null;

  const loop = !!options.loop || pad.mode === 'toggleLoop';
  await audio.play({ pad, sound, cueTime, loop });
}

// --- Editor ---
let editorPlayhead = 0;

async function openEditor(pad){
  selectedPadId = pad.id;
  padName.value = pad.name||'';
  padColor.value = pad.color||'#1f2937';
  padTags.value = (pad.tags||[]).join(', ');
  padMode.value = pad.mode||'oneshot';
  padGroup.value = pad.group||'';
  padVol.value = pad.vol||1;
  padDetune.value = pad.detune||0;
  padRate.value = pad.rate||1;
  padFadeIn.value = pad.fadeIn||0.03;
  padFadeOut.value = pad.fadeOut||0.03;
  padStart.value = pad.start||0;
  padEnd.value = pad.end||0;
  padKey.value = pad.key||'';
  padMidi.value = pad.midi ? String(pad.midi.note) : '';

  const sound = pad.soundId ? await getSound(pad.soundId) : null;
  audioName.textContent = sound ? sound.name : 'None';
  editorPlayhead = parseFloat(pad.start||0) || 0;
  await drawWaveform(sound, pad);

  cueList.innerHTML = '';
  for (const c of (pad.cues||[])){
    const li = document.createElement('li');
    li.textContent = `${c.label||'Cue'} @ ${fmtTime(c.time)}`;
    li.addEventListener('click', ()=> triggerPad(pad, c));
    cueList.appendChild(li);
  }

  editor.hidden = false;
}

closeEditor.addEventListener('click', ()=> editor.hidden = true);

padForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!selectedPadId) return;
  const pad = await getPad(selectedPadId);
  pad.name = padName.value.trim();
  pad.color = padColor.value;
  pad.tags = padTags.value.split(',').map(s=>s.trim()).filter(Boolean);
  pad.mode = padMode.value;
  pad.group = padGroup.value.trim();
  pad.vol = parseFloat(padVol.value)||1;
  pad.detune = parseFloat(padDetune.value)||0;
  pad.rate = parseFloat(padRate.value)||1;
  pad.fadeIn = parseFloat(padFadeIn.value)||0.03;
  pad.fadeOut = parseFloat(padFadeOut.value)||0.03;
  pad.start = parseFloat(padStart.value)||0;
  pad.end = parseFloat(padEnd.value)||0;
  pad.key = padKey.value.trim();
  pad.midi = padMidi.value ? { note: parseInt(padMidi.value,10) } : null;
  await savePad(pad);
  editor.hidden = true;
  renderPage(currentPage);
  status('Pad saved ✓', 1500);
});

btnDuplicatePad.addEventListener('click', async ()=>{
  if (!selectedPadId) return;
  const pad = await getPad(selectedPadId);
  // Find next empty pad in the page
  const pads = await ensurePagePads(pad.page);
  const empty = pads.find(p=>!p.soundId);
  if (!empty){
    status('No empty pad in this bank.', 2000);
    return;
  }
  Object.assign(empty, {
    name: pad.name + ' (copy)',
    color: pad.color,
    tags: [...(pad.tags||[])],
    mode: pad.mode, group: pad.group,
    vol: pad.vol, detune: pad.detune, rate: pad.rate,
    fadeIn: pad.fadeIn, fadeOut: pad.fadeOut,
    start: pad.start, end: pad.end,
    key: '', midi: null,
    soundId: pad.soundId,
    cues: (pad.cues||[]).map(c=>({...c}))
  });
  await savePad(empty);
  renderPage(currentPage);
  status('Duplicated to next empty pad ✓', 1500);
});

btnDeletePadAudio.addEventListener('click', async ()=>{
  if (!selectedPadId) return;
  const pad = await getPad(selectedPadId);
  pad.soundId = '';
  await savePad(pad);
  audioName.textContent = 'None';
  await drawWaveform(null, pad);
  renderPage(currentPage);
  status('Removed audio from pad.', 1500);
});

btnAssignAudio.addEventListener('click', ()=> assignInput.click());
assignInput.addEventListener('change', async (e)=>{
  if (!selectedPadId) return;
  const file = e.target.files[0];
  if (!file) return;
  const id = uuid();
  await saveSound({ id, name:file.name, type:file.type||'audio/*', blob: file, createdAt: Date.now() });
  const pad = await getPad(selectedPadId);
  pad.soundId = id;
  await savePad(pad);
  audioName.textContent = file.name;
  await drawWaveform({ id, name:file.name, blob:file }, pad);
  status('Audio assigned ✓', 1500);
  renderPage(currentPage);
  e.target.value = '';
});

btnAddCue.addEventListener('click', async ()=>{
  if (!selectedPadId) return;
  const pad = await getPad(selectedPadId);
  const label = prompt('Cue label?', `Cue ${pad.cues.length+1}`);
  pad.cues.push({ id: uuid(), time: editorPlayhead, label });
  await savePad(pad);
  openEditor(pad);
});
btnClearCues.addEventListener('click', async ()=>{
  if (!selectedPadId) return;
  const pad = await getPad(selectedPadId);
  pad.cues = [];
  await savePad(pad);
  openEditor(pad);
});

btnLearnKey.addEventListener('click', ()=>{
  learningKey = true;
  padKey.value = 'Press any key…';
  padKey.classList.add('muted');
});
btnLearnMidi.addEventListener('click', ()=>{
  learningMidi = true;
  padMidi.value = 'Play a note…';
  padMidi.classList.add('muted');
  if (!midiAccess) initMIDI();
});

document.addEventListener('keydown', async (e)=>{
  if (learningKey && selectedPadId){
    e.preventDefault();
    const keyLabel = keyToLabel(e);
    padKey.value = keyLabel;
    padKey.classList.remove('muted');
    learningKey = false;
    return;
  }
  if (e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;

  // Bank navigation
  if (e.key === 'PageUp'){ e.preventDefault(); if (currentPage>1) pageSelect.value = String(currentPage-1), pageSelect.dispatchEvent(new Event('change')); return; }
  if (e.key === 'PageDown'){ e.preventDefault(); if (currentPage<PAGES) pageSelect.value = String(currentPage+1), pageSelect.dispatchEvent(new Event('change')); return; }

  // Key trigger
  const pads = await ensurePagePads(currentPage);
  const pad = pads.find(p=> p.key && keyMatches(e, p.key) );
  if (pad){
    e.preventDefault();
    if (pad.mode === 'toggleLoop'){
      const playing = audio.getPlayingInstanceByPadId(pad.id);
      if (playing) audio.stopPad(pad.id);
      else triggerPad(pad);
    } else if (pad.mode === 'gate'){
      // Start on keydown, stop on keyup
      triggerPad(pad);
      const up = (ev)=>{
        if (keyMatches(ev, pad.key)){
          audio.stopPad(pad.id);
          window.removeEventListener('keyup', up);
        }
      };
      window.addEventListener('keyup', up);
    } else {
      triggerPad(pad);
    }
  }
});

function keyToLabel(e){
  if (e.code.startsWith('Key')) return e.code.replace('Key','').toUpperCase();
  if (e.code.startsWith('Digit')) return e.code.replace('Digit','');
  return e.code;
}
function keyMatches(e, label){
  const code = e.code;
  if (label.length===1){
    if (/[A-Z]/.test(label)) return code === `Key${label}`;
    if (/[0-9]/.test(label)) return code === `Digit${label}`;
  }
  return code === label;
}

// --- Waveform ---
async function drawWaveform(sound, pad){
  const ratio = (window.devicePixelRatio || 1);
  const w = waveCanvas.width = Math.max(400, waveCanvas.clientWidth) * ratio;
  const h = waveCanvas.height = waveCanvas.clientHeight * ratio || 96*ratio;

  const bg = '#0b1220';
  const grid = '#223047';
  const line = '#60a5fa';
  const sel = 'rgba(34,197,94,0.18)';
  const playheadColor = '#22c55e';

  const ctx = waveCtx;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(0,0,w,h);

  if (!sound || !audio.context){
    return;
  }
  const buffer = await audio.ensureBuffer(sound);
  const ch = buffer.getChannelData(0);
  const samples = ch.length;
  const step = Math.max(1, Math.floor(samples / w));
  const amp = h/2 * 0.9;

  // Grid lines
  ctx.strokeStyle = grid;
  ctx.beginPath();
  for (let x=0; x<w; x+=Math.floor(w/10)){
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();

  // Waveform
  ctx.translate(0, h/2);
  ctx.strokeStyle = line;
  ctx.beginPath();
  for (let x=0, i=0; x<w; x++, i+=step){
    let min=1, max=-1;
    for (let j=0;j<step;j++){
      const v = ch[i+j] || 0;
      if (v<min) min=v;
      if (v>max) max=v;
    }
    ctx.moveTo(x, min*amp);
    ctx.lineTo(x, max*amp);
  }
  ctx.stroke();
  ctx.setTransform(1,0,0,1,0,0);

  // Start/End selection
  const start = Math.max(0, parseFloat(pad.start||0));
  const end = Math.max(0, parseFloat(pad.end||0));
  const dur = buffer.duration;
  const sx = (start/dur)*w;
  const ex = (end>0 ? (end/dur)*w : w);

  ctx.fillStyle = sel;
  ctx.fillRect(sx, 0, ex - sx, h);

  // Playhead
  const px = (editorPlayhead/dur)*w;
  ctx.strokeStyle = playheadColor;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();

  // Interaction
  waveCanvas.onmousemove = (e)=>{
    waveCanvas.style.cursor = (e.altKey||e.ctrlKey) ? 'copy' : 'crosshair';
  };
  waveCanvas.onclick = async (e)=>{
    if (!selectedPadId) return;
    const rect = waveCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * ratio;
    const t = (x / w) * dur;
    if (e.ctrlKey){
      padStart.value = t.toFixed(2);
      const pad = await getPad(selectedPadId);
      pad.start = parseFloat(padStart.value)||0;
      await savePad(pad);
      editorPlayhead = pad.start;
    } else if (e.altKey){
      padEnd.value = t.toFixed(2);
      const pad = await getPad(selectedPadId);
      pad.end = parseFloat(padEnd.value)||0;
      await savePad(pad);
      editorPlayhead = pad.end || editorPlayhead;
    } else {
      editorPlayhead = t;
    }
    const pad = await getPad(selectedPadId);
    await drawWaveform(sound, pad);
  };
}

// --- Build page selector ---
function buildPageSelect(){
  pageSelect.innerHTML = '';
  for (let p=1;p<=PAGES;p++){
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `Bank ${p}`;
    pageSelect.appendChild(opt);
  }
  pageSelect.value = String(currentPage);
}

// --- Search ---
searchBox.addEventListener('input', ()=> renderPage(currentPage));

// --- Page navigation ---
pageSelect.addEventListener('change', ()=> renderPage(parseInt(pageSelect.value,10)));
btnPrev.addEventListener('click', ()=> { if (currentPage>1){ pageSelect.value = String(currentPage-1); pageSelect.dispatchEvent(new Event('change')); }});
btnNext.addEventListener('click', ()=> { if (currentPage<PAGES){ pageSelect.value = String(currentPage+1); pageSelect.dispatchEvent(new Event('change')); }});

// --- Add sounds (global) ---
btnAdd.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files||[]);
  await addFiles(files);
  e.target.value='';
});

async function addFiles(files){
  if (!files.length) return;
  await audio.arm(); // ensure AudioContext so decode is fast later
  let assigned = 0;
  const pads = await ensurePagePads(currentPage);
  let idx = pads.findIndex(p=>!p.soundId);
  if (idx<0) idx = 0;

  for (const file of files){
    const id = uuid();
    await saveSound({ id, name:file.name, type:file.type||'audio/*', blob: file, createdAt: Date.now() });
    // Auto assign to next empty pad (or overwrite if none empty)
    const pad = pads[idx] || pads[pads.length-1];
    pad.name = pad.name || file.name.replace(/\.[^/.]+$/, '');
    pad.soundId = id;
    await savePad(pad);
    idx = Math.min(pads.length-1, idx+1);
    assigned++;
  }
  status(`Added ${assigned} file(s) ✓`, 2000);
  renderPage(currentPage);
}

// --- Drag & drop ---
document.addEventListener('dragover', (e)=>{ e.preventDefault(); });
document.addEventListener('drop', async (e)=>{
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files||[]).filter(f=>f.type.startsWith('audio/'));
  await addFiles(files);
});

// --- Stop all ---
btnStopAll.addEventListener('click', ()=> audio.stopAll());

// --- Export / Import ---
btnExport.addEventListener('click', ()=> exportDialog.showModal());
confirmExport.addEventListener('click', async ()=>{
  const data = await exportBoard(exportWithAudio.checked);
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `soundboard-${Date.now()}${exportWithAudio.checked?'-with-audio':''}.json`;
  a.click();
  exportDialog.close();
});

btnImport.addEventListener('click', ()=> importDialog.showModal());
confirmImport.addEventListener('click', async ()=>{
  const file = importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  await importBoard(data);
  importDialog.close();
  renderPage(currentPage);
  status('Board imported ✓', 2000);
});

// --- Settings ---
btnSettings.addEventListener('click', ()=> settingsDialog.showModal());
settingsDialog.addEventListener('close', ()=>{
  keyPreview = settingKeyPreview.checked;
  if (settingMidi.checked) initMIDI();
});

// --- Master volume ---
masterVol.addEventListener('input', ()=> audio.setMasterVolume(parseFloat(masterVol.value)));

// --- PWA install button ---
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  installEvt = e;
  btnInstall.hidden = false;
});
btnInstall.addEventListener('click', async ()=>{
  if (!installEvt) return;
  installEvt.prompt();
  const choice = await installEvt.userChoice;
  if (choice.outcome === 'accepted'){
    btnInstall.hidden = true;
  }
});

// --- Arm audio ---
btnArmAudio.addEventListener('click', ()=> audio.arm());

// --- Status helper ---
let statusTimer = null;
function status(msg, ms=0){
  statusEl.textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  if (ms>0){
    statusTimer = setTimeout(()=>{ statusEl.textContent = 'Ready'; }, ms);
  }
}

// --- MIDI (optional) ---
let midiAccess = null;
async function initMIDI(){
  if (!('requestMIDIAccess' in navigator)) return;
  try{
    midiAccess = await navigator.requestMIDIAccess({ sysex:false });
    midiAccess.inputs.forEach(input => {
      input.onmidimessage = onMIDIMessage;
    });
    status('MIDI ready ✓', 1500);
  }catch(err){ console.warn('MIDI init failed', err); }
}
function onMIDIMessage(e){
  const [statusByte, note, vel] = e.data;
  const cmd = statusByte & 0xf0;
  if (cmd === 0x90 && vel>0){ // note on
    if (learningMidi && selectedPadId){
      learningMidi = false;
      (async ()=>{
        const pad = await getPad(selectedPadId);
        pad.midi = { note };
        await savePad(pad);
        padMidi.value = String(note);
        padMidi.classList.remove('muted');
        status('MIDI mapped ✓', 1200);
      })();
      return;
    }
    handleMIDINote(note);
  }
}
async function handleMIDINote(note){
  const pads = await ensurePagePads(currentPage);
  const pad = pads.find(p=> p.midi && p.midi.note === note );
  if (!pad) return;
  if (pad.mode === 'toggleLoop'){
    const playing = audio.getPlayingInstanceByPadId(pad.id);
    if (playing) audio.stopPad(pad.id);
    else triggerPad(pad);
  } else if (pad.mode === 'gate'){
    triggerPad(pad);
    // No keyup for MIDI: stop after velocity 0 (note off), but some controllers send note on vel 0
    // For simplicity we set a short timeout unless a note off arrives (out of scope here)
    setTimeout(()=> audio.stopPad(pad.id), 300);
  } else {
    triggerPad(pad);
  }
}

// --- Boot ---
(async function boot(){
  if ('serviceWorker' in navigator){
    try{ navigator.serviceWorker.register('./service-worker.js'); }catch{}
  }
  db = await openDB();
  buildPageSelect();
  await renderPage(currentPage);
  settingKeyPreview.checked = true;
  status('Ready');
})();
