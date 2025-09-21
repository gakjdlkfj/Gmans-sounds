// Open Sports Soundboard Pro (with Spotify integration)
// 8,640 pads (72 banks * 120 pads), instant play via Web Audio API, color-coded pads,
// custom cue control, import/export, offline (PWA), drag & drop uploads, keyboard + MIDI learn,
// and optional Spotify connect to assign/play tracks via the Web Playback SDK.

const APP_VERSION = 'v1.2.0';
const PADS_PER_PAGE = 120;     // 12 x 10 grid
const PAGES = 72;              // 72 banks
const TOTAL_PADS = PADS_PER_PAGE * PAGES;

// ---- Spotify config ----
// Set these before deploying (see README.md).
// Example: For GitHub Pages at https://user.github.io/repo/, set SPOTIFY_REDIRECT_URI to that exact URL.
const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname; // change if needed
const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');

class SpotifyIntegration{
  constructor(){
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.player = null;
    this.deviceId = null;
    this.user = null;
    this.ready = false;
  }
  async login(){
    if (!SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID.includes('YOUR_')){
      alert('Please configure SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI in app.js (see README).');
      return;
    }
    const state = crypto.getRandomValues(new Uint8Array(16)).join('');
    const codeVerifier = this._base64url(crypto.getRandomValues(new Uint8Array(64)));
    const codeChallenge = await this._sha256base64url(codeVerifier);
    sessionStorage.setItem('sp_state', state);
    sessionStorage.setItem('sp_code_verifier', codeVerifier);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
    url.searchParams.set('scope', SPOTIFY_SCOPES);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('state', state);
    url.searchParams.set('show_dialog', 'true');
    window.location.href = url.toString();
  }
  async handleRedirectCallback(){
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return false;
    const storedState = sessionStorage.getItem('sp_state');
    const codeVerifier = sessionStorage.getItem('sp_code_verifier');
    if (!state || state !== storedState){ alert('Spotify auth failed: state mismatch.'); return false; }
    window.history.replaceState({}, document.title, window.location.pathname);
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', SPOTIFY_REDIRECT_URI);
    body.set('client_id', SPOTIFY_CLIENT_ID);
    body.set('code_verifier', codeVerifier);
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body
    });
    if (!res.ok){ alert('Spotify token exchange failed.'); return false; }
    const json = await res.json();
    this._storeTokens(json);
    await this.bootstrap();
    return true;
  }
  async refreshIfNeeded(){
    const now = Date.now();
    if (this.accessToken && now < this.expiresAt - 60000) return;
    if (!this.refreshToken) return;
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', this.refreshToken);
    body.set('client_id', SPOTIFY_CLIENT_ID);
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body
    });
    if (res.ok){
      const json = await res.json();
      json.refresh_token = json.refresh_token || this.refreshToken;
      this._storeTokens(json);
    }
  }
  logout(){
    localStorage.removeItem('sp_tokens');
    this.accessToken = this.refreshToken = null;
    this.expiresAt = 0;
    this.user = null;
    this.ready = false;
    if (this.player){ try{ this.player.disconnect(); }catch{} this.player=null; }
  }
  _storeTokens(json){
    this.accessToken = json.access_token;
    this.refreshToken = json.refresh_token || this.refreshToken;
    this.expiresAt = Date.now() + (json.expires_in||3600)*1000;
    localStorage.setItem('sp_tokens', JSON.stringify({
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt
    }));
  }
  restoreTokens(){
    try{
      const raw = localStorage.getItem('sp_tokens');
      if (!raw) return false;
      const t = JSON.parse(raw);
      this.accessToken = t.access_token;
      this.refreshToken = t.refresh_token;
      this.expiresAt = t.expires_at || 0;
      return !!this.accessToken;
    }catch{ return false; }
  }
  async bootstrap(){
    await this.refreshIfNeeded();
    if (!this.accessToken) return false;
    this.user = await this.api('/me');
    await this._loadSDK();
    await this._createPlayer();
    this.ready = !!this.player && !!this.deviceId;
    return this.ready;
  }
  async _loadSDK(){
    if (window.Spotify) return;
    await new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
    await new Promise(resolve=>{ window.onSpotifyWebPlaybackSDKReady = resolve; });
  }
  async _createPlayer(){
    if (this.player) try{ this.player.disconnect(); }catch{}
    this.player = new Spotify.Player({
      name: 'Open Sports Soundboard Pro',
      getOAuthToken: async cb => { await this.refreshIfNeeded(); cb(this.accessToken); },
      volume: parseFloat(masterVol.value)||0.9
    });
    this.player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id;
      this.transferPlayback(true);
    });
    this.player.addListener('not_ready', ({ device_id }) => {
      if (this.deviceId === device_id) this.deviceId = null;
    });
    this.player.addListener('initialization_error', ({ message }) => console.warn('Spotify init error', message));
    this.player.addListener('authentication_error', ({ message }) => console.warn('Spotify auth error', message));
    this.player.addListener('account_error', ({ message }) => console.warn('Spotify account error', message));
    await this.player.connect();
  }
  async transferPlayback(play=true){
    if (!this.deviceId) return;
    await this.api('/me/player','PUT',{ device_ids:[this.deviceId], play });
  }
  async api(path, method='GET', body=null){
    await this.refreshIfNeeded();
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method, headers:{ 'Authorization':`Bearer ${this.accessToken}`, 'Content-Type':'application/json' },
      body: body?JSON.stringify(body):null
    });
    if (res.status===204) return true;
    if (!res.ok){ console.warn('Spotify API error', res.status); return null; }
    return res.json();
  }
  async searchTracks(q, limit=40){
    const j = await this.api(`/search?type=track&q=${encodeURIComponent(q)}&limit=${limit}`);
    return j?.tracks?.items || [];
  }
  async getMyPlaylists(limit=30){ const j = await this.api(`/me/playlists?limit=${limit}`); return j?.items||[]; }
  async getPlaylistTracks(id, limit=100){ const j = await this.api(`/playlists/${id}/tracks?limit=${limit}`); return (j?.items||[]).map(x=>x.track).filter(Boolean); }
  async playUri(uri, position_ms=0, repeatTrack=false){
    if (!this.deviceId) await this.transferPlayback(true);
    await this.api(`/me/player/play?device_id=${this.deviceId}`, 'PUT', { uris:[uri], position_ms });
    if (repeatTrack) await this.api(`/me/player/repeat?state=track&device_id=${this.deviceId}`, 'PUT');
  }
  async pause(){
    await this.api(`/me/player/pause?device_id=${this.deviceId}`, 'PUT');
    await this.api(`/me/player/repeat?state=off&device_id=${this.deviceId}`, 'PUT');
  }
  async setVolume(v){ try{ await this.player.setVolume(v); }catch{} }
  async _sha256base64url(str){ const data = new TextEncoder().encode(str); const digest = await crypto.subtle.digest('SHA-256', data); return this._base64url(new Uint8Array(digest)); }
  _base64url(bytes){ let s = Array.from(bytes).map(b=>String.fromCharCode(b)).join(''); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
}
const spotify = new SpotifyIntegration();

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
const btnAddSpotify = $('#btnAddSpotify');
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
const spotifyClientIdInput = $('#spotifyClientId');
const btnSpotifyConnect = $('#btnSpotifyConnect');
const spotifyStatus = $('#spotifyStatus');
const settingWaveformHQ = $('#settingWaveformHQ');
const settingKeyPreview = $('#settingKeyPreview');
const settingMidi = $('#settingMidi');
const masterVol = $('#masterVol');
const latencyLabel = $('#latency');
const statusEl = $('#status');
const btnInstall = $('#btnInstall');
const btnArmAudio = $('#btnArmAudio');
const btnSpotify = $('#btnSpotify');
const btnSpotifyAdd = $('#btnSpotifyAdd');
const spotifyDialog = $('#spotifyDialog');
const spSearch = $('#spSearch');
const spDoSearch = $('#spDoSearch');
const spResults = $('#spResults');
const spPlaylists = $('#spPlaylists');
const spFetchPlaylists = $('#spFetchPlaylists');
const spWho = $('#spWho');
const spLogout = $('#spLogout');

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
const spotifyDialog = $('#spotifyDialog');
const spotifyQuery = $('#spotifyQuery');
const spotifyResults = $('#spotifyResults');

