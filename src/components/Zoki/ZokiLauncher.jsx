import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import zokiAvatar from '../../assets/zoki-avatar-minimal.svg';
import './Zoki.css';

export default function ZokiLauncher() {
  const { userData, selectedSchool, isPending, isPlatformAdmin } = useAuth();
  if (isPlatformAdmin() || isPending() || !(selectedSchool || userData?.schoolId)) return null;
  return <NavLink className="zoki-launcher" to="/zoki" aria-label="פתיחת זוקי" title="שאלו את זוקי">
    <img src={zokiAvatar} alt="" />
    <span>זוקי</span>
  </NavLink>;
}
