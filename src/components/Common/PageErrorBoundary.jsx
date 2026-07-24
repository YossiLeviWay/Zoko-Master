import { Component } from 'react';

export default class PageErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Do not log user data or Firebase payloads. The visible recovery state is
    // sufficient until a privacy-safe error reporting service is configured.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="page"><div className="page-content"><div className="empty-state" role="alert"><h2>לא ניתן להציג את הדף</h2><p>אירעה שגיאה בתצוגה. ניתן לרענן את הדף בלי לאבד מידע שנשמר.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>רענון הדף</button></div></div></div>;
  }
}
