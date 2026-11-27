import { PhoneOff } from 'lucide-react';
import { hasNoContactPhone } from '../../utils/studentInfo';
import './MissingInfoMark.css';

// A quiet mark next to a student's name when there is no phone to reach the student or a parent.
// Other missing details (join date, track) are not flagged in lists: they are not an error.
export default function MissingInfoMark({ student }) {
  if (!hasNoContactPhone(student)) return null;
  const text = 'אין טלפון ליצירת קשר (תלמיד או הורה)';
  return <span className="missing-info" role="img" aria-label={text} title={text}><PhoneOff size={13} aria-hidden="true" /></span>;
}
