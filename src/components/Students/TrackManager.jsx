import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot
} from 'firebase/firestore';
import { Plus, Trash2, Edit3, X, Save, ChevronDown, ChevronUp, GraduationCap } from 'lucide-react';

const PROGRAM_TYPES = [
  { id: 'full_matriculation', label: 'בגרות מלאה' },
  { id: 'tech_matriculation', label: 'בגרות טכנולוגית' },
  { id: 'professional_cert', label: 'תעודת מקצוע' },
  { id: 'completion_cert', label: 'תעודת גמר' },
];

const REQUIREMENT_TYPES = [
  { id: 'exam', label: 'מבחן' },
  { id: 'eval', label: 'הערכה חלופית' },
  { id: 'practical', label: 'מבחן מעשי' },
  { id: 'project', label: 'פרויקט' },
  { id: 'other', label: 'אחר' },
];

const EMPTY_TRACK = { name: '', programType: '', description: '', requirements: [] };
const EMPTY_REQ = { name: '', type: 'exam', required: true, units: '', description: '' };

export default function TrackManager({ schoolId, onClose }) {
  const [tracks, setTracks] = useState([]);
  const [editingTrack, setEditingTrack] = useState(null); // null = list view, 'new' = new, id = edit
  const [trackForm, setTrackForm] = useState(EMPTY_TRACK);
  const [expandedTrack, setExpandedTrack] = useState(null);
  const [newReq, setNewReq] = useState(EMPTY_REQ);
  const [showReqForm, setShowReqForm] = useState(false);
  const [filterProgram, setFilterProgram] = useState('');

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `tracks_${schoolId}`), snap => {
      setTracks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  function openNew() {
    setTrackForm(EMPTY_TRACK);
    setEditingTrack('new');
    setNewReq(EMPTY_REQ);
    setShowReqForm(false);
  }

  function openEdit(track) {
    setTrackForm({
      name: track.name || '',
      programType: track.programType || '',
      description: track.description || '',
      requirements: track.requirements ? [...track.requirements] : [],
    });
    setEditingTrack(track.id);
    setNewReq(EMPTY_REQ);
    setShowReqForm(false);
  }

  async function saveTrack() {
    if (!trackForm.name.trim()) return;
    const data = {
      name: trackForm.name.trim(),
      programType: trackForm.programType,
      description: trackForm.description,
      requirements: trackForm.requirements,
      updatedAt: new Date().toISOString(),
    };
    if (editingTrack === 'new') {
      await addDoc(collection(db, `tracks_${schoolId}`), {
        ...data,
        createdAt: new Date().toISOString(),
      });
    } else {
      await updateDoc(doc(db, `tracks_${schoolId}`, editingTrack), data);
    }
    setEditingTrack(null);
  }

  async function deleteTrack(trackId) {
    if (!confirm('האם למחוק מגמה זו? הפעולה תשפיע על תלמידים המשויכים אליה.')) return;
    await deleteDoc(doc(db, `tracks_${schoolId}`, trackId));
  }

  function addRequirement() {
    if (!newReq.name.trim()) return;
    const req = { ...newReq, id: `req_${Date.now()}` };
    setTrackForm(prev => ({ ...prev, requirements: [...prev.requirements, req] }));
    setNewReq(EMPTY_REQ);
    setShowReqForm(false);
  }

  function removeRequirement(reqId) {
    setTrackForm(prev => ({
      ...prev,
      requirements: prev.requirements.filter(r => r.id !== reqId),
    }));
  }

  function updateRequirement(reqId, field, value) {
    setTrackForm(prev => ({
      ...prev,
      requirements: prev.requirements.map(r => r.id === reqId ? { ...r, [field]: value } : r),
    }));
  }

  const filteredTracks = filterProgram
    ? tracks.filter(t => t.programType === filterProgram)
    : tracks;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--wide" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <GraduationCap size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.4rem' }} />
            ניהול מגמות ומסלולי לימוד
          </h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-form" style={{ padding: '1rem 1.5rem' }}>
          {editingTrack === null ? (
            /* Track List */
            <>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus size={15} />
                  מגמה חדשה
                </button>
                <select
                  value={filterProgram}
                  onChange={e => setFilterProgram(e.target.value)}
                  style={{ padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.82rem', background: '#f8fafc' }}
                >
                  <option value="">כל המסלולים</option>
                  {PROGRAM_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <span style={{ marginRight: 'auto', fontSize: '0.8rem', color: '#64748b' }}>{filteredTracks.length} מגמות</span>
              </div>

              <div className="tracks-list">
                {filteredTracks.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    <GraduationCap size={32} style={{ marginBottom: '0.5rem' }} />
                    <p>אין מגמות עדיין. צור מגמה חדשה.</p>
                  </div>
                )}
                {filteredTracks.map(track => (
                  <div key={track.id} className="track-item">
                    <div
                      className="track-item-header"
                      onClick={() => setExpandedTrack(expandedTrack === track.id ? null : track.id)}
                    >
                      <div>
                        <span className="track-item-name">{track.name}</span>
                        <span className={`student-program-badge student-program--${track.programType}`} style={{ marginRight: '0.5rem' }}>
                          {PROGRAM_TYPES.find(p => p.id === track.programType)?.label || '—'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {(track.requirements || []).length} דרישות
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button className="icon-btn" onClick={e => { e.stopPropagation(); openEdit(track); }} title="עריכה">
                          <Edit3 size={14} />
                        </button>
                        <button className="icon-btn icon-btn--danger" onClick={e => { e.stopPropagation(); deleteTrack(track.id); }} title="מחיקה">
                          <Trash2 size={14} />
                        </button>
                        {expandedTrack === track.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </div>
                    {expandedTrack === track.id && (
                      <div className="track-requirements-preview">
                        {track.description && (
                          <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{track.description}</p>
                        )}
                        {(track.requirements || []).length === 0 ? (
                          <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>אין דרישות מוגדרות</p>
                        ) : (
                          <div className="req-preview-list">
                            {track.requirements.map(req => (
                              <div key={req.id} className="req-preview-item">
                                <span className={`req-type-badge req-type--${req.type}`}>
                                  {REQUIREMENT_TYPES.find(t => t.id === req.type)?.label || req.type}
                                </span>
                                <span>{req.name}</span>
                                {req.units && <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{req.units} יח״ל</span>}
                                {!req.required && <span style={{ color: '#f59e0b', fontSize: '0.72rem' }}>אופציונלי</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Track Edit Form */
            <>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditingTrack(null)}>
                  <X size={14} />
                  חזרה לרשימה
                </button>
                <h4 style={{ margin: 0, fontSize: '1rem' }}>
                  {editingTrack === 'new' ? 'מגמה חדשה' : 'עריכת מגמה'}
                </h4>
              </div>

              <div className="student-form-grid">
                <div className="form-group">
                  <label>שם המגמה *</label>
                  <input
                    value={trackForm.name}
                    onChange={e => setTrackForm(p => ({ ...p, name: e.target.value }))}
                    placeholder='לדוגמה: "אוטוטרוניקה", "מדעי המחשב"'
                    required
                  />
                </div>
                <div className="form-group">
                  <label>מסלול</label>
                  <select
                    value={trackForm.programType}
                    onChange={e => setTrackForm(p => ({ ...p, programType: e.target.value }))}
                  >
                    <option value="">בחר מסלול...</option>
                    {PROGRAM_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>תיאור המגמה</label>
                <textarea
                  value={trackForm.description}
                  onChange={e => setTrackForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="תיאור קצר של המגמה ומטרותיה..."
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Requirements */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.92rem' }}>דרישות המגמה ({trackForm.requirements.length})</h4>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowReqForm(!showReqForm)}
                  >
                    <Plus size={13} />
                    הוסף דרישה
                  </button>
                </div>

                {showReqForm && (
                  <div className="req-add-form">
                    <div className="student-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <div className="form-group">
                        <label>שם הדרישה *</label>
                        <input
                          value={newReq.name}
                          onChange={e => setNewReq(p => ({ ...p, name: e.target.value }))}
                          placeholder='לדוגמה: "מבחן גמר בלשון"'
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRequirement(); } }}
                        />
                      </div>
                      <div className="form-group">
                        <label>סוג</label>
                        <select value={newReq.type} onChange={e => setNewReq(p => ({ ...p, type: e.target.value }))}>
                          {REQUIREMENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>יחידות לימוד</label>
                        <input
                          value={newReq.units}
                          onChange={e => setNewReq(p => ({ ...p, units: e.target.value }))}
                          placeholder='לדוגמה: "3"'
                          dir="ltr"
                        />
                      </div>
                      <div className="form-group" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
                        <label>חובה</label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.3rem' }}>
                          <input
                            type="checkbox"
                            checked={newReq.required}
                            onChange={e => setNewReq(p => ({ ...p, required: e.target.checked }))}
                          />
                          דרישה חובה
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>הסבר / הערה</label>
                      <input
                        value={newReq.description}
                        onChange={e => setNewReq(p => ({ ...p, description: e.target.value }))}
                        placeholder="הסבר נוסף לדרישה..."
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={addRequirement}>הוספה</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowReqForm(false); setNewReq(EMPTY_REQ); }}>ביטול</button>
                    </div>
                  </div>
                )}

                <div className="req-list">
                  {trackForm.requirements.length === 0 && (
                    <p style={{ color: '#94a3b8', fontSize: '0.82rem', textAlign: 'center', padding: '1rem' }}>
                      אין דרישות עדיין — הוסף דרישות למגמה
                    </p>
                  )}
                  {trackForm.requirements.map((req, idx) => (
                    <div key={req.id} className="req-edit-item">
                      <div className="req-edit-left">
                        <span className="req-num">{idx + 1}</span>
                        <div>
                          <input
                            className="req-name-input"
                            value={req.name}
                            onChange={e => updateRequirement(req.id, 'name', e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                            <select
                              value={req.type}
                              onChange={e => updateRequirement(req.id, 'type', e.target.value)}
                              style={{ fontSize: '0.75rem', padding: '0.15rem 0.3rem', border: '1px solid #e2e8f0', borderRadius: 4 }}
                            >
                              {REQUIREMENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </select>
                            <input
                              value={req.units || ''}
                              onChange={e => updateRequirement(req.id, 'units', e.target.value)}
                              placeholder="יח׳"
                              dir="ltr"
                              style={{ width: 50, fontSize: '0.75rem', padding: '0.15rem 0.3rem', border: '1px solid #e2e8f0', borderRadius: 4 }}
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}>
                              <input
                                type="checkbox"
                                checked={!!req.required}
                                onChange={e => updateRequirement(req.id, 'required', e.target.checked)}
                              />
                              חובה
                            </label>
                          </div>
                          {req.description && (
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{req.description}</span>
                          )}
                        </div>
                      </div>
                      <button className="icon-btn icon-btn--danger" onClick={() => removeRequirement(req.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button className="btn btn-primary" onClick={saveTrack} disabled={!trackForm.name.trim()}>
                  <Save size={15} />
                  שמירה
                </button>
                <button className="btn btn-secondary" onClick={() => setEditingTrack(null)}>ביטול</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
