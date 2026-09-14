import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}
// Only structured error categories are inspected; never expose provider messages or details.
export function codexFailureCode(error) {
  const info = error?.codexErrorInfo;
  const kind = (typeof info === 'string' ? info : Object.keys(info || {})[0] || '').toLowerCase();
  if (kind === 'usagelimitexceeded') return 'codex-usage-limit';
  if (kind === 'contextwindowexceeded') return 'codex-context-limit';
  if (kind === 'unauthorized') return 'codex-login-required';
  if (['httpconnectionfailed', 'responsestreamconnectionfailed', 'responsestreamdisconnected', 'responsetoomanyfailedattempts'].includes(kind)) return 'codex-connection-failed';
  return 'codex-turn-failed';
}
const disabled = ['analytics.enabled', 'features.shell_tool', 'features.unified_exec', 'features.apps', 'features.plugins', 'features.hooks', 'features.memories', 'features.browser_use', 'features.browser_use_external', 'features.in_app_browser', 'features.shell_snapshot', 'features.remote_plugin', 'features.tool_suggest'];
export const privacyConfig = Object.freeze({ ...Object.fromEntries(disabled.map(key => [key, false])), 'history.persistence': 'none', 'otel.log_user_prompt': false, 'otel.exporter': 'none', 'otel.trace_exporter': 'none', 'otel.metrics_exporter': 'none', notify: [], web_search: 'disabled' });

// Protocol traffic is intentionally never logged. The child retains its own
// supported account authentication; no credential files are read or copied.
export class CodexPilotClient {
  constructor({ cwd, executable = process.env.ZOKO_CODEX_BIN || (process.platform === 'darwin' && existsSync('/Applications/ChatGPT.app/Contents/Resources/codex') ? '/Applications/ChatGPT.app/Contents/Resources/codex' : 'codex'), spawnProcess = spawn, timeoutMs = 480000 } = {}) {
    this.cwd = cwd; this.pending = new Map(); this.sequence = 0; this.timeoutMs = timeoutMs;
    const args = ['app-server', '--stdio', ...Object.entries(privacyConfig).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
    this.process = spawnProcess(executable, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, RUST_LOG: 'off' } });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new PilotError('codex-request-failed')); else pending.resolve(message.result);
      } else if (message.id != null) {
        // No server request may authorize a write, shell, plugin or UI action.
        this.send({ id: message.id, error: { code: -32601, message: 'Tool execution is not available in this session' } });
      } else if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
        this.answer = message.params.item.text;
      } else if (message.method === 'turn/completed' && this.turn) {
        const turn = this.turn; this.turn = null; clearTimeout(turn.timer);
        if (message.params?.turn?.status === 'completed') turn.resolve(this.answer || '');
        else turn.reject(new PilotError(codexFailureCode(message.params?.turn?.error)));
      }
    });
    this.process.on('error', () => this.fail('codex-not-installed'));
    this.process.on('exit', () => this.fail('codex-disconnected'));
  }
  send(message) { if (!this.process.stdin.destroyed) this.process.stdin.write(`${JSON.stringify(message)}\n`); }
  fail(code) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new PilotError(code)); }
    this.pending.clear();
    if (this.turn) { clearTimeout(this.turn.timer); this.turn.reject(new PilotError(code)); this.turn = null; }
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new PilotError('codex-timeout')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.call('initialize', { clientInfo: { name: 'zoko_local_pilot', title: 'Zoki local pilot', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
    const result = await this.call('account/read', { refreshToken: false });
    this.authenticated = result.account?.type === 'chatgpt';
    return { authenticated: this.authenticated, authType: this.authenticated ? 'chatgpt' : null };
  }
  async generate({ text, images = [], instructions = 'Reply in Hebrew. You may analyze supplied data but cannot execute actions.' }) {
    if (!this.authenticated) throw new PilotError('codex-login-required');
    if (this.turn) throw new PilotError('codex-busy');
    const configuration = await this.call('config/read', { includeLayers: false });
    const settings = configuration.config || {};
    for (const value of [settings.openai_base_url, settings.model_providers?.openai?.base_url]) if (value) {
      let url; try { url = new URL(value); } catch { throw new PilotError('codex-provider-not-supported'); }
      if (url.protocol !== 'https:' || !['api.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new PilotError('codex-provider-not-supported');
    }
    const mcp = Object.keys(settings.mcp_servers || {});
    const config = { ...privacyConfig, ...Object.fromEntries(mcp.map(id => [`mcp_servers.${id}.enabled`, false])) };
    const { thread } = await this.call('thread/start', { cwd: this.cwd, modelProvider: 'openai', ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', multiAgentMode: 'explicitRequestOnly', config, baseInstructions: instructions });
    if (!thread?.ephemeral) throw new PilotError('codex-privacy-unavailable');
    this.threadId = thread.id; this.answer = '';
    const completion = new Promise((resolve, reject) => {
      this.turn = { resolve, reject, timer: setTimeout(() => { this.fail('codex-timeout'); this.process.kill(); }, this.timeoutMs) };
    });
    // Attach rejection before starting the turn, including immediate process exits.
    completion.catch(() => {});
    try {
      await this.call('turn/start', { threadId: thread.id, input: [{ type: 'text', text }, ...images.map(url => ({ type: 'image', url }))] });
      return await completion;
    } finally { if (this.turn) this.fail('codex-turn-cancelled'); this.threadId = null; }
  }
  interrupt() {
    // Terminating this dedicated process also disposes every ephemeral thread.
    this.fail('codex-turn-cancelled'); this.process.kill();
  }
  close() { this.interrupt(); this.lines.close(); }
}
