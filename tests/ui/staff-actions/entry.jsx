import React from 'react';
import { createRoot } from 'react-dom/client';
import { User, Pencil, Trash2 } from 'lucide-react';
import StaffActions from '../../../src/components/Staff/StaffActions';
import '../../../src/components/Staff/Staff.css';
createRoot(document.getElementById('root')).render(<main style={{ padding: 32, fontFamily: 'Arial', height: 1000 }}><h2>בדיקת תפריט ניהול</h2>{[0, 1, 2].map(i => <div key={i} style={{ marginTop: 100, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd' }}><span>איש צוות לדוגמה</span><StaffActions name="איש צוות לדוגמה" actions={[{ id: 'view', label: 'כרטיס איש צוות', icon: User }, { id: 'edit', label: 'עריכת התפקיד בבית הספר', icon: Pencil }, { id: 'remove', label: 'הסרה מהמוסד', icon: Trash2, danger: true }].map(action => ({ ...action, onSelect() {} }))} /></div>)}</main>);
