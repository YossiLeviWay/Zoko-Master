import { APP_BUILD_INFO, APP_VERSION } from '../../config/appVersion';

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

  return <span className="app-version" title={details} aria-label={`גרסת אפליקציה ${APP_VERSION}`}>{APP_VERSION}</span>;
}
