import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export function useInkTransition() {
  const [state, setState] = useState({ active: false, cx: '50%', cy: '50%' });
  const pendingPath = useRef(null);
  const navigate = useNavigate();

  const trigger = useCallback((e, path) => {
    const rect = document.documentElement.getBoundingClientRect();
    const cx = ((e.clientX / window.innerWidth) * 100).toFixed(1) + '%';
    const cy = ((e.clientY / window.innerHeight) * 100).toFixed(1) + '%';

    pendingPath.current = path;
    setState({ active: true, cx, cy });

    setTimeout(() => {
      navigate(path);
      setState(prev => ({ ...prev, active: false }));
      pendingPath.current = null;
    }, 500);
  }, [navigate]);

  return { state, trigger };
}
