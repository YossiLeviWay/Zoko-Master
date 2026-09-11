import { useState } from 'react';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import LegacyClassPermissionsManager from './LegacyClassPermissionsManager';
export default function ClassPermissionsManager({ schoolId, classes, onClose }) {
  const [legacy, setLegacy] = useState(false);
  if (legacy) return <LegacyClassPermissionsManager schoolId={schoolId} classes={classes} onClose={() => setLegacy(false)} />;
  return <PagePermissionsPanel feature="students" onClose={onClose} advancedContent={<details><summary>אפשרויות מתקדמות</summary><p>ניהול שיוכי גישה ותיקים לפי שם הכיתה.</p><button type="button" className="btn btn-secondary" onClick={() => setLegacy(true)}>הגדרות כיתה קודמות</button></details>} />;
}
