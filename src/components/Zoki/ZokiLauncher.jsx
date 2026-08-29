import { Component, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import zokiAvatar from '../../assets/zoki-avatar-minimal.svg';
import ZokiPage from './ZokiPage.jsx';
import './Zoki.css';

class ZokiPanelErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Keep failures private: the recovery view does not expose user or school data.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="zoki-floating-layer">
      <section className="zoki-window zoki-window-error" role="alert" aria-label="שגיאה בפתיחת העוזר">
        <img src={zokiAvatar} alt="" />
        <h2>לא הצלחתי להיפתח כרגע</h2>
        <p>האפליקציה נשארה פעילה. אפשר לנסות שוב או למזער את החלון.</p>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ failed: false })}>ניסיון נוסף</button>
          <button type="button" className="btn btn-secondary" onClick={this.props.onClose}>מזעור</button>
        </div>
      </section>
    </div>;
  }
}

export default function ZokiLauncher() {
  const { userData, selectedSchool, isPending, isPlatformAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (isPlatformAdmin() || isPending() || !(selectedSchool || userData?.schoolId)) return null;
  return <>
    {open && <ZokiPanelErrorBoundary onClose={() => setOpen(false)}><ZokiPage embedded onMinimize={() => setOpen(false)} /></ZokiPanelErrorBoundary>}
    {!open && <button type="button" className="zoki-launcher" onClick={() => setOpen(true)} aria-label="פתיחת העוזר" title="פתיחת העוזר">
      <img src={zokiAvatar} alt="" />
    </button>}
  </>;
}
