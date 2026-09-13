import './ZokiEnginePicker.css';

export default function ZokiEnginePicker({ onCodex }) {
  return <details className="zoki-engine-picker" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.removeAttribute('open');
      event.currentTarget.querySelector('summary').focus();
    }
  }}>
    <summary>מודל: זוקי רגיל <span aria-hidden="true">⌄</span></summary>
    <div className="zoki-engine-options" aria-label="בחירת מודל">
      <strong>בחירת מודל</strong>
      <button type="button" aria-pressed="true" onClick={event => event.currentTarget.closest('details').removeAttribute('open')}>זוקי רגיל <span>פעיל</span></button>
      <button type="button" disabled={!onCodex} onClick={onCodex}>Codex שלי <span>במחשב שלי</span></button>
      {!onCodex && <p>Codex זמין רק במחשב שלך. הפעל את החיבור המקומי באמצעות <code dir="ltr">npm run dev:codex</code>, ופתח שם את זוקי כדי לבחור בו.</p>}
      {!onCodex && <a href="http://127.0.0.1:5189/Zoko-Master/#/zoki" target="_blank" rel="noreferrer">פתיחת זוקי המקומי</a>}
    </div>
  </details>;
}
