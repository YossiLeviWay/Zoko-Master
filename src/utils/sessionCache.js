import { useCallback, useState } from 'react';
import { subscribePrivateSession } from './browserPrivacy.js';

// What a page last showed, kept in RAM for the open tab only. A page that is opened again starts
// from these values in its very first frame (and its listeners then keep them current), instead of
// starting empty and filling in. Nothing is written to disk, and the cache is emptied whenever the
// private session changes (logout, another school).
const cache = new Map();
subscribePrivateSession(() => cache.clear());

export const hasSessionValue = key => cache.has(key);
export const readSessionValue = (key, fallback) => (cache.has(key) ? cache.get(key) : fallback);
export const writeSessionValue = (key, value) => { cache.set(key, value); };

// useState whose value survives leaving the page and coming back. A key with an empty part
// (for example before the school is known) is not cached.
export function useSessionState(key, initial) {
  const usable = Boolean(key) && !/(^|:)(undefined|null|)(:|$)/u.test(key);
  const [state, setState] = useState(() => (usable ? readSessionValue(key, initial) : initial));
  const set = useCallback(next => setState(previous => {
    const value = typeof next === 'function' ? next(previous) : next;
    if (usable) cache.set(key, value);
    return value;
  }), [key, usable]);
  return [state, set];
}