$('#version').textContent = APP_VERSION;

// --- Utilities ---
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function fmtTime(sec){ if (!sec || sec <= 0) return '0:00'; const m = Math.floor(sec/60); const s = Math.floor(sec%60).toString().padStart(2,'0'); return `${m}:${s}`; }
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }
function padId(page, index){ return `${page}:${index}`; }
function parsePadId(id){ const [p,i]=id.split(':').map(n=>+n); return {page:p,index:i}; }

// --- Audio Engine (local files) ---
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
      this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: this.latencyHint });
      this.master = this.context.createGain();
      this.master.gain.value = parseFloat(masterVol.value);
      this.master.connect(this.context.destination);
      latencyLabel.textContent = `${(this.context.baseLatency*1000|0)} ms`;
    }
    if (this.context.state !== 'running'){ await this.context.resume(); }
    this.armed = true;
    status('Audio armed ✓');
  }
  setMasterVolume(v){ if (this.master) this.master.gain.value = v; }
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
        }else{ source.stop(); }
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
    for (const [id, p] of this.playing){ if (p.padId === padId) return {id, ...p}; }
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

    if (loop){
      source.loop = true;
      source.loopStart = playFrom;
      source.loopEnd = realEnd;
    }

    const t = startAt;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + Math.max(0.005, fadeIn));

    let stopAt = null;
    if (!loop && pad.mode === 'oneshot'){
      stopAt = t + maxPlay + fadeOut;
      gain.gain.setTargetAtTime(0.0001, stopAt - fadeOut, Math.max(0.005, fadeOut/5));
    }

    source.onended = () => { this.playing.delete(instanceId); };
    source.start(t, playFrom);
    if (stopAt) source.stop(stopAt);

    this.playing.set(instanceId, {source, gain, padId: pad.id, soundId: sound.id, group, loop});
    return instanceId;
  }
}

