import { useState, useEffect, useCallback } from 'react';

export function useScrollProgress(ref) {
  const [progress, setProgress] = useState(0);

  const handleScroll = useCallback(() => {
    const el = ref?.current || document.documentElement;
    const scrollTop = el === document.documentElement
      ? window.scrollY
      : el.scrollTop;
    const scrollHeight = el.scrollHeight - el.clientHeight;
    if (scrollHeight > 0) {
      setProgress(Math.min(1, Math.max(0, scrollTop / scrollHeight)));
    }
  }, [ref]);

  useEffect(() => {
    const target = ref?.current || window;
    target.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => target.removeEventListener('scroll', handleScroll);
  }, [ref, handleScroll]);

  return progress;
}
