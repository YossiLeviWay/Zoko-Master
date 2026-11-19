import { AlertTriangle } from 'lucide-react';
import { missingStudentInfo } from '../../utils/studentInfo';
import './MissingInfoMark.css';

// A small triangle next to a student's name when the student card is incomplete.
export default function MissingInfoMark({ student }) {
  const missing = missingStudentInfo(student);
  if (!missing.length) return null;
  const text = `חסר מידע: ${missing.join(', ')}`;
  return <span className="missing-info" role="img" aria-label={text} title={text}><AlertTriangle size={14} aria-hidden="true" /></span>;
}
