import { APP_BUILD_INFO, APP_VERSION } from '../../config/appVersion';

function shortBuildDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function displayBuildDate(value) {
  if (!value) return 'לא זמין';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'לא זמין' : date.toLocaleString('he-IL');
}

export default function AppVersion() {
  const details = [
    `תאריך בנייה: ${displayBuildDate(APP_BUILD_INFO.buildDate)}`,
    `Commit: ${APP_BUILD_INFO.commit}`,
    `סביבה: ${APP_BUILD_INFO.environment}`,
  ].join('\n');

  // Visible on purpose: the version, the exact commit and the build time show which update is live.
  const label = [APP_VERSION, APP_BUILD_INFO.commit, shortBuildDate(APP_BUILD_INFO.buildDate)].filter(Boolean).join(' · ');
  return <span className="app-version" title={details} aria-label={`גרסת אפליקציה ${label}`}>{label}</span>;
}
