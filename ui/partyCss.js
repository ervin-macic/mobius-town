// Party challenge styles (ui/Party.jsx). Append to the app stylesheet after
// theme.js's CSS: every rule is scoped to an .mt-party- class and relies on the
// theme's variables (--mt-gold, --mt-teal, --mt-panel-solid, --mt-line, ...).
export const PARTY_CSS = `
/* Centred while it fits; scrolls from the top (never clipped) when the card is taller than the screen. */
.mt-party { align-items: start; }
.mt-party-card { margin-block: auto; width: min(640px, 100%); padding: 18px 18px 20px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; position: relative; overflow: hidden; }
.mt-party-card:focus, .mt-party-card:focus-visible { outline: none; }
.mt-party-card svg { flex: none; }
.mt-party-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

/* ---- Header, score and line-up ------------------------------------------------ */
.mt-party-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mt-party-head h2 { flex: 1 1 180px; min-width: 0; margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 400; font-size: 20px; color: var(--mt-gold); }
.mt-party-head h2 svg { width: 20px; height: 20px; }
.mt-party-head h2 span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-leave { padding: 0 14px; }
.mt-party-leave svg { width: 18px; height: 18px; }
.mt-party-x svg { width: 20px; height: 20px; }
.mt-party-score { display: inline-flex; align-items: center; gap: 8px; margin: 0; min-height: 36px; padding: 4px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.28); border: 1px solid var(--mt-line); white-space: nowrap; max-width: 100%; }
.mt-party-score b { font-family: var(--mt-pixel); font-weight: 400; font-size: 18px; color: var(--mt-text); font-variant-numeric: tabular-nums; }
.mt-party-score-name { max-width: 8em; overflow: hidden; text-overflow: ellipsis; color: var(--mt-muted); font-size: 12.5px; font-weight: 650; }
.mt-party-score-dash { width: 10px; height: 3px; border-radius: 2px; background: var(--mt-muted); }
.mt-party-score.is-big { gap: 12px; padding: 10px 18px; border-radius: 16px; }
.mt-party-score.is-big b { font-size: 34px; color: var(--mt-gold); }
.mt-party-score.is-big .mt-party-score-name { font-size: 14px; color: var(--mt-text); }
.mt-party-lineup { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mt-party-step { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 8px; min-height: 44px; padding: 6px 10px; border-radius: 12px; background: var(--mt-raise); border: 1px solid transparent; }
.mt-party-step svg { grid-row: span 2; width: 20px; height: 20px; color: var(--mt-muted); }
.mt-party-step-name { font-weight: 700; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-step-note { font-size: 11.5px; color: var(--mt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-step.is-now { border-color: var(--mt-gold); background: rgba(255, 211, 106, 0.1); }
.mt-party-step.is-now svg { color: var(--mt-gold); }
.mt-party-step.is-won { border-color: rgba(94, 224, 193, 0.45); }
.mt-party-step.is-won svg, .mt-party-step.is-won .mt-party-step-note { color: var(--mt-teal); }
.mt-party-step.is-lost svg { color: var(--mt-red); }
.mt-party-stage { min-height: 290px; display: grid; grid-template-columns: minmax(0, 1fr); align-content: center; gap: 14px; }
.mt-party-note { margin: 0; text-align: center; color: var(--mt-muted); line-height: 1.45; }
.mt-party-countdown { margin: 0; display: inline-flex; align-items: center; gap: 6px; color: var(--mt-muted); font-variant-numeric: tabular-nums; }
.mt-party-countdown svg { width: 18px; height: 18px; }
.mt-party-countdown b { color: var(--mt-text); font-family: var(--mt-pixel); font-weight: 400; font-size: 17px; }
.mt-party-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 12px; border-radius: 999px; background: var(--mt-raise); border: 1px solid var(--mt-line); font-size: 13px; font-weight: 650; }
.mt-party-chip svg { width: 16px; height: 16px; }
.mt-party-chip.is-good { color: var(--mt-teal); border-color: rgba(94, 224, 193, 0.45); }
.mt-party-chip.is-bad { color: var(--mt-gold); border-color: rgba(255, 211, 106, 0.45); }
.mt-party-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; margin: 0; }

/* ---- Intro ---------------------------------------------------------------------- */
.mt-party-vs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; }
.mt-party-fighter { display: grid; justify-items: center; gap: 6px; min-width: 0; padding: 16px 8px; border-radius: 16px; border: 1px solid var(--mt-line); background: linear-gradient(180deg, rgba(77, 141, 255, 0.22), rgba(77, 141, 255, 0.04)); }
.mt-party-fighter.is-opp { background: linear-gradient(180deg, rgba(255, 107, 116, 0.22), rgba(255, 107, 116, 0.04)); }
.mt-party-fighter-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; font-size: clamp(16px, 4.6vw, 22px); }
.mt-party-fighter-note { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--mt-muted); }
.mt-party-fighter-note svg { width: 14px; height: 14px; }
.mt-party-fighter-note.is-ready { color: var(--mt-green); }
.mt-party-vs-mark { font-size: clamp(30px, 9vw, 48px); animation: mt-party-throb 1.2s ease-in-out infinite; }
.mt-party-games { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.mt-party-games li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 2px 12px; align-items: center; padding: 10px 12px; border-radius: 14px; background: var(--mt-raise); }
.mt-party-game-icon { grid-row: span 2; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: rgba(0, 0, 0, 0.3); color: var(--mt-gold); }
.mt-party-game-icon svg { width: 22px; height: 22px; }
.mt-party-games b { font-weight: 700; }
.mt-party-how { color: var(--mt-muted); font-size: 12.5px; line-height: 1.35; }
.mt-party-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.mt-party-bar .mt-btn svg { width: 18px; height: 18px; }

/* ---- Quick Draw ------------------------------------------------------------------ */
.mt-party-duel {
  position: relative; width: 100%; min-height: 240px; display: grid; place-items: center; align-content: center; gap: 10px;
  padding: 20px 16px 44px; border-radius: 18px; border: 2px solid var(--mt-line); cursor: pointer; overflow: hidden;
  touch-action: manipulation; user-select: none; -webkit-user-select: none; color: var(--mt-text);
  background: linear-gradient(180deg, #2c1e46 0%, #57294a 55%, #8a432f 100%);
}
.mt-party-duel::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 30px; pointer-events: none; background: repeating-linear-gradient(90deg, #3e2418 0 8px, #4a2b1c 8px 16px); box-shadow: 0 -4px 0 #2a170f; }
.mt-party-duel:focus-visible { outline: 3px solid var(--mt-gold); outline-offset: 3px; }
.mt-party-duel-word { position: relative; z-index: 1; font-family: 'KenneyBlocks', var(--mt-pixel); font-size: clamp(34px, 11vw, 64px); line-height: 1; letter-spacing: 0.04em; text-shadow: 0 4px 0 rgba(0, 0, 0, 0.45); }
.mt-party-duel-sub { position: relative; z-index: 1; font-size: 14px; font-weight: 650; color: rgba(255, 255, 255, 0.85); max-width: 32ch; text-align: center; line-height: 1.35; }
.mt-party-duel.is-wait .mt-party-duel-word { color: #d9cfe9; animation: mt-party-breathe 1.6s ease-in-out infinite; }
.mt-party-duel.is-draw { background: radial-gradient(circle at 50% 42%, #fff7d6 0%, #ffd36a 45%, #f0922c 100%); border-color: #fff1b8; color: #2a1d0b; }
.mt-party-duel.is-draw .mt-party-duel-word { color: #2a1d0b; text-shadow: 0 4px 0 rgba(122, 74, 18, 0.45); animation: mt-party-slam 160ms ease-out; }
.mt-party-duel.is-draw .mt-party-duel-sub { color: #3b2a10; }
.mt-party-duel.is-valid { background: linear-gradient(180deg, #123a35, #1d5c4f); border-color: rgba(94, 224, 193, 0.6); }
.mt-party-duel.is-valid .mt-party-duel-word { color: var(--mt-teal); }
.mt-party-duel.is-false_start, .mt-party-duel.is-timeout { background: linear-gradient(180deg, #3f1823, #5b2430); border-color: rgba(255, 107, 116, 0.6); }
.mt-party-duel.is-false_start .mt-party-duel-word, .mt-party-duel.is-timeout .mt-party-duel-word { color: var(--mt-red); }
.mt-party-banner { margin: 0; padding: 8px 12px; border-radius: 12px; background: rgba(255, 211, 106, 0.12); border: 1px solid rgba(255, 211, 106, 0.4); color: var(--mt-gold); font-weight: 650; text-align: center; }

/* ---- Rock-Paper-Scissors ----------------------------------------------------------- */
.mt-party-rps-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; }
.mt-party-round { margin: 0; font-family: var(--mt-pixel); font-size: 17px; color: var(--mt-teal); }
.mt-party-wins { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.mt-party-wins > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 13em; }
.mt-party-wins-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-pips { display: inline-flex; gap: 4px; }
.mt-party-pip { width: 12px; height: 12px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35); }
.mt-party-pip.is-on { background: var(--mt-gold); }
.mt-party-choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mt-party-choices:focus, .mt-party-choices:focus-visible { outline: none; }
.mt-party-choice {
  position: relative; display: grid; justify-items: center; align-content: center; gap: 6px; min-width: 0; min-height: 132px;
  padding: 14px 6px 12px; border-radius: 16px; border: 2px solid var(--mt-line); background: var(--mt-raise); cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
}
.mt-party-choice:hover:not(:disabled) { transform: translateY(-2px); border-color: rgba(255, 211, 106, 0.6); background: rgba(255, 255, 255, 0.1); }
.mt-party-choice:active:not(:disabled) { transform: translateY(1px); }
.mt-party-choice.is-picked { border-color: var(--mt-gold); background: rgba(255, 211, 106, 0.14); }
.mt-party-choice:disabled { cursor: default; }
.mt-party-choice:disabled:not(.is-picked) { opacity: 0.45; }
.mt-party-choice-name { font-weight: 700; }
.mt-party-choice .mt-key { position: absolute; top: 6px; right: 6px; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 7px; font-size: 13px; }
.mt-party-art { width: clamp(52px, 15vw, 72px); height: auto; image-rendering: pixelated; }
.mt-party-reveal { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 10px; }
.mt-party-hand { margin: 0; min-width: 0; display: grid; justify-items: center; gap: 8px; padding: 16px 6px 12px; border-radius: 16px; background: var(--mt-raise); border: 2px solid var(--mt-line); }
.mt-party-hand .mt-party-art { width: clamp(64px, 19vw, 96px); animation: mt-party-pop 420ms cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.mt-party-hand.is-opp .mt-party-art { animation-delay: 140ms; }
.mt-party-hand.is-winner { border-color: var(--mt-gold); box-shadow: 0 0 0 3px rgba(255, 211, 106, 0.18); }
.mt-party-hand figcaption { display: grid; gap: 2px; text-align: center; font-weight: 700; font-size: 13px; max-width: 100%; }
.mt-party-hand figcaption span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-hand small { font-weight: 500; color: var(--mt-muted); font-size: 11.5px; }
.mt-party-vs-small { font-size: 15px; color: var(--mt-muted); }
.mt-party-hidden { display: block; width: clamp(52px, 15vw, 72px); aspect-ratio: 1; border-radius: 10px; border: 2px solid var(--mt-line); background: repeating-linear-gradient(45deg, #2c2342 0 6px, #382c55 6px 12px); }
.mt-party-outcome { margin: 0; text-align: center; font-family: var(--mt-pixel); font-size: 17px; line-height: 1.35; color: var(--mt-gold); animation: mt-party-fade 300ms ease-out 380ms both; }

/* ---- Speed Sprint ------------------------------------------------------------------ */
.mt-party-sprint-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mt-party-timebar { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.mt-party-timebar span { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--mt-red), var(--mt-gold) 35%, var(--mt-teal)); transition: width 200ms linear; }
.mt-party-problem { margin: 0; text-align: center; font-family: var(--mt-pixel); font-size: clamp(36px, 11vw, 60px); line-height: 1.1; letter-spacing: 0.03em; color: var(--mt-text); font-variant-numeric: tabular-nums; }
.mt-party-problem.is-wrong { color: var(--mt-red); animation: mt-party-shake 320ms ease-in-out; }
.mt-party-problem.is-right { color: var(--mt-green); }
.mt-party-answer { display: flex; gap: 8px; }
.mt-party-answer .mt-input { flex: 1 1 auto; width: 100%; min-width: 0; font-size: 24px; font-family: var(--mt-pixel); text-align: center; }
.mt-party-answer .mt-input[readonly] { opacity: 0.55; }
.mt-party-answer .mt-btn { min-width: 88px; }
.mt-party-lock { margin: 0; padding: 8px 12px; border-radius: 12px; background: rgba(255, 107, 116, 0.12); border: 1px solid rgba(255, 107, 116, 0.45); color: var(--mt-red); font-weight: 650; text-align: center; font-variant-numeric: tabular-nums; }
.mt-party-big-count { margin: 0; text-align: center; font-family: 'KenneyBlocks', var(--mt-pixel); font-size: clamp(56px, 18vw, 96px); color: var(--mt-gold); text-shadow: 0 4px 0 #7a4a12; animation: mt-party-slam 300ms ease-out; }
.mt-party-racers { display: grid; gap: 8px; }
.mt-party-racer { display: grid; grid-template-columns: minmax(0, 7em) minmax(0, 1fr) 4.2em; align-items: center; gap: 10px; font-size: 13px; }
.mt-party-racer-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-track { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
.mt-party-track span { height: 14px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.3); }
.mt-party-track span.is-on { background: var(--mt-teal); }
.mt-party-racer.is-opp .mt-party-track span.is-on { background: var(--mt-blue); }
.mt-party-racer-note { color: var(--mt-muted); text-align: right; font-variant-numeric: tabular-nums; }
.mt-party-racer-note.is-locked { color: var(--mt-red); }

/* ---- Results and the final screen ---------------------------------------------------- */
.mt-party-result, .mt-party-final { display: grid; justify-items: center; gap: 12px; text-align: center; }
.mt-party-medal { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; background: rgba(255, 211, 106, 0.14); border: 2px solid rgba(255, 211, 106, 0.5); color: var(--mt-gold); }
.mt-party-medal svg { width: 34px; height: 34px; }
.mt-party-medal.is-loss { background: rgba(255, 255, 255, 0.06); border-color: var(--mt-line); color: var(--mt-muted); }
.mt-party-medal.is-large { width: 76px; height: 76px; animation: mt-party-pop 520ms cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.mt-party-medal.is-large svg { width: 42px; height: 42px; }
.mt-party-headline { margin: 0; font-family: var(--mt-pixel); font-weight: 400; font-size: clamp(20px, 5.5vw, 28px); line-height: 1.2; color: var(--mt-gold); }
.mt-party-headline.is-loss { color: var(--mt-text); }
.mt-party-final .mt-title { font-size: clamp(22px, 6.4vw, 34px); line-height: 1.15; text-align: center; }
.mt-party-detail { margin: 0; max-width: 46ch; color: var(--mt-muted); line-height: 1.45; }
.mt-party-summary { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; width: 100%; }
.mt-party-summary li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 44px; padding: 8px 12px; border-radius: 12px; background: var(--mt-raise); text-align: left; }
.mt-party-summary svg { width: 20px; height: 20px; color: var(--mt-muted); }
.mt-party-summary-game { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-party-summary-who { font-size: 12.5px; color: var(--mt-muted); white-space: nowrap; }
.mt-party-summary-who.is-mine { color: var(--mt-teal); font-weight: 700; }
.mt-party-final .mt-actions { justify-content: center; margin-top: 4px; }

/* ---- Leave confirmation ---------------------------------------------------------------- */
.mt-party-confirm { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 3; padding: 14px 16px; border-radius: 16px; background: var(--mt-panel-solid); border: 1px solid rgba(255, 107, 116, 0.55); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55); animation: mt-party-fade 160ms ease-out both; }
.mt-party-confirm-title { margin: 0 0 4px; font-weight: 700; font-size: 15px; }
.mt-party-confirm .mt-party-note { text-align: left; }
.mt-party-confirm .mt-actions { margin-top: 12px; }

/* ---- Confetti --------------------------------------------------------------------------- */
.mt-party-confetti { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
.mt-party-confetti span { position: absolute; left: 50%; top: 34%; width: var(--s); height: var(--s); background: var(--c); opacity: 0; animation: mt-party-burst 1700ms cubic-bezier(0.15, 0.7, 0.35, 1) var(--delay) both; }

@keyframes mt-party-burst {
  0% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
  45% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(calc(var(--rot) * 0.6)); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx) * 1.3), calc(-50% + var(--dy) + 260px)) rotate(var(--rot)); opacity: 0; }
}
@keyframes mt-party-slam { from { transform: scale(1.35); opacity: 0.2; } to { transform: none; opacity: 1; } }
@keyframes mt-party-pop { 0% { transform: scale(0.4) rotate(-12deg); opacity: 0; } 70% { transform: scale(1.12) rotate(3deg); opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes mt-party-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
@keyframes mt-party-breathe { 50% { opacity: 0.55; transform: scale(0.97); } }
@keyframes mt-party-throb { 50% { transform: scale(1.08); } }
@keyframes mt-party-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

@media (max-width: 520px) {
  .mt-party-card { padding: 14px 12px 16px; gap: 12px; }
  .mt-party-head h2 { flex-basis: 100%; font-size: 18px; }
  .mt-party-head .mt-party-score { flex: 1 1 auto; }
  .mt-party-step { grid-template-columns: minmax(0, 1fr); align-content: start; text-align: center; padding: 6px 4px; }
  .mt-party-step svg { grid-row: auto; justify-self: center; }
  .mt-party-step-name { white-space: normal; line-height: 1.2; font-size: 12px; }
  .mt-party-stage { min-height: 250px; }
  .mt-party-duel { min-height: 220px; }
  .mt-party-choices { gap: 8px; }
  .mt-party-choice { min-height: 118px; }
  .mt-party-games li { padding: 8px 10px; }
  .mt-party-racer { grid-template-columns: minmax(0, 4.5em) minmax(0, 1fr) 3.6em; gap: 8px; }
  .mt-party-bar { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
  .mt-party-card *, .mt-party-card *::before, .mt-party-card *::after { animation: none !important; transition: none !important; }
}
`
