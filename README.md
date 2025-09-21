# Open Sports Soundboard Pro (Web)

A fast, offline-capable web app you can host for free (GitHub Pages, Netlify, Vercel, etc.) that gives you **8,640 customizable sound buttons** (72 banks × 120 pads), a **simplistic interface designed for speed**, **custom cue control**, **instant play** via the Web Audio API, **color‑coded backgrounds**, import/export, and more.

> **How this maps to your requested features**
>
> - **8,640 Customizable sound buttons** → 72 banks × 120 pads per bank (shown at the bottom and in the UI).
> - **Simplistic interface designed for speed** → Minimal, single‑screen grid with keyboard shortcuts (PgUp/PgDn for bank nav), quick search, and right‑click to edit.
> - **Custom Cue Control** → Each pad supports multiple cue points and start/end/loop controls; cues are clickable inside the editor and trigger instantly.
> - **Instant Play Feature** → Uses `AudioContext` with pre‑decode caching; press **Arm Audio** once and everything launches with minimal latency.
> - **Color‑coded backgrounds** → Each pad has a color swatch; categories/tags support quick organization and filtering.
> - **Add songs easily** → Click **Add Sounds** or drag & drop files anywhere. Files are stored locally (IndexedDB) and auto‑assigned to empty pads in the current bank.
>
> **Bonus features**
> - Offline PWA (installable).
> - Import/Export board to JSON (optionally embed audio).
> - Per‑pad volume, detune, playback rate, fades, start/end.
> - Exclusive groups (duck/stop others in group when a pad triggers).
> - Keyboard binding per pad; optional WebMIDI (if the browser/OS supports it).
> - Waveform preview for pad editing.

## Host for Free

1. **GitHub Pages**
   - Create a new repo and upload the contents of this folder.
   - In Settings → Pages, set the branch to `main` (root), save.
   - Your site will be live at `https://<yourname>.github.io/<repo>/`.
2. **Netlify**
   - Drag the folder onto https://app.netlify.com/drop
3. **Vercel**
   - Create a project from this folder; no build step required.

No server is required. Everything runs client‑side in the browser.

## Use It

- Click **Arm Audio** once to ensure the browser unlocks sound output. You only need to do this after a fresh load.
- **Add Sounds** (or drag & drop). Files are stored locally in your browser (IndexedDB).
- Right‑click any pad to **Edit**: assign audio, change color, set start/end, add cues, choose playback mode (one‑shot, gate, toggle loop), set exclusive group, etc.
- Use **Export** to save your setup; use **Import** to restore it (optionally embedding audio for easy sharing/migration).

> **Tip:** For very large boards, decoding audio the first time you use it will take a moment (this is normal). After decoding, playback is instant thanks to in‑memory caching.

## Browser Support

- Best in Chromium‑based browsers (Chrome, Edge). Safari and Firefox work for the basics; WebMIDI may not be available everywhere.
- Local storage lives in your browser profile. Export regularly for backups or to move machines.

## Dev Notes

- Static only. No frameworks, no build steps.
- Web Audio API for playback and cueing.
- IndexedDB for audio blobs + pad metadata.
- Simple service worker for offline caching.
- CSS Grid for the pads layout (responsive).

---

**License:** MIT
