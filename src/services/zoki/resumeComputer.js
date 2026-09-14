// Only resume an already paired, online computer. Opening a consent popup must
// remain synchronous with an explicit user click, never an automatic effect.
export async function resumeComputer(relay, signal) {
  const check = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  check();
  const state = await relay.status();
  check();
  if (!state.connected) return null;
  return relay.request('connect', {}, signal);
}
