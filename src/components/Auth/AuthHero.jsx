import { CalendarDays, ClipboardCheck, ListChecks, ShieldCheck } from 'lucide-react';
import './AuthHero.css';

const FEATURES = [
  { icon: CalendarDays, title: 'לוח שנה אחד לכל הצוות', text: 'אירועים, חופשות ומשימות באותו מבט שבועי.' },
  { icon: ClipboardCheck, title: 'נוכחות ותיקי תלמידים', text: 'כל תלמיד בגיליון הוא כרטיס תלמיד מלא במערכת.' },
  { icon: ListChecks, title: 'משימות עם אחריות ומעקב', text: 'מי אחראי, עד מתי, ומה כבר נעשה.' },
];

const WEEK = [
  { day: 'א׳', bars: ['a', 'c'] },
  { day: 'ב׳', bars: ['b'] },
  { day: 'ג׳', bars: ['a', 'b', 'c'] },
  { day: 'ד׳', bars: ['c'] },
  { day: 'ה׳', bars: ['b', 'a'] },
];

// Decorative product sketch: abstract shapes only, no real or invented data.
function HeroPreview() {
  return (
    <div className="auth-hero-preview" aria-hidden="true">
      <div className="auth-hero-card auth-hero-card--week">
        <div className="auth-hero-card-title"><CalendarDays size={14} /> השבוע</div>
        <div className="auth-hero-week">
          {WEEK.map((column, index) => (
            <div key={column.day} className={`auth-hero-day${index === 2 ? ' auth-hero-day--today' : ''}`}>
              <span>{column.day}</span>
              {column.bars.map((tone, barIndex) => <i key={barIndex} className={`auth-hero-bar auth-hero-bar--${tone}`} />)}
            </div>
          ))}
        </div>
      </div>
      <div className="auth-hero-card auth-hero-card--attendance">
        <div className="auth-hero-card-title"><ClipboardCheck size={14} /> נוכחות</div>
        {[0, 1, 2].map(row => (
          <div key={row} className="auth-hero-row">
            <b />
            {[0, 1, 2, 3, 4].map(cell => <i key={cell} className={row === 1 && cell === 3 ? 'off' : ''} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Split-screen entry page: a brand hero beside the sign-in (or registration) card.
 * On a narrow screen the hero shrinks to a short banner above the card.
 */
export default function AuthHero({ children }) {
  return (
    <div className="auth-page auth-page--hero">
      <section className="auth-hero" aria-label="על המערכת">
        <div className="auth-hero-brand">Zoko-Master</div>
        <div className="auth-hero-body">
          <p className="auth-hero-eyebrow">מערכת ניהול מוסדות חינוך</p>
          <h2 className="auth-hero-title">כל בית הספר,{' '}<br /><span>במקום אחד.</span></h2>
          <p className="auth-hero-lead">לוח שנה, משימות, נוכחות ותיקי תלמידים — מסונכרנים בזמן אמת לכל אנשי הצוות.</p>
          <ul className="auth-hero-features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}><span className="auth-hero-icon"><Icon size={18} /></span><div><strong>{title}</strong><small>{text}</small></div></li>
            ))}
          </ul>
        </div>
        <HeroPreview />
        <p className="auth-hero-foot"><ShieldCheck size={15} /> התחברות מאובטחת · גישה לפי תפקיד והרשאה</p>
      </section>
      <main className="auth-panel">{children}</main>
    </div>
  );
}
