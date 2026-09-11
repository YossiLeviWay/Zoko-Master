import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AccessProfileEditor from '../../../src/components/Access/AccessProfileEditor';
import { presetProfile } from '../../../functions/src/accessCatalog.js';
import '../../../src/components/Access/SimpleAccess.css';
const initial = presetProfile('teacher');
function Fixture() {
  const [profile, setProfile] = useState(initial);
  const [saved, setSaved] = useState(false);
  return <main style={{ fontFamily: 'Arial,sans-serif', background: '#eef1f5', minHeight: '100dvh', display: 'grid', placeItems: 'center', margin: -8, padding: 12, boxSizing: 'border-box' }}><section className="simple-access-dialog" dir="rtl"><header><h3>גישה — מוחמד בדראן</h3><button aria-label="סגירה">×</button></header><div className="access-dialog-body"><AccessProfileEditor value={profile} onChange={setProfile} original={initial} userId="teacher" classes={[{ id: 'class_a', name: 'י׳2', teacherId: 'teacher', staffIds: [] }, { id: 'class_b', name: 'י״א1', teacherId: 'other', staffIds: ['teacher'] }]} roles={[{ id: 'r', name: 'רכז פדגוגי', permissions: { 'grades.view': true }, accessScope: { type: 'classes', classIds: ['class_b'] } }]} />{saved && <p role="status">הגישה נשמרה בתצוגת הבדיקה</p>}</div><footer><button onClick={() => setSaved(true)} style={{ background: '#fc5029', color: '#fff', border: 0, padding: '12px 22px', borderRadius: 10, fontWeight: 700 }}>שמירת גישה</button><button onClick={() => setProfile(initial)} style={{ border: '1px solid #ddd', padding: '12px 20px', background: '#fff', borderRadius: 10 }}>ביטול</button></footer></section></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
