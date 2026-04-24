import { useState } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import {
  X, Edit3, GraduationCap, Phone, CheckCircle2,
  Circle, AlertCircle, BookOpen, MessageSquare, Plus, Trash2
} from 'lucide-react';

const PROGRAM_LABELS = {
  full_matriculation: 'בגרות מלאה',
  tech_matriculation: 'בגרות טכנולוגית',
  professional_cert: 'תעודת מקצוע',
  completion_cert: 'תעודת גמר',
};

const STATUS_OPTIONS = [
  { id: 'pending', label: 'טרם הושלם', icon: Circle, color: '#94a3b8' },
  { id: 'in_progress', label: 'בתהליך', icon: AlertCircle, color: '#f59e0b' },
  { id: 'done', label: 'הושלם', icon: CheckCircle2, color: '#22c55e' },
];

export default function StudentProfile({ student, tracks, schoolId, canEdit, onClose, onEdit }) {
  const track = tracks.find(t => t.id === student.trackId);
  const requirements = track?.requirements || [];

  const [reqStatus, setReqStatus] = useState(student.requirementStatus || {});
  const [subjStatus, setSubjStatus] = useState(
    (student.additionalSubjects || []).reduce((acc, s, i) => {
      acc[i] = s.status || 'pending';
      return acc;
    }, {})
  );
  const [notes, setNotes] = useState(student.notes || '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [recommendations, setRecommendations] = useState(student.recommendations || []);
  const [showRecommendationForm, setShowRecommendationForm] = useState(false);

  const done = requirements.filter(r => reqStatus[r.id] === 'done').length;
  const inProgress = requirements.filter(r => reqStatus[r.id] === 'in_progress').length;
  const pct = requirements.length > 0 ? Math.round((done / requirements.length) * 100) : 0;

  async function toggleReqStatus(reqId) {
    if (!canEdit) return;
    const current = reqStatus[reqId] || 'pending';
    const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
    const updated = { ...reqStatus, [reqId]: next };
    setReqStatus(updated);
    try {
      await updateDoc(doc(db, `students_${schoolId}`, student.id), {
        requirementStatus: updated,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error updating requirement status:', err);
    }
  }

  async function toggleSubjStatus(index) {
    if (!canEdit) return;
    const current = subjStatus[index] || 'pending';
    const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
    const updated = { ...subjStatus, [index]: next };
    setSubjStatus(updated);
    const updatedSubjects = (student.additionalSubjects || []).map((s, i) =>
      i === index ? { ...s, status: next } : s
    );
    try {
      await updateDoc(doc(db, `students_${schoolId}`, student.id), {
        additionalSubjects: updatedSubjects,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error updating subject status:', err);
    }
  }

  async function saveNotes() {
    setSaving(true);
    try {
      await updateDoc(doc(db, `students_${schoolId}`, student.id), {
        notes,
        updatedAt: new Date().toISOString(),
      });
      setEditingNotes(false);
    } catch (err) {
      console.error('Error saving notes:', err);
    }
    setSaving(false);
  }

  async function addRecommendation() {
    if (!newNote.trim()) return;
    const rec = {
      text: newNote.trim(),
      date: new Date().toLocaleDateString('he-IL'),
    };
    const updated = [...recommendations, rec];
    setRecommendations(updated);
    setNewNote('');
    setShowRecommendationForm(false);
    try {
      await updateDoc(doc(db, `students_${schoolId}`, student.id), {
        recommendations: updated,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error saving recommendation:', err);
    }
  }

  async function removeRecommendation(index) {
    const updated = recommendations.filter((_, i) => i !== index);
    setRecommendations(updated);
    try {
      await updateDoc(doc(db, `students_${schoolId}`, student.id), {
        recommendations: updated,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error removing recommendation:', err);
    }
  }

  function getStatusIcon(statusId) {
    const opt = STATUS_OPTIONS.find(s => s.id === statusId) || STATUS_OPTIONS[0];
    const Icon = opt.icon;
    return <Icon size={16} color={opt.color} />;
  }

  function getStatusLabel(statusId) {
    return STATUS_OPTIONS.find(s => s.id === statusId)?.label || 'טרם הושלם';
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-content--wide"
        style={{ maxWidth: 680 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="student-profile-avatar">{student.fullName?.charAt(0) || '?'}</div>
            <div>
              <h3 style={{ margin: 0 }}>{student.fullName}</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                {student.className} • {student.gradeLevel}
                {student.idNumber && ` • ת.ז. ${student.idNumber}`}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {canEdit && (
              <button className="icon-btn" title="עריכה" onClick={onEdit}>
                <Edit3 size={16} />
              </button>
            )}
            <button className="modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="modal-form" style={{ padding: '0 1.5rem 1.5rem' }}>
          {/* Program & Track */}
          <div className="student-profile-section">
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {student.programType && (
                <div className="student-info-chip">
                  <GraduationCap size={14} />
                  <span>{PROGRAM_LABELS[student.programType] || student.programType}</span>
                </div>
              )}
              {track && (
                <div className="student-info-chip">
                  <BookOpen size={14} />
                  <span>{track.name}</span>
                </div>
              )}
              {student.phone && (
                <div className="student-info-chip">
                  <Phone size={14} />
                  <span dir="ltr">{student.phone}</span>
                </div>
              )}
              {student.parentPhone && (
                <div className="student-info-chip">
                  <Phone size={14} />
                  <span dir="ltr">{student.parentPhone} (הורה)</span>
                </div>
              )}
            </div>
          </div>

          {/* Progress Summary */}
          {requirements.length > 0 && (
            <div className="student-profile-section">
              <h4 className="student-profile-section-title">התקדמות במסלול</h4>
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div className="student-progress-bar" style={{ height: 10 }}>
                    <div
                      className="student-progress-fill"
                      style={{
                        width: `${pct}%`,
                        background: pct === 100 ? '#22c55e' : pct > 50 ? '#3b82f6' : '#f59e0b',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.82rem' }}>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>{done} הושלמו</span>
                  {inProgress > 0 && <span style={{ color: '#f59e0b', fontWeight: 600 }}>{inProgress} בתהליך</span>}
                  <span style={{ color: '#94a3b8' }}>{requirements.length - done - inProgress} נותרו</span>
                </div>
              </div>
            </div>
          )}

          {/* Requirements Checklist */}
          {requirements.length > 0 && (
            <div className="student-profile-section">
              <h4 className="student-profile-section-title">דרישות המגמה — {track?.name}</h4>
              <div className="req-checklist">
                {requirements.map(req => {
                  const status = reqStatus[req.id] || 'pending';
                  return (
                    <div
                      key={req.id}
                      className={`req-checklist-item req-status--${status} ${canEdit ? 'req-checklist-item--clickable' : ''}`}
                      onClick={() => toggleReqStatus(req.id)}
                      title={canEdit ? `לחץ לשינוי סטטוס: ${getStatusLabel(status)}` : getStatusLabel(status)}
                    >
                      {getStatusIcon(status)}
                      <div style={{ flex: 1 }}>
                        <span className="req-checklist-name">{req.name}</span>
                        {req.units && <span className="req-checklist-units"> • {req.units} יח״ל</span>}
                        {!req.required && <span className="req-optional-badge">אופציונלי</span>}
                        {req.description && (
                          <p className="req-checklist-desc">{req.description}</p>
                        )}
                      </div>
                      <span className="req-status-label">{getStatusLabel(status)}</span>
                    </div>
                  );
                })}
              </div>
              {canEdit && (
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                  לחץ על דרישה כדי לשנות את הסטטוס: טרם הושלם → בתהליך → הושלם
                </p>
              )}
            </div>
          )}

          {/* Additional Subjects */}
          {(student.additionalSubjects || []).length > 0 && (
            <div className="student-profile-section">
              <h4 className="student-profile-section-title">מקצועות נוספים</h4>
              <div className="req-checklist">
                {(student.additionalSubjects || []).map((subj, i) => {
                  const status = subjStatus[i] || 'pending';
                  return (
                    <div
                      key={i}
                      className={`req-checklist-item req-status--${status} ${canEdit ? 'req-checklist-item--clickable' : ''}`}
                      onClick={() => toggleSubjStatus(i)}
                    >
                      {getStatusIcon(status)}
                      <span className="req-checklist-name">{subj.name}</span>
                      <span className="req-status-label">{getStatusLabel(status)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="student-profile-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <h4 className="student-profile-section-title" style={{ margin: 0 }}>הערות</h4>
              {canEdit && !editingNotes && (
                <button className="icon-btn" style={{ padding: '0.1rem' }} onClick={() => setEditingNotes(true)}>
                  <Edit3 size={13} />
                </button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="הערות, מידע נוסף על התלמיד..."
                />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveNotes} disabled={saving}>
                    {saving ? 'שומר...' : 'שמירה'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setNotes(student.notes || ''); setEditingNotes(false); }}>
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ color: notes ? '#1e293b' : '#94a3b8', fontSize: '0.85rem', whiteSpace: 'pre-line', margin: 0 }}>
                {notes || 'אין הערות'}
              </p>
            )}
          </div>

          {/* Recommendations */}
          <div className="student-profile-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <h4 className="student-profile-section-title" style={{ margin: 0 }}>המלצות ומשוב</h4>
              {canEdit && (
                <button className="icon-btn" style={{ padding: '0.1rem' }} onClick={() => setShowRecommendationForm(!showRecommendationForm)}>
                  <Plus size={13} />
                </button>
              )}
            </div>
            {showRecommendationForm && (
              <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.4rem' }}>
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="הוסף המלצה או משוב..."
                  rows={2}
                  style={{ flex: 1, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <button className="btn btn-primary btn-sm" onClick={addRecommendation}>הוסף</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setShowRecommendationForm(false); setNewNote(''); }}>ביטול</button>
                </div>
              </div>
            )}
            {recommendations.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.82rem' }}>אין המלצות עדיין</p>
            ) : (
              <div className="recommendations-list">
                {recommendations.map((rec, i) => (
                  <div key={i} className="recommendation-item">
                    <MessageSquare size={13} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: '0.83rem' }}>{rec.text}</p>
                      {rec.date && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{rec.date}</span>}
                    </div>
                    {canEdit && (
                      <button className="icon-btn icon-btn--danger" style={{ padding: '0.1rem' }} onClick={() => removeRecommendation(i)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
