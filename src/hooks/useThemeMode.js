import { useState, useEffect, useCallback } from 'react';

export function useThemeMode() {
  const [mode, setMode] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('zoko-master-theme');
        return ['light', 'candlelight'].includes(saved) ? saved : 'light';
      } catch { return 'light'; }
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('zoko-master-theme', mode); } catch { /* The theme still works in memory. */ }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode(prev => prev === 'light' ? 'candlelight' : 'light');
  }, []);

  return { mode, toggle };
}
