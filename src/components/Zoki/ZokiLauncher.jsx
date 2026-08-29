import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import zokiAvatar from '../../assets/zoki-avatar-minimal.svg';
import './Zoki.css';

const ZokiPage = lazy(() => import('./ZokiPage.jsx'));

export default function ZokiLauncher() {
  const { userData, selectedSchool, isPending, isPlatformAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (isPlatformAdmin() || isPending() || !(selectedSchool || userData?.schoolId)) return null;
  return <>
    {open && <Suspense fallback={<div className="zoki-floating-layer"><div className="zoki-window zoki-window-loading"><span className="loading-spinner" /></div></div>}><ZokiPage embedded onMinimize={() => setOpen(false)} /></Suspense>}
    {!open && <button type="button" className="zoki-launcher" onClick={() => setOpen(true)} aria-label="פתיחת העוזר" title="פתיחת העוזר">
      <img src={zokiAvatar} alt="" />
    </button>}
  </>;
}
