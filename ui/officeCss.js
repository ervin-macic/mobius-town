// Styles for the Agent Office's panels (ui/Office.jsx). Appended to the town's stylesheet.
export const OFFICE_CSS = `
.mt-office-sheet { width: min(520px, 100%); max-height: min(720px, calc(100vh - 32px)); overflow-y: auto; }
.mt-office-head-icon { width: 22px; height: 22px; color: var(--mt-gold); flex: none; }
.mt-office-who { display: flex; gap: 14px; align-items: center; }
.mt-office-face {
  width: 48px; height: 66px; flex: none; image-rendering: pixelated;
  border-radius: 14px; background: linear-gradient(180deg, #3a3060, #241c3c); border: 1px solid var(--mt-line);
}
.mt-office-who-text { min-width: 0; }
.mt-office-who-text h3 { margin: 0; font-size: 17px; line-height: 1.3; overflow-wrap: anywhere; }
.mt-office-status { margin: 4px 0 0; color: var(--mt-muted); font-size: 13px; display: flex; align-items: center; gap: 7px; }
.mt-office-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35); }
.mt-office-quote { margin-top: 14px; padding: 10px 12px; border-radius: 12px; background: var(--mt-raise); border: 1px solid var(--mt-line); }
.mt-office-quote h4, .mt-office-label {
  margin: 0 0 4px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mt-muted); font-weight: 650;
}
.mt-office-quote p {
  margin: 0; line-height: 1.5; font-size: 14px; white-space: pre-line; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
}
.mt-office-quote p.is-quiet { color: var(--mt-muted); font-style: italic; }
.mt-office-prompt { min-height: 84px; padding: 10px 12px; resize: vertical; line-height: 1.45; }
.mt-office-actions { flex-wrap: wrap; justify-content: flex-end; }
.mt-office-lede { color: var(--mt-muted); font-size: 14px; }
.mt-office-problem {
  margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.45;
  background: rgba(255, 107, 116, 0.12); border: 1px solid rgba(255, 107, 116, 0.35);
}
.mt-office-search { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.mt-office-search svg { width: 18px; height: 18px; color: var(--mt-muted); flex: none; }
.mt-office-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 4px; }
.mt-office-list li { display: flex; align-items: center; gap: 8px; }
.mt-office-row {
  flex: 1; min-width: 0; min-height: 48px; display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 6px 10px; border-radius: 12px; border: 1px solid transparent; background: transparent; cursor: pointer;
}
.mt-office-row:hover { background: var(--mt-raise); }
.mt-office-row:focus-visible, .mt-office-open:focus-visible { outline: 2px solid var(--mt-gold); outline-offset: 2px; }
.mt-office-row-main { min-width: 0; display: grid; }
.mt-office-row-title { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-office-row-sub { color: var(--mt-muted); font-size: 12px; }
.mt-office-open { min-height: 40px; padding: 0 12px; flex: none; }
.mt-office-open svg, .mt-office-actions svg { width: 16px; height: 16px; }
@media (max-width: 520px) {
  .mt-office-actions .mt-btn { flex: 1 1 100%; }
}
`
