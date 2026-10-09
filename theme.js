// Mobius Town stylesheet. The game is full-bleed and keeps its own night-time
// HUD palette regardless of the shell theme; text sizes and focus rings follow
// the platform's accessibility conventions.
export const CSS = `
.mt-root {
  --mt-bg: #120f1a;
  --mt-panel: rgba(26, 20, 40, 0.88);
  --mt-panel-solid: #1d1730;
  --mt-raise: rgba(255, 255, 255, 0.07);
  --mt-line: rgba(255, 255, 255, 0.13);
  --mt-text: #fbf6ea;
  --mt-muted: #b8aecb;
  --mt-gold: #ffd36a;
  --mt-teal: #5ee0c1;
  --mt-blue: #4d8dff;
  --mt-red: #ff6b74;
  --mt-green: #5cf08c;
  --mt-pixel: 'KenneyMini', ui-monospace, monospace;
  --mt-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--mt-bg);
  color: var(--mt-text);
  font-family: var(--mt-font);
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.mt-root * { box-sizing: border-box; }
:where(.mt-root) button { font: inherit; color: inherit; }
.mt-root :focus-visible { outline: 3px solid var(--mt-gold); outline-offset: 2px; }
.mt-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  image-rendering: pixelated;
  outline: none;
}
.mt-pixel { font-family: var(--mt-pixel); letter-spacing: 0.02em; }

/* ---- Top bar ---------------------------------------------------------------- */
.mt-top {
  position: absolute;
  top: max(10px, var(--mobius-safe-top, 0px));
  /* The shell's immersive exit button owns the top-left corner. */
  left: calc(max(12px, var(--mobius-safe-left, 0px)) + 52px);
  right: max(12px, var(--mobius-safe-right, 0px));
  display: flex;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
  /* Above side panels (5) so the Places and Sound menus open over them; below modal covers (8). */
  z-index: 6;
}
.mt-top > * { pointer-events: auto; }
.mt-top-actions { display: flex; gap: 8px; align-items: flex-start; }
/* Phones: the buttons take the first row (beside the shell's exit button), the place chip the second. */
@media (max-width: 640px) {
  .mt-top { flex-wrap: wrap; row-gap: 6px; left: calc(max(10px, var(--mobius-safe-left, 0px)) + 50px); right: max(8px, var(--mobius-safe-right, 0px)); }
  .mt-top-actions { order: 0; margin-left: auto; gap: 5px; }
  .mt-top .mt-spacer { order: 1; flex-basis: 100%; height: 0; }
  .mt-top > .mt-chip, .mt-top > .mt-btn { order: 2; }
  .mt-top-actions .mt-iconbtn { width: 40px; height: 40px; }
  /* Below both rows of the top bar. */
  .mt-game-view .mt-strip { top: calc(max(10px, var(--mobius-safe-top, 0px)) + 98px); }
}
@media (hover: none) and (pointer: coarse) {
  .mt-kbd-btn { display: none; }
}
.mt-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--mt-panel);
  border: 1px solid var(--mt-line);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
  white-space: nowrap;
}
.mt-chip .mt-place { font-family: var(--mt-pixel); font-size: 15px; color: var(--mt-gold); }
.mt-chip .mt-sub { color: var(--mt-muted); font-size: 12.5px; }
.mt-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mt-green); box-shadow: 0 0 8px var(--mt-green); }
.mt-dot.is-off { background: #8b8398; box-shadow: none; }
.mt-dot.is-warn { background: var(--mt-gold); box-shadow: 0 0 8px var(--mt-gold); }
.mt-spacer { flex: 1; }
.mt-iconbtn {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid var(--mt-line);
  background: var(--mt-panel);
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
  position: relative;
}
.mt-iconbtn:hover { background: rgba(60, 48, 88, 0.95); }
.mt-iconbtn.is-on { background: #2b6b58; border-color: #5ee0c1aa; }
.mt-iconbtn.is-alert { background: #6b2b36; border-color: #ff6b74aa; }
.mt-iconbtn.is-gold { background: #5a4a1c; border-color: #ffd36aaa; }
.mt-iconbtn svg { width: 22px; height: 22px; }
.mt-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--mt-red);
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.mt-places {
  position: absolute;
  top: 52px;
  right: 0;
  display: grid;
  gap: 4px;
  padding: 8px;
  min-width: 210px;
  border-radius: 14px;
  background: var(--mt-panel-solid);
  border: 1px solid var(--mt-line);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  z-index: 7;
}
.mt-places .mt-btn { justify-content: flex-start; min-height: 40px; font-weight: 600; }

/* ---- Dock ---------------------------------------------------------------- */
.mt-dock {
  position: absolute;
  left: 50%;
  bottom: max(14px, var(--mobius-safe-bottom, 0px));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px;
  border-radius: 20px;
  background: var(--mt-panel);
  border: 1px solid var(--mt-line);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
  z-index: 4;
  max-width: calc(100vw - 16px);
}
.mt-emotes {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  gap: 6px;
  padding: 8px;
  min-width: 160px;
  border-radius: 14px;
  background: var(--mt-panel-solid);
  border: 1px solid var(--mt-line);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.mt-emotes .mt-btn { justify-content: flex-start; min-height: 40px; }
.mt-help { display: grid; gap: 9px; margin: 16px 0 0; }
.mt-help div { display: grid; grid-template-columns: 136px 1fr; gap: 10px; align-items: baseline; }
.mt-help dt { color: var(--mt-gold); font-size: 15px; }
.mt-help dd { margin: 0; line-height: 1.4; }
.mt-dock-sep { width: 1px; align-self: stretch; margin: 6px 3px; background: var(--mt-line); }
.mt-me {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px 0 4px;
  border-radius: 14px;
  border: 1px solid var(--mt-line);
  background: var(--mt-raise);
  cursor: pointer;
  max-width: 180px;
}
.mt-me canvas { width: 32px; height: 36px; image-rendering: pixelated; }
.mt-me span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }

/* ---- Prompt ---------------------------------------------------------------- */
.mt-prompt {
  position: absolute;
  left: 50%;
  bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 74px);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  border-radius: 14px;
  background: rgba(255, 246, 222, 0.96);
  color: #241b33;
  font-weight: 650;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  z-index: 4;
  border: 0;
  cursor: pointer;
  animation: mt-pop 160ms ease-out;
}
.mt-key {
  display: inline-grid;
  place-items: center;
  min-width: 32px;
  height: 32px;
  padding: 0 7px;
  border-radius: 9px;
  background: #241b33;
  color: var(--mt-gold);
  font-family: var(--mt-pixel);
  font-size: 16px;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.45);
}
@keyframes mt-pop { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* ---- Toasts ---------------------------------------------------------------- */
.mt-toasts {
  position: absolute;
  bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 132px);
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  gap: 8px;
  z-index: 9; /* above modal covers (a party, a board): a challenge or a warning must stay visible */
  width: min(420px, calc(100vw - 24px));
  pointer-events: none;
}
.mt-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--mt-panel-solid);
  border: 1px solid var(--mt-line);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  animation: mt-drop 200ms ease-out;
}
.mt-toast p { margin: 0; flex: 1; line-height: 1.35; }
.mt-toast .mt-btn { min-height: 34px; padding: 0 12px; }
@keyframes mt-drop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }

/* ---- Buttons ---------------------------------------------------------------- */
.mt-btn {
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid var(--mt-line);
  background: var(--mt-raise);
  cursor: pointer;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.mt-btn:hover { background: rgba(255, 255, 255, 0.12); }
.mt-btn.is-primary {
  background: linear-gradient(180deg, #ffde84, #f2b84a);
  border-color: #c98c22;
  color: #2a1d0b;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.18), 0 6px 18px rgba(242, 184, 74, 0.25);
}
.mt-btn.is-primary:hover { filter: brightness(1.05); }
.mt-btn.is-danger { background: #5b2430; border-color: #ff6b7488; }
.mt-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---- Side panel (chat, people) ---------------------------------------------- */
.mt-panel {
  position: absolute;
  top: calc(max(10px, var(--mobius-safe-top, 0px)) + 54px);
  right: max(12px, var(--mobius-safe-right, 0px));
  bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 74px);
  width: min(340px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: var(--mt-panel);
  border: 1px solid var(--mt-line);
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  z-index: 5;
  overflow: hidden;
  user-select: text;
}
.mt-panel > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 16px;
  border-bottom: 1px solid var(--mt-line);
}
.mt-panel > header h2 { margin: 0; flex: 1; font-family: var(--mt-pixel); font-weight: 400; font-size: 18px; color: var(--mt-gold); }
.mt-tabs { display: flex; gap: 4px; padding: 8px 10px 0; }
.mt-tab {
  flex: 1;
  min-height: 36px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
  font-weight: 650;
}
.mt-tab.is-on { background: var(--mt-raise); color: var(--mt-text); border-color: var(--mt-line); }
.mt-scroll { flex: 1; overflow-y: auto; padding: 10px 12px; }
.mt-msg { margin: 0 0 10px; line-height: 1.4; }
.mt-msg b { color: var(--mt-gold); font-weight: 650; margin-right: 6px; }
.mt-msg .mt-time { color: var(--mt-muted); font-size: 11px; margin-left: 6px; }
.mt-msg.is-me b { color: #8cc4ff; }
.mt-msg.is-system { color: var(--mt-muted); font-style: italic; }
.mt-empty { color: var(--mt-muted); text-align: center; margin-top: 30px; line-height: 1.5; padding: 0 10px; }
.mt-compose { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--mt-line); }
.mt-input {
  flex: 1;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--mt-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--mt-text);
  font: inherit;
  user-select: text;
}
.mt-input::placeholder { color: #8f86a3; }
.mt-person {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto auto;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  padding: 8px;
  border-radius: 12px;
}
.mt-person > canvas { grid-row: 1 / span 2; align-self: start; }
.mt-person-hearing { grid-column: 2 / -1; margin-top: 0; }
.mt-person-hearing .mt-hearing-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mt-person:hover { background: var(--mt-raise); }
.mt-person canvas { width: 32px; height: 36px; image-rendering: pixelated; flex: none; }
.mt-person-main { flex: 1; min-width: 0; }
.mt-person-name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-person-where { color: var(--mt-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-challenge { flex: none; min-height: 36px; padding: 0 12px; gap: 6px; font-size: 13px; }
.mt-challenge svg { width: 16px; height: 16px; color: var(--mt-gold); }
.mt-person-tag { flex: none; font-size: 11.5px; color: var(--mt-gold); border: 1px solid rgba(255, 211, 106, 0.35); border-radius: 999px; padding: 3px 9px; }
.mt-hearing { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.mt-hearing-bar { width: 64px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; flex: none; }
.mt-hearing-bar span { display: block; height: 100%; background: var(--mt-green); border-radius: 3px; }
.mt-hearing-text { font-size: 11.5px; color: var(--mt-muted); }
.mt-section { margin: 12px 4px 6px; color: var(--mt-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }

/* ---- Join screen and avatar editor --------------------------------------------- */
.mt-cover {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(20px, var(--mobius-safe-top, 0px)) 16px max(20px, var(--mobius-safe-bottom, 0px));
  background: radial-gradient(1200px 600px at 50% 0%, rgba(77, 141, 255, 0.18), transparent 60%), rgba(12, 9, 20, 0.72);
  z-index: 8;
  overflow-y: auto;
}
.mt-card {
  width: min(560px, 100%);
  border-radius: 22px;
  background: var(--mt-panel-solid);
  border: 1px solid var(--mt-line);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  padding: 22px;
  user-select: text;
}
.mt-title { margin: 0; font-family: 'KenneyBlocks', var(--mt-pixel); font-weight: 400; font-size: clamp(28px, 6vw, 40px); color: var(--mt-gold); letter-spacing: 0.04em; text-shadow: 0 3px 0 #7a4a12; }
.mt-lede { margin: 8px 0 18px; color: var(--mt-muted); line-height: 1.5; }
.mt-editor { display: grid; grid-template-columns: 212px 1fr; gap: 18px; align-items: start; }
.mt-stage {
  padding: 8px;
  border-radius: 16px;
  background: linear-gradient(180deg, #2c5a3a, #1f4a2c);
  border: 1px solid var(--mt-line);
  position: relative;
  overflow: hidden;
}
/* The two characters, side by side: the chosen one walks in a gold frame. */
.mt-picks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.mt-pick {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 6px 0 8px;
  border-radius: 12px;
  border: 2px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
/* object-fit (set on the canvas) trims the empty rows above the head. */
.mt-pick canvas { width: 80px; height: 136px; image-rendering: pixelated; opacity: 0.5; transition: opacity 0.15s; }
.mt-pick:hover canvas { opacity: 0.8; }
.mt-pick.is-on { border-color: var(--mt-gold); background: rgba(0, 0, 0, 0.2); color: var(--mt-gold); }
.mt-pick.is-on canvas { opacity: 1; }
.mt-pick:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.mt-stage-turn { display: grid; margin: 6px auto 0; }
.mt-swatches { display: grid; gap: 12px; }
.mt-swatch-row h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mt-muted); font-weight: 650; }
.mt-swatch-list { display: flex; flex-wrap: wrap; gap: 6px; }
.mt-swatch {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.16);
  cursor: pointer;
  padding: 0;
  position: relative;
}
.mt-swatch.is-on { border-color: var(--mt-gold); box-shadow: 0 0 0 2px #00000066 inset; }
.mt-field { display: grid; gap: 6px; margin-top: 16px; }
.mt-field label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mt-muted); font-weight: 650; }
.mt-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; justify-content: flex-end; align-items: center; }
.mt-note { color: var(--mt-muted); font-size: 12.5px; line-height: 1.45; margin: 14px 0 0; }
.mt-toggle-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.mt-toggle {
  display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px;
  border-radius: 12px; border: 1px solid var(--mt-line); background: var(--mt-raise); cursor: pointer;
}
.mt-toggle.is-on { background: #2b6b58; border-color: #5ee0c1aa; }
.mt-toggle:disabled { background: var(--mt-raise); border-color: var(--mt-line); color: var(--mt-muted); cursor: not-allowed; }
.mt-toggle svg { width: 18px; height: 18px; }

/* ---- Loading ---------------------------------------------------------------- */
.mt-loading { position: absolute; inset: 0; display: grid; place-items: center; z-index: 9; background: var(--mt-bg); }
.mt-loading p { font-family: var(--mt-pixel); color: var(--mt-gold); font-size: 18px; animation: mt-blink 1s steps(2) infinite; }
@keyframes mt-blink { 50% { opacity: 0.35; } }


/* ---- Video strip ---------------------------------------------------------------- */
.mt-strip {
  position: absolute;
  top: calc(max(10px, var(--mobius-safe-top, 0px)) + 52px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 2;
  max-width: calc(100vw - 24px);
  pointer-events: none;
}
.mt-tile {
  margin: 0;
  width: 168px;
  border-radius: 14px;
  background: var(--mt-panel-solid);
  border: 2px solid var(--mt-line);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  transition: opacity 300ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.mt-tile.is-speaking { border-color: var(--mt-green); box-shadow: 0 0 0 2px #5cf08c55, 0 8px 28px rgba(0, 0, 0, 0.35); }
.mt-tile.is-stage { width: 220px; border-color: var(--mt-gold); }
.mt-tile-video {
  position: relative;
  height: 112px;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 35%, #3a2f58, #1a1428);
}
.mt-tile.is-stage .mt-tile-video { height: 146px; }
.mt-tile-avatar { width: 48px; height: 96px; image-rendering: pixelated; margin-top: -18px; }
.mt-tile-state { position: absolute; bottom: 6px; left: 8px; font-size: 11px; color: var(--mt-muted); }
.mt-tile figcaption { display: flex; align-items: center; gap: 6px; padding: 5px 9px; font-size: 12.5px; font-weight: 650; min-height: 28px; }
.mt-tile-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-tile-mute { width: 15px; height: 15px; color: var(--mt-red); flex: none; }
.mt-stage-badge { font-family: var(--mt-pixel); color: var(--mt-gold); font-size: 12px; }

/* ---- Sheets and games ---------------------------------------------------------- */
.mt-sheet { width: min(480px, 100%); }
.mt-sheet.is-wide { width: min(860px, 100%); }
.mt-sheet-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.mt-sheet-head h2 { flex: 1; margin: 0; font-weight: 400; font-size: 22px; color: var(--mt-gold); }
.mt-sign-text { margin: 0; line-height: 1.6; font-size: 15px; }
.mt-game { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 18px; align-items: start; }
.mt-board {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  grid-template-rows: repeat(8, minmax(0, 1fr));
  aspect-ratio: 1;
  width: 100%;
  max-width: 520px;
  border-radius: 10px;
  overflow: hidden;
  border: 4px solid #5b3a26;
  box-shadow: 0 0 0 2px #2a1d14, 0 14px 40px rgba(0, 0, 0, 0.45);
}
.mt-sq { position: relative; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center; min-width: 0; min-height: 0; overflow: hidden; }
.mt-sq.is-light { background: #eedcb0; }
.mt-sq.is-dark { background: #a8714e; }
.mt-sq.is-last::after { content: ''; position: absolute; inset: 0; background: rgba(255, 214, 92, 0.38); }
.mt-sq.is-sel { box-shadow: inset 0 0 0 4px #4d8dff; }
.mt-sq.is-check { background: radial-gradient(circle, #ff5f5f 0%, #c43c3c 55%, transparent 80%), #a8714e; }
.mt-sq img { width: 84%; height: 84%; object-fit: contain; image-rendering: auto; position: relative; z-index: 1; pointer-events: none; filter: drop-shadow(0 2px 1px rgba(0, 0, 0, 0.35)); }
.mt-dotmove { position: absolute; width: 26%; height: 26%; border-radius: 50%; background: rgba(36, 27, 51, 0.45); z-index: 2; }
.mt-cap { position: absolute; inset: 6%; border-radius: 50%; border: 4px solid rgba(36, 27, 51, 0.45); z-index: 2; }
.mt-coord { position: absolute; font-size: 10px; font-weight: 700; color: rgba(36, 27, 51, 0.6); z-index: 2; }
.mt-coord-r { top: 2px; left: 3px; }
.mt-coord-f { bottom: 1px; right: 3px; }
.mt-game-side { display: grid; gap: 12px; }
.mt-players { display: grid; gap: 6px; }
.mt-player { display: grid; grid-template-columns: 44px 1fr; gap: 2px 10px; align-items: center; padding: 8px 10px; border-radius: 12px; background: var(--mt-raise); border: 1px solid transparent; }
.mt-player.is-turn { border-color: var(--mt-gold); }
.mt-player-name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.mt-player-note { grid-column: 2; color: var(--mt-muted); font-size: 12px; }
.mt-portrait { grid-row: span 2; width: 44px; height: 48px; image-rendering: pixelated; background: rgba(0, 0, 0, 0.22); border-radius: 10px; object-fit: cover; object-position: 50% 30%; }
.mt-portrait.is-cpu { object-fit: contain; object-position: 50% 50%; padding: 4px; box-sizing: border-box; }
.mt-player.is-turn .mt-portrait { box-shadow: 0 0 0 2px var(--mt-gold); }
.mt-side { flex: none; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #00000055; }
.mt-side-w { background: #fff4dc; }
.mt-side-b { background: #3b2a4a; border-color: #f0d9b5; }
.mt-side-r { background: #e23e3e; }
.mt-side-y { background: #fad23c; }
.mt-game-status { margin: 0; font-family: var(--mt-pixel); font-size: 17px; color: var(--mt-teal); }
.mt-game-status.is-over { color: var(--mt-gold); }
.mt-moves { margin: 0; padding: 0; list-style: none; max-height: 180px; overflow-y: auto; columns: 2; font-size: 13px; color: var(--mt-muted); }
.mt-moves li span { color: #8f86a3; }
.mt-promo { display: flex; gap: 8px; justify-content: center; margin-top: 14px; }
.mt-promo img { image-rendering: auto; }
.mt-c4 {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  padding: 10px;
  border-radius: 16px;
  background: linear-gradient(180deg, #3d76e0, #2c5ab8);
  border: 3px solid #1e3e82;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  max-width: 520px;
}
.mt-c4-col { display: grid; gap: 6px; padding: 4px; border: 0; border-radius: 12px; background: transparent; cursor: pointer; }
.mt-c4-col:not(:disabled):hover { background: rgba(255, 255, 255, 0.14); }
.mt-c4-col:disabled { cursor: default; }
.mt-disc { aspect-ratio: 1; border-radius: 50%; background: #14224a; box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.4); }
.mt-disc.is-r { background: radial-gradient(circle at 40% 35%, #ff8080, #e23e3e 60%, #a52626); }
.mt-disc.is-y { background: radial-gradient(circle at 40% 35%, #fff1a0, #fad23c 60%, #c99a12); }
.mt-disc.is-win { box-shadow: 0 0 0 4px #ffffff, 0 0 18px #ffffff; }
.mt-tv-now { display: flex; gap: 14px; align-items: center; }
.mt-tv-thumb { width: 160px; border-radius: 10px; image-rendering: pixelated; flex: none; }
.mt-tv-title { margin: 0; font-weight: 700; font-size: 15px; line-height: 1.35; }
@media (max-width: 720px) {
  .mt-game { grid-template-columns: 1fr; }
  .mt-tile { width: 112px; }
  .mt-tile-video { height: 76px; }
  .mt-tile.is-stage { width: 140px; }
  .mt-tile.is-stage .mt-tile-video { height: 96px; }
  .mt-tile-avatar { width: 32px; height: 64px; margin-top: -10px; }
  .mt-tv-now { flex-direction: column; align-items: flex-start; }
}


/* ---- Round 2: emotes, live talk, events, bots ---------------------------------- */
.mt-game-view { position: absolute; inset: 0; }
.mt-game-view .mt-top, .mt-game-view .mt-dock, .mt-game-view .mt-toasts, .mt-game-view .mt-live { transition: opacity 400ms ease; }
.mt-game-view.is-cinematic .mt-top, .mt-game-view.is-cinematic .mt-dock,
.mt-game-view.is-cinematic .mt-toasts, .mt-game-view.is-cinematic .mt-live { opacity: 0; pointer-events: none; }
.mt-btn.is-on { background: #2b6b58; border-color: #5ee0c1aa; }
.mt-emote-sep { height: 1px; background: var(--mt-line); margin: 2px 0; }
.mt-emote-head { margin: 2px 4px; display: flex; align-items: center; gap: 6px; color: var(--mt-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 650; }
.mt-emote-head svg { width: 14px; height: 14px; }
.mt-emotes { max-height: min(70vh, 520px); overflow-y: auto; }
.mt-live {
  position: absolute;
  top: calc(max(10px, var(--mobius-safe-top, 0px)) + 54px);
  left: calc(max(12px, var(--mobius-safe-left, 0px)) + 52px);
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-radius: 14px;
  background: rgba(27, 20, 38, 0.92); border: 1px solid #ffd36a88;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35); z-index: 3; max-width: min(460px, calc(100vw - 80px));
}
.mt-live-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--mt-red); box-shadow: 0 0 10px var(--mt-red); animation: mt-blink 1.2s steps(2) infinite; flex: none; }
.mt-live-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-live-clock { font-family: var(--mt-pixel); font-size: 20px; color: var(--mt-gold); }
.mt-live.is-warn .mt-live-clock { color: var(--mt-red); }
.mt-events { width: min(400px, calc(100vw - 24px)); }
.mt-events header .mt-btn { min-height: 36px; padding: 0 12px; }
.mt-event { padding: 12px; margin-bottom: 10px; border-radius: 14px; background: var(--mt-raise); border: 1px solid var(--mt-line); }
.mt-event.is-live { border-color: #ffd36aaa; box-shadow: inset 0 0 0 1px #ffd36a44; }
.mt-event h3 { margin: 2px 0 6px; font-size: 16px; }
.mt-event .mt-compose { flex-wrap: wrap; }
.mt-event .mt-compose .mt-input { min-width: 160px; }
.mt-event .mt-actions { margin-top: 10px; }
.mt-event-kind { font-family: var(--mt-pixel); color: var(--mt-teal); font-size: 13px; }
.mt-event.is-live .mt-event-kind { color: var(--mt-gold); }
.mt-event-meta { margin: 0 0 4px; color: var(--mt-muted); font-size: 12.5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mt-event-meta svg { width: 14px; height: 14px; }
.mt-slots { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.mt-slots li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: rgba(0, 0, 0, 0.18); }
.mt-slots li.is-running { background: #3a2f12; border: 1px solid #ffd36a88; }
.mt-slots .mt-btn { min-height: 34px; padding: 0 10px; font-size: 13px; }
.mt-slot-num { font-family: var(--mt-pixel); color: var(--mt-gold); width: 18px; text-align: center; }
.mt-slot-main { flex: 1; min-width: 0; display: grid; }
.mt-slot-main b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
.mt-slot-main small { color: var(--mt-muted); }
.mt-slot-clock { font-family: var(--mt-pixel); color: var(--mt-gold); font-size: 17px; }
.mt-empty-slot { color: var(--mt-muted); font-style: italic; }
.mt-event-form { display: grid; gap: 10px; margin-bottom: 14px; }
.mt-event-form label { display: grid; gap: 5px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mt-muted); font-weight: 650; }
.mt-event-form select.mt-input { appearance: auto; }
.mt-event-row { display: grid; grid-template-columns: 1fr 120px; gap: 10px; }
.mt-event-kinds { display: grid; gap: 6px; }
.mt-event-kinds .mt-toggle { justify-content: flex-start; text-align: left; min-height: 48px; }
.mt-event-kinds .mt-toggle span { display: grid; }
.mt-event-kinds .mt-toggle small { color: var(--mt-muted); font-weight: 500; }
.mt-bot-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.mt-bot { min-height: 64px; justify-content: flex-start; text-align: left; }
.mt-bot span { display: grid; }
.mt-bot small { color: var(--mt-muted); font-weight: 500; }
.mt-bot svg { width: 22px; height: 22px; flex: none; }
@media (max-width: 640px) {
  .mt-bot-row { grid-template-columns: 1fr; }
  .mt-live { left: 8px; right: 8px; top: auto; bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 126px); }
}

@media (max-width: 640px) {
  .mt-editor { grid-template-columns: 1fr; }
  .mt-picks { max-width: 260px; margin: 0 auto; }
  .mt-pick canvas { width: 64px; height: 109px; }
  .mt-panel { left: 8px; right: 8px; width: auto; top: auto; height: min(62vh, 520px); bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 70px); }
  .mt-me span { display: none; }
  .mt-dock { gap: 4px; padding: 6px; }
  .mt-iconbtn { width: 42px; height: 42px; }
  .mt-dock-sep { margin: 6px 1px; }
  .mt-me { padding-right: 4px; }
  .mt-chip .mt-sub { display: none; }
}
/* ---- Football ------------------------------------------------------------------- */
.mt-fb-lobby { position: absolute; z-index: 5; left: 50%; transform: translateX(-50%); bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 76px); width: min(420px, calc(100% - 24px)); padding: 14px 16px; border-radius: 16px; background: var(--mt-panel-solid, var(--mt-panel)); border: 1px solid var(--mt-line); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
.mt-fb-lobby header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.mt-fb-lobby h2 { margin: 0; font-size: 18px; font-weight: 400; color: var(--mt-gold); }
.mt-fb-count { font-family: var(--mt-pixel); color: #5cf08c; font-size: 15px; }
.mt-fb-teams { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; }
.mt-fb-team { display: grid; gap: 4px; padding: 8px 10px; border-radius: 12px; background: var(--mt-raise); }
.mt-fb-team b { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
.mt-fb-team.is-red b { color: #ff7a7a; }
.mt-fb-team.is-blue b { color: #7aa8ff; }
.mt-fb-team span { display: flex; align-items: center; gap: 6px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-fb-team span.is-bot { color: var(--mt-muted); font-weight: 500; }
.mt-fb-team svg { width: 14px; height: 14px; }
.mt-fb-vs { color: var(--mt-muted); }
.mt-fb-row { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.mt-fb-row > span { color: var(--mt-muted); font-size: 13px; margin-right: 4px; }
.mt-fb-level { min-height: 32px; padding: 0 12px; font-size: 13px; }
.mt-fb-board { position: absolute; z-index: 4; top: calc(max(10px, var(--mobius-safe-top, 0px)) + 52px); left: 50%; transform: translateX(-50%); display: grid; justify-items: center; gap: 6px; pointer-events: none; }
.mt-fb-board > * { pointer-events: auto; }
.mt-fb-score { display: flex; align-items: center; gap: 14px; padding: 6px 14px; border-radius: 14px; background: rgba(18, 15, 26, 0.86); border: 1px solid var(--mt-line); box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35); font-weight: 650; }
.mt-fb-score b { font-family: var(--mt-pixel); font-weight: 400; font-size: 22px; }
.mt-fb-score .is-red { color: #ff7a7a; }
.mt-fb-score .is-blue { color: #7aa8ff; }
.mt-fb-clock { color: #fff6dc; font-size: 16px; min-width: 52px; text-align: center; }
.mt-fb-banner { padding: 6px 16px; border-radius: 12px; background: rgba(18, 15, 26, 0.8); color: #ffd36a; font-size: 18px; }
.mt-fb-banner.is-goal { font-size: 30px; color: #fff3b0; text-shadow: 0 3px 0 #7a4a12; background: rgba(18, 15, 26, 0.55); animation: mt-fb-pop 600ms ease-out both; }
@keyframes mt-fb-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
.mt-fb-note { color: var(--mt-muted); font-size: 12.5px; }
.mt-fb-leave { min-height: 30px; padding: 0 10px; font-size: 12.5px; gap: 6px; }
.mt-fb-touch { position: absolute; z-index: 5; inset: auto 0 calc(max(14px, var(--mobius-safe-bottom, 0px)) + 84px) 0; display: flex; justify-content: space-between; align-items: flex-end; padding: 0 22px; pointer-events: none; }
.mt-fb-stick { pointer-events: auto; width: 120px; height: 120px; border-radius: 50%; background: rgba(18, 15, 26, 0.45); border: 2px solid rgba(255, 255, 255, 0.25); display: grid; place-items: center; touch-action: none; }
.mt-fb-stick span { width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 246, 220, 0.8); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); }
.mt-fb-buttons { display: flex; align-items: flex-end; gap: 10px; }
.mt-fb-kick, .mt-fb-pass { pointer-events: auto; width: 92px; height: 92px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.35); background: rgba(226, 62, 62, 0.85); color: #fff; font-size: 18px; touch-action: none; }
.mt-fb-kick:active { transform: scale(0.94); background: rgba(255, 90, 90, 0.95); }
/* Pass sits a little up and to the left of Kick, smaller, so a thumb finds each by feel; gold
   stands out on the green pitch without looking like either team's colour. */
.mt-fb-pass { width: 76px; height: 76px; margin-bottom: 36px; background: rgba(240, 184, 64, 0.9); color: var(--mt-bg); font-size: 16px; }
.mt-fb-pass:active { transform: scale(0.94); background: rgba(255, 211, 106, 0.97); }
@media (max-width: 345px) { .mt-fb-touch { padding: 0 10px; } } /* stick, pass and kick still fit side by side */
@media (max-width: 640px) {
  .mt-fb-board { top: calc(max(10px, var(--mobius-safe-top, 0px)) + 100px); }
}

/* ---- Stage screen sharing ------------------------------------------------------------- */
/* Zoom: on the right edge, clear of the top bar and the dock; open panels cover it. */
.mt-zoom { position: absolute; z-index: 3; right: max(12px, var(--mobius-safe-right, 0px)); top: 50%; transform: translateY(-50%); display: grid; justify-items: center; gap: 2px; padding: 5px; border-radius: 16px; background: var(--mt-panel); border: 1px solid var(--mt-line); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); backdrop-filter: blur(8px); }
.mt-zoom .mt-iconbtn { width: 40px; height: 40px; }
.mt-zoom .mt-iconbtn:disabled { opacity: 0.35; cursor: default; }
.mt-zoom-level { min-width: 46px; padding: 4px 0; border: 0; border-radius: 8px; background: transparent; color: var(--mt-text); font: inherit; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; cursor: pointer; }
.mt-zoom-level:hover { background: rgba(255, 255, 255, 0.08); }
.mt-stagectl { position: absolute; z-index: 4; right: max(12px, var(--mobius-safe-right, 0px)); bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 76px); width: min(300px, calc(100% - 24px)); display: grid; gap: 8px; padding: 12px 14px; border-radius: 16px; background: var(--mt-panel-solid, var(--mt-panel)); border: 1px solid var(--mt-line); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); }
.mt-stagectl-head { display: flex; align-items: center; gap: 8px; color: var(--mt-gold); }
.mt-stagectl-head svg { width: 18px; height: 18px; }
.mt-stagectl-note { margin: 0; color: var(--mt-muted); font-size: 12.5px; line-height: 1.4; }
.mt-stagectl-preview { width: 100%; aspect-ratio: 16 / 9; border-radius: 8px; background: rgba(0, 0, 0, 0.45); }
.mt-screen { position: absolute; z-index: 3; top: calc(max(10px, var(--mobius-safe-top, 0px)) + 56px); left: 50%; transform: translateX(-50%); /* As wide as fits, but never so tall that it covers the controls at the bottom. */ width: min(980px, 72vw, calc((100vh - 240px) * 16 / 9)); display: grid; gap: 6px; padding: 8px; border-radius: 16px; background: rgba(18, 15, 26, 0.92); border: 1px solid var(--mt-line); box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5); }
.mt-screen header { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-weight: 650; }
.mt-screen header span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-screen header svg { width: 18px; height: 18px; color: var(--mt-gold); }
.mt-screen header .mt-iconbtn { width: 32px; height: 32px; }
.mt-screen header .mt-iconbtn svg { color: inherit; }
.mt-screen-video { width: 100%; aspect-ratio: 16 / 9; border-radius: 8px; background: #000; }
.mt-screen.is-small { top: auto; left: auto; transform: none; right: max(12px, var(--mobius-safe-right, 0px)); bottom: calc(max(14px, var(--mobius-safe-bottom, 0px)) + 76px); width: min(340px, 60vw); }
@media (max-width: 640px) {
  .mt-screen { width: min(calc(100% - 16px), calc((100vh - 290px) * 16 / 9)); top: calc(max(10px, var(--mobius-safe-top, 0px)) + 100px); }
}

@media (prefers-reduced-motion: reduce) {
  .mt-root *, .mt-root *::before, .mt-root *::after { animation: none !important; transition: none !important; }
}
`
