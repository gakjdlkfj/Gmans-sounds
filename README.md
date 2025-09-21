# Open Sports Soundboard Pro (Web) — with Spotify

A fast, offline-capable web app you can host for free (GitHub Pages, Netlify, Vercel, etc.) that gives you **8,640 customizable sound buttons** (72 banks × 120 pads), a **simplistic interface designed for speed**, **custom cue control**, **instant play** via the Web Audio API, **color‑coded backgrounds**, import/export, and more. Now with **optional Spotify connect** to search and assign Spotify tracks to pads.

> **Requested features matched**
>
> - **8,640 Customizable sound buttons** → 72 banks × 120 pads per bank.
> - **Simplistic interface designed for speed** → Minimal, single‑screen grid, PgUp/PgDn nav, search, right‑click to edit.
> - **Custom Cue Control** → Start/End, multiple cues, clickable waveform.
> - **Instant Play** → Web Audio API with memory caching after first decode.
> - **Color‑coded backgrounds** → Per‑pad color swatches.
> - **Add songs easily** → **Add Sounds** (or drag & drop) and **Add from Spotify** (see below).
> - **Bonus** → PWA offline/installable, import/export (optionally with audio), keyboard + MIDI learn, exclusive groups, per‑pad fades/rate/detune.

## Host for Free

1. **GitHub Pages** — upload the folder; enable Pages in repo settings.
2. **Netlify** — drag-and-drop the folder.
3. **Vercel** — create a project from the folder.

Everything is static and client‑side. No server required.

## Using Spotify (Optional)

You can connect Spotify to **assign tracks directly to pads**. Pads with Spotify stream via the Spotify Web Playback SDK.

> **Requirements & limitations (Spotify rules):**
> - **Spotify Premium** is required for in‑browser playback.
> - Spotify audio **cannot be downloaded or embedded**; Spotify pads only stream while authorized.
> - Per‑pad rate/detune/fades don’t apply to Spotify due to API limits. Start/cue seeking works; toggle loop uses Spotify **repeat track**.
> - Mixing local audio and Spotify on the same pad is not supported at the same time (choose one).

### Setup
1. Go to the **Spotify Developer Dashboard** and create an app.
2. In your app settings, add your site URL as a **Redirect URI** (e.g., `https://<yourname>.github.io/<repo>/`).
3. Open `app.js` and set:
   ```js
   const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
   const SPOTIFY_REDIRECT_URI = 'https://<yourname>.github.io/<repo>/'; // Must match dashboard
   ```
4. Deploy and open your site. Click **Connect Spotify** and authorize.

### Add tracks from Spotify
- Click **Add from Spotify** → search or open **My Playlists** → click **Assign to Pad** or **Fill Empty Pads**.
- In a pad editor, you can also **Assign to Pad** (it will replace any local audio for that pad).

### Export/Import with Spotify
- Exports include the **Spotify URIs/metadata** for Spotify‑backed pads (not audio). On import, the user must connect Spotify to play those pads.

## How to Use (non‑Spotify)
- Click **Arm Audio** once after loading for low‑latency local playback.
- **Add Sounds** or drag & drop files; they’re stored locally (IndexedDB).
- Right‑click a pad to edit: assign audio, color, start/end, cues, mode (one‑shot/gate/loop), exclusive group, fades/rate/detune, key/MIDI learn.
- **Stop All** halts everything (also pauses Spotify if connected).

## Browser Support
- Best in Chrome/Edge. Safari/Firefox work for core features; MIDI support varies. Spotify Web Playback SDK requires modern Chromium and Premium account.

## Dev Notes
- No frameworks/build steps.
- Web Audio API for local files; Spotify Web Playback SDK for Spotify.
- IndexedDB for local audio and pad metadata.
- Service worker for offline caching.

**License:** MIT


## Spotify integration (optional)

> **What it is:** Add tracks as pads directly from Spotify. Playback streams via the official **Spotify Web Playback SDK** (no audio is downloaded).  
> **Requirements:** Spotify Premium account; a Spotify **Client ID**; your hosted site URL registered as a **Redirect URI** in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

**Set up**  
1. Deploy the site (GitHub Pages/Netlify/Vercel).  
2. In the Spotify Developer Dashboard → create an app → copy the **Client ID**.  
3. In that app → **Add Redirect URI** → use your deployed site URL (e.g., `https://<you>.github.io/soundboard/index.html`).  
4. In the app’s **Settings** dialog: paste your **Client ID** → **Connect to Spotify**.  
5. Use **Add from Spotify** to search and assign tracks to pads.

**Limitations (by Spotify policies & SDK):**
- Audio **cannot** be exported or decoded into the board—streaming only.  
- Per‑pad **rate/detune/fades** do not apply to Spotify tracks. Start/end trim, cue jumps, gate/toggle loop are emulated via SDK `seek()`/`pause()`.  
- Requires internet and HTTPS; offline/PWA applies only to local files.