// --- Spotify Integration ---
// NOTE: Spotify tracks cannot be decoded/edited like local files. We stream using the Spotify Web Playback SDK.
// Requirements: Spotify Premium account; client ID; redirect URI matching this page URL in your Spotify app settings.
class SpotifyEngine{
  constructor(){
    this.token = null;           // OAuth access token
    this.clientId = null;
    this.player = null;          // Spotify.Player
    this.deviceId = null;
    this.ready = false;
    this.poll = null;
  }
  async loadSDK(){
    if (window.Spotify) return;
    await new Promise((resolve)=>{
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  restoreFromStorage(){
    try{
      const meta = localStorage.getItem('ossb-spotify');
      if (!meta) return;
      const { token, clientId, tokenExpiresAt } = JSON.parse(meta);
      if (token && tokenExpiresAt && Date.now() < tokenExpiresAt){
        this.token = token;
      }
      if (clientId) this.clientId = clientId;
    }catch{}
  }
  persist(){
    localStorage.setItem('ossb-spotify', JSON.stringify({
      token: this.token,
      clientId: this.clientId,
      tokenExpiresAt: this.token ? (Date.now() + 55*60*1000) : 0 // 55 minutes
    }));
  }
  setClientId(id){
    this.clientId = (id||'').trim();
    this.persist();
  }
  isConnected(){
    return !!(this.token && this.deviceId);
  }
  updateUI(){
    if (spotifyStatus){
      spotifyStatus.textContent = this.isConnected() ? 'Connected to Spotify ✓' : (this.token ? 'Authorized; player not ready' : 'Not connected');
    }
  }
  async connect(){
    // PKCE OAuth (Authorization Code with PKCE)
    if (!this.clientId) throw new Error('Missing Spotify Client ID');
    const redirectUri = window.location.origin + window.location.pathname; // same page
    const verifier = this._randomString(64);
    const challenge = await this._pkceChallenge(verifier);
    localStorage.setItem('ossb-spotify-verifier', verifier);

    const scope = [
      'streaming', 'user-read-email', 'user-read-private',
      'user-modify-playback-state', 'user-read-playback-state'
    ].join(' ');

    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('response_type','code');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge_method','S256');
    authUrl.searchParams.set('code_challenge', challenge);
    window.location.assign(authUrl.toString());
  }
  async completeAuthIfNeeded(){
    const params = new URLSearchParams(window.location.search);
    if (!params.get('code')) return false;
    const code = params.get('code');
    const verifier = localStorage.getItem('ossb-spotify-verifier');
    const redirectUri = window.location.origin + window.location.pathname;

    // Exchange code for token
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      code_verifier: verifier
    });

    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!resp.ok){
      console.warn('Spotify token exchange failed', await resp.text());
      return false;
    }
    const data = await resp.json();
    this.token = data.access_token;
    this.persist();

    // Clean up URL
    history.replaceState({}, document.title, window.location.pathname);
    return true;
  }
  async initPlayer(){
    await this.loadSDK();
    if (!this.token) return;
    return new Promise((resolve) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.player = new Spotify.Player({
          name: 'Open Sports Soundboard Pro',
          getOAuthToken: cb => cb(this.token),
          volume: 1.0
        });
        this.player.addListener('ready', ({ device_id }) => {
          this.deviceId = device_id;
          this.ready = true;
          this.updateUI();
          resolve(true);
        });
        this.player.addListener('not_ready', ({ device_id }) => {
          if (this.deviceId === device_id) this.ready = false;
          this.updateUI();
        });
        this.player.addListener('initialization_error', ({ message }) => console.error(message));
        this.player.addListener('authentication_error', ({ message }) => console.error(message));
        this.player.addListener('account_error', ({ message }) => console.error(message));
        this.player.connect();
      };
      if (window.Spotify && !window.onSpotifyWebPlaybackSDKReady){
        // SDK already loaded; manually trigger
        window.onSpotifyWebPlaybackSDKReady = ()=>{};
        const dummy = window.onSpotifyWebPlaybackSDKReady;
        dummy();
      }
    });
  }
  async ensureReady(){
    this.restoreFromStorage();
    this.updateUI();
    await this.completeAuthIfNeeded();
    this.restoreFromStorage(); // token may have just been saved
    if (!this.player && this.token){
      await this.initPlayer();
    }
    return this.isConnected();
  }
  async transferPlayback(){
    if (!this.token || !this.deviceId) return;
    await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [this.deviceId], play: false })
    });
  }
  async playTrack({ uri, position_ms=0 }){
    await this.transferPlayback();
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri], position_ms })
    });
    if (!resp.ok){
      console.warn('Spotify play failed', await resp.text());
    }
  }
  async pause(){
    if (!this.token) return;
    await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(this.deviceId)}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
  }
  async seek(ms){
    if (!this.token) return;
    await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.max(0, Math.floor(ms))}&device_id=${encodeURIComponent(this.deviceId)}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
  }
  async searchTracks(q, limit=20){
    if (!this.token) throw new Error('Not connected to Spotify');
    const resp = await fetch(`https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    if (!resp.ok) throw new Error('Spotify search failed');
    return resp.json();
  }
  // Utility: PKCE
  _randomString(len){
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let s='';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (const v of arr){ s += chars[v % chars.length]; }
    return s;
  }
  async _pkceChallenge(verifier){
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const b = String.fromCharCode(...new Uint8Array(digest));
    return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}

const spotify = new SpotifyEngine();

const audio = new AudioEngine();

// --- IndexedDB ---
const DB_NAME = 'ossb-pro';
const DB_VERSION = 4;
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
      }
      if (!d.objectStoreNames.contains('meta')){
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }

async function savePad(pad){ return new Promise((resolve,reject)=>{ const req = tx('pads','readwrite').put(pad); req.onsuccess=()=>resolve(pad); req.onerror=()=>reject(req.error); }); }
async function getPad(id){ return new Promise((resolve,reject)=>{ const req = tx('pads').get(id); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
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
        srcType: 'local',
        soundId: '',
        spotify: null,
        cues: [],
        spotify: null
      });
    }
  }
  await Promise.all(toSave.map(p=>savePad(p)));
  return getPadsByPage(page);
}
async function saveSound(sound){ return new Promise((resolve,reject)=>{ const req = tx('sounds','readwrite').put(sound); req.onsuccess=()=>resolve(sound); req.onerror=()=>reject(req.error); }); }
async function getSound(id){ return new Promise((resolve,reject)=>{ const req = tx('sounds').get(id); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function deleteSound(id){ return new Promise((resolve,reject)=>{ const req = tx('sounds','readwrite').delete(id); req.onsuccess=()=>resolve(true); req.onerror=()=>reject(req.error); }); }
async function exportBoard(includeAudio=false){
  const pads = await new Promise((resolve,reject)=>{ const req = tx('pads').getAll(); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
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
  await new Promise((resolve,reject)=>{ const r = tx('pads','readwrite').clear(); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
  await Promise.all(data.pads.map(p=>savePad(p)));
  if (Array.isArray(data.sounds)){
    for (const s of data.sounds){
      if (!s.data) continue;
      const blob = dataURItoBlob(s.data);
      await saveSound({ id:s.id, name:s.name, type:s.type, blob, createdAt: Date.now() });
    }
  }
}
function dataURItoBlob(uri){
  const [h, b64] = uri.split(',');
  const mime = (h.match(/data:(.*?);base64/)||[])[1] || 'application/octet-stream';
  const bin = atob(b64); const len = bin.length; const u8 = new Uint8Array(len);
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
      <span class="badge">${pad.spotify ? 'SP' : (pad.mode==='toggleLoop' ? 'Loop' : pad.mode==='gate' ? 'Gate' : 'One')}</span>
      <span class="key">${pad.key ? escapeHtml(pad.key) : ''}</span>
    </div>
  `;
  el.addEventListener('pointerdown', async (e)=>{
    if (e.button===2){ return; }
    const id = el.dataset.id;
    const pad = await getPad(id);
    if (e.shiftKey){ openEditor(pad); return; }
    if (pad.mode === 'gate'){
      el.classList.add('active');
      triggerPad(pad);
      const stop = ()=>{
        el.classList.remove('active');
        if (pad.spotify) { spotify.pause(); } else { audio.stopPad(pad.id); }
        window.removeEventListener('pointerup', stop);
        el.removeEventListener('pointerleave', stop);
      };
      window.addEventListener('pointerup', stop, { once:true });
      el.addEventListener('pointerleave', stop, { once:true });
    } else if (pad.mode === 'toggleLoop'){
      const playing = audio.getPlayingInstanceByPadId(pad.id);
      if (pad.spotify){
        // Toggle play/pause with repeat
        // No easy state query; just pause to stop.
        spotify.playUri(pad.spotify.uri, Math.floor((pad.start||0)*1000), true);
        el.classList.add('active');
      } else {
        if (playing){ audio.stopPad(pad.id); el.classList.remove('active'); }
        else { triggerPad(pad, null, {loop:true}); el.classList.add('active'); }
      }
    } else {
      el.classList.add('active'); triggerPad(pad); setTimeout(()=>el.classList.remove('active'), 130);
    }
  });
  el.addEventListener('contextmenu', async (e)=>{ e.preventDefault(); const id = el.dataset.id; const pad = await getPad(id); openEditor(pad); });
  return el;
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;","">":"&gt;",""":"&quot;","'":"&#39;"}[c])); }
async function renderPage(page){
  currentPage = page;
  const pads = await ensurePagePads(page);
  gridEl.innerHTML = '';
  const term = (searchBox.value||'').trim().toLowerCase();
  for (const pad of pads){
    if (term){
      const hay = [pad.name, ...(pad.tags||[]), pad.color, (pad.spotify?.title||''), (pad.spotify?.artist||'')].join(' ').toLowerCase();
      if (!hay.includes(term)) continue;
    }
    const el = makePadEl(pad);
    gridEl.appendChild(el);
  }
  pageInfo.textContent = `Showing ${gridEl.children.length}/${PADS_PER_PAGE} pads`;
}

// --- Pad triggering ---
async function triggerPad(pad, cue=null, options={}){
  // Spotify-backed pad
  if (pad.spotify){
    const startSec = (cue ? cue.time : (pad.start||0)) || 0;
    if (!spotify.accessToken && !spotify.restoreTokens()){ status('Connect Spotify first (top right).', 2000); return; }
    await spotify.bootstrap();
    const repeat = pad.mode==='toggleLoop';
    await spotify.playUri(pad.spotify.uri, Math.floor(startSec*1000), repeat);
    return;
  }
  // Local audio pad
  const sound = pad.soundId ? await getSound(pad.soundId) : null;
  if (!sound){ status('This pad has no audio yet. Right‑click to assign or use Spotify.', 2200); return; }
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
  audioName.textContent = sound ? sound.name : (pad.spotify ? `${pad.spotify.title} (Spotify)` : 'None');
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
  const pads = await ensurePagePads(pad.page);
  const empty = pads.find(p=>!p.soundId && !p.spotify);
  if (!empty){ status('No empty pad in this bank.', 2000); return; }
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
    spotify: pad.spotify ? { ...pad.spotify } : null,
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
  pad.spotify = null;
  await savePad(pad);
  audioName.textContent = 'None';
  await drawWaveform(null, pad);
  renderPage(currentPage);
  status('Removed audio/Spotify from pad.', 1500);
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
  pad.spotify = null;
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

  if (e.key === 'PageUp'){ e.preventDefault(); if (currentPage>1) pageSelect.value = String(currentPage-1), pageSelect.dispatchEvent(new Event('change')); return; }
  if (e.key === 'PageDown'){ e.preventDefault(); if (currentPage<PAGES) pageSelect.value = String(currentPage+1), pageSelect.dispatchEvent(new Event('change')); return; }

  const pads = await ensurePagePads(currentPage);
  const pad = pads.find(p=> p.key && keyMatches(e, p.key) );
  if (pad){
    e.preventDefault();
    if (pad.mode === 'toggleLoop'){
      const playing = audio.getPlayingInstanceByPadId(pad.id);
      if (pad.spotify){
        spotify.playUri(pad.spotify.uri, Math.floor((pad.start||0)*1000), true);
      } else {
        if (playing) audio.stopPad(pad.id); else triggerPad(pad);
      }
    } else if (pad.mode === 'gate'){
      // Start on keydown, stop on keyup
      triggerPad(pad);
      const up = (ev)=>{
        if (keyMatches(ev, pad.key)){
          if (pad.spotify) spotify.pause(); else audio.stopPad(pad.id);
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

  if (!sound || !audio.context){ return; }
  const buffer = await audio.ensureBuffer(sound);
  const ch = buffer.getChannelData(0);
  const samples = ch.length;
  const step = Math.max(1, Math.floor(samples / w));
  const amp = h/2 * 0.9;

  ctx.strokeStyle = grid; ctx.beginPath();
  for (let x=0; x<w; x+=Math.floor(w/10)){ ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  ctx.stroke();

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

  const start = Math.max(0, parseFloat(pad.start||0));
  const end = Math.max(0, parseFloat(pad.end||0));
  const dur = buffer.duration;
  const sx = (start/dur)*w;
  const ex = (end>0 ? (end/dur)*w : w);

  ctx.fillStyle = sel;
  ctx.fillRect(sx, 0, ex - sx, h);

  const px = (editorPlayhead/dur)*w;
  ctx.strokeStyle = playheadColor; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();

  waveCanvas.onmousemove = (e)=>{ waveCanvas.style.cursor = (e.altKey||e.ctrlKey) ? 'copy' : 'crosshair'; };
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

// --- Add sounds (local) ---
btnAdd.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', async (e)=>{ const files = Array.from(e.target.files||[]); await addFiles(files); e.target.value=''; });
async function addFiles(files){
  if (!files.length) return;
  await audio.arm();
  let assigned = 0;
  const pads = await ensurePagePads(currentPage);
  let idx = pads.findIndex(p=>!p.soundId && !p.spotify);
  if (idx<0) idx = 0;
  for (const file of files){
    const id = uuid();
    await saveSound({ id, name:file.name, type:file.type||'audio/*', blob: file, createdAt: Date.now() });
    const pad = pads[idx] || pads[pads.length-1];
    pad.name = pad.name || file.name.replace(/\.[^/.]+$/, '');
    pad.soundId = id; pad.spotify = null;
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
btnStopAll.addEventListener('click', ()=> { audio.stopAll(); if (spotify && spotify.accessToken) spotify.pause(); });

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
settingsDialog.addEventListener('close', ()=>{ keyPreview = settingKeyPreview.checked; if (settingMidi.checked) initMIDI(); });

// --- Master volume ---
masterVol.addEventListener('input', ()=> { const v = parseFloat(masterVol.value); audio.setMasterVolume(v); try{ spotify.setVolume(v); }catch{} });

// --- PWA install button ---
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); installEvt = e; btnInstall.hidden = false; });
btnInstall.addEventListener('click', async ()=>{ if (!installEvt) return; installEvt.prompt(); const choice = await installEvt.userChoice; if (choice.outcome === 'accepted'){ btnInstall.hidden = true; } });

// --- Arm audio ---
btnArmAudio.addEventListener('click', ()=> audio.arm());

// --- Status helper ---
let statusTimer = null;
function status(msg, ms=0){
  statusEl.textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  if (ms>0){ statusTimer = setTimeout(()=>{ statusEl.textContent = 'Ready'; }, ms); }
}

// --- MIDI (optional) ---
let midiAccess = null;
async function initMIDI(){
  if (!('requestMIDIAccess' in navigator)) return;
  try{
    midiAccess = await navigator.requestMIDIAccess({ sysex:false });
    midiAccess.inputs.forEach(input => { input.onmidimessage = onMIDIMessage; });
    status('MIDI ready ✓', 1500);
  }catch(err){ console.warn('MIDI init failed', err); }
}
function onMIDIMessage(e){
  const [statusByte, note, vel] = e.data;
  const cmd = statusByte & 0xf0;
  if (cmd === 0x90 && vel>0){
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
    if (pad.spotify){ spotify.playUri(pad.spotify.uri, Math.floor((pad.start||0)*1000), true); }
    else { if (playing) audio.stopPad(pad.id); else triggerPad(pad); }
  } else if (pad.mode === 'gate'){
    triggerPad(pad);
    setTimeout(()=> { if (pad.spotify) spotify.pause(); else audio.stopPad(pad.id); }, 300);
  } else {
    triggerPad(pad);
  }
}

// ---- Spotify UI ----
btnSpotify.addEventListener('click', async ()=>{
  if (spotify.accessToken || spotify.restoreTokens()){
    await spotify.bootstrap();
    alert(spotify.user ? `Connected as ${spotify.user.display_name||spotify.user.id}` : 'Connected to Spotify.');
    btnSpotifyAdd.disabled = false;
    btnSpotify.textContent = spotify.user ? `Spotify: ${spotify.user.display_name||spotify.user.id}` : 'Spotify Connected';
  }else{
    await spotify.login();
  }
});
spLogout.addEventListener('click', ()=>{
  spotify.logout();
  btnSpotifyAdd.disabled = true;
  spWho.textContent = '';
  btnSpotify.textContent = 'Connect Spotify';
  alert('Disconnected from Spotify.');
});
btnSpotifyAdd.addEventListener('click', async ()=>{
  if (!spotify.accessToken && !spotify.restoreTokens()){ await spotify.login(); return; }
  await spotify.bootstrap();
  spWho.textContent = spotify.user ? `Signed in: ${spotify.user.display_name||spotify.user.id}` : '';
  spResults.innerHTML = '';
  spPlaylists.innerHTML = '';
  spPlaylists.hidden = true;
  spotifyDialog.showModal();
});
spDoSearch.addEventListener('click', async ()=>{
  const q = spSearch.value.trim();
  if (!q) return;
  const items = await spotify.searchTracks(q, 40);
  renderSpotifyResults(items);
});
spFetchPlaylists.addEventListener('click', async ()=>{
  const pls = await spotify.getMyPlaylists(30);
  spPlaylists.hidden = false;
  spPlaylists.innerHTML = '';
  for (const p of pls){
    const div = document.createElement('div');
    div.className = 'sp-card';
    const img = (p.images&&p.images[0]?.url)||'';
    div.innerHTML = `<img src="${img}" alt=""> <div class="meta"><strong>${escapeHtml(p.name)}</strong><span>${p.tracks.total} tracks</span></div>`;
    const actions = document.createElement('div'); actions.className='actions';
    const btn = document.createElement('button'); btn.textContent = 'Open'; btn.addEventListener('click', async ()=>{
      const tracks = await spotify.getPlaylistTracks(p.id, 100);
      renderSpotifyResults(tracks);
    });
    actions.appendChild(btn);
    div.appendChild(actions);
    spPlaylists.appendChild(div);
  }
});
function renderSpotifyResults(items){
  spResults.innerHTML = '';
  for (const t of items){
    if (!t || !t.uri) continue;
    const art = t.album?.images?.[2]?.url || t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
    const div = document.createElement('div');
    div.className = 'sp-card';
    div.innerHTML = `<img src="${art}" alt=""><div class="meta"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml((t.artists||[]).map(a=>a.name).join(', '))}</span><span class="sp-pill">${Math.floor(t.duration_ms/60000)}:${String(Math.floor(t.duration_ms/1000)%60).padStart(2,'0')}</span></div>`;
    const actions = document.createElement('div'); actions.className='actions';
    const b1 = document.createElement('button'); b1.textContent = 'Assign to Pad';
    b1.addEventListener('click', async ()=>{
      if (!selectedPadId){ alert('Open a pad editor (right-click a pad) to assign, or use Fill Empty Pads.'); return; }
      const pad = await getPad(selectedPadId);
      pad.spotify = { uri:t.uri, title:t.name, artist:(t.artists||[]).map(a=>a.name).join(', '), image:(t.album?.images?.[0]?.url||''), duration_ms:t.duration_ms };
      pad.soundId = ''; pad.name = pad.name || t.name;
      await savePad(pad);
      status('Assigned Spotify track ✓', 1500);
      renderPage(currentPage);
    });
    const b2 = document.createElement('button'); b2.textContent = 'Fill Empty Pads';
    b2.addEventListener('click', async ()=>{
      const pads = await ensurePagePads(currentPage);
      let idx = pads.findIndex(p=>!p.soundId && !p.spotify);
      if (idx<0) idx = 0;
      let added = 0;
      for (const track of items){
        const p = pads[idx];
        if (!p) break;
        if (p.soundId || p.spotify){ idx++; continue; }
        p.spotify = { uri:track.uri, title:track.name, artist:(track.artists||[]).map(a=>a.name).join(', '), image:(track.album?.images?.[0]?.url||''), duration_ms:track.duration_ms };
        p.name = p.name || track.name;
        await savePad(p);
        idx++; added++;
      }
      status(`Added ${added} Spotify track(s) ✓`, 1600);
      renderPage(currentPage);
    });
    actions.appendChild(b1); actions.appendChild(b2);
    div.appendChild(actions);
    spResults.appendChild(div);
  }
}


// --- Spotify UI ---
btnSpotifyConnect?.addEventListener('click', async ()=>{
  spotify.setClientId(spotifyClientIdInput.value || '');
  try{
    await spotify.connect();
  }catch(err){
    alert('Spotify connect error: ' + err.message);
  }
});
btnAddSpotify?.addEventListener('click', async ()=>{
  const ok = await spotify.ensureReady();
  if (!ok){
    settingsDialog.showModal();
    status('Enter your Spotify Client ID and click Connect to Spotify.', 3000);
    return;
  }
  spotifyDialog.showModal();
  spotifyResults.innerHTML = '<div class="muted" style="padding:1rem">Type in the search box…</div>';
});
spotifyQuery?.addEventListener('input', async ()=>{
  const q = spotifyQuery.value.trim();
  if (!q){ spotifyResults.innerHTML = '<div class="muted" style="padding:1rem">Type in the search box…</div>'; return; }
  try{
    const res = await spotify.searchTracks(q, 24);
    const tracks = res.tracks?.items || [];
    if (!tracks.length){ spotifyResults.innerHTML = '<div class="muted" style="padding:1rem">No results.</div>'; return; }
    spotifyResults.innerHTML = '';
    for (const t of tracks){
      const img = t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
      const card = document.createElement('div');
      card.style.background = '#0b1220';
      card.style.border = '1px solid var(--border)';
      card.style.borderRadius = '.5rem';
      card.style.padding = '.5rem';
      card.innerHTML = \`
        <div style="display:flex; gap:.5rem; align-items:center">
          <img src="\${img}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:.35rem" />
          <div style="line-height:1.2">
            <div style="font-weight:600">\${escapeHtml(t.name)}</div>
            <div class="muted" style="font-size:.85rem">\${escapeHtml(t.artists.map(a=>a.name).join(', '))}</div>
          </div>
        </div>
        <div style="display:flex; gap:.5rem; margin-top:.5rem; justify-content:flex-end">
          <button data-uri="\${t.uri}" data-id="\${t.id}" data-name="\${escapeHtml(t.name)}" data-artist="\${escapeHtml(t.artists.map(a=>a.name).join(', '))}" data-img="\${img}" data-dur="\${t.duration_ms}">Assign to Pad</button>
        </div>
      \`;
      card.querySelector('button').addEventListener('click', async (e)=>{
        const btn = e.currentTarget;
        const track = {
          uri: btn.dataset.uri,
          id: btn.dataset.id,
          name: btn.dataset.name,
          artist: btn.dataset.artist,
          image: btn.dataset.img,
          duration_ms: parseInt(btn.dataset.dur,10)||0
        };
        await assignSpotifyTrackToPad(track);
        spotifyDialog.close();
      });
      spotifyResults.appendChild(card);
    }
  }catch(err){
    spotifyResults.innerHTML = '<div class="muted" style="padding:1rem">Auth expired. Open Settings → Connect to Spotify again.</div>';
  }
});

async function assignSpotifyTrackToPad(track){
  // Prefer selected pad in editor; otherwise next empty in current bank.
  let target = null;
  if (selectedPadId){
    target = await getPad(selectedPadId);
  }else{
    const pads = await ensurePagePads(currentPage);
    target = pads.find(p=>!p.soundId && p.srcType!=='spotify') || pads[0];
  }
  Object.assign(target, {
    srcType: 'spotify',
    spotify: track,
    name: target.name || \`\${track.name} — \${track.artist}\`,
    soundId: '' // clear any local audio
  });
  await savePad(target);
  renderPage(currentPage);
  status('Assigned Spotify track ✓', 1500);
}

// --- Boot ---
(async function boot(){
  try{ await spotify.handleRedirectCallback(); }catch{}
  if ('serviceWorker' in navigator){ try{ navigator.serviceWorker.register('./service-worker.js'); }catch{} }
  db = await openDB();
  buildPageSelect();
  await renderPage(currentPage);
  settingKeyPreview.checked = true;
  if (spotify.restoreTokens()){ await spotify.bootstrap(); btnSpotifyAdd.disabled = false; btnSpotify.textContent = spotify.user ? `Spotify: ${spotify.user.display_name||spotify.user.id}` : 'Spotify Connected'; }
  status('Ready');
})();
