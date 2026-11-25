// Parses "event: token / data: <JSON string>" frames and reports the growing text.
export async function readTokenStream(response, onToken) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const event = /^event:\s*(\w+)/mu.exec(frame)?.[1];
      const data = /^data:\s*(.*)$/mu.exec(frame)?.[1];
      if (event !== 'token' || data === undefined) continue;
      try { text += JSON.parse(data); } catch { text += data; }
      onToken(text);
    }
  }
  return { reply: text.trim(), proposals: [], agent: '' };
}
