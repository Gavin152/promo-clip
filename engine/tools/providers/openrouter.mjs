// OpenRouter REST client: TTS, STT, chat (judge), images and music all go through one key.
// Key: OPENROUTER_API_KEY from the environment, else from .env in the video folder or a parent.
// The key is never logged, written to promo.json, or embedded in a bundle.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const BASE = process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1';
const RETRY_DELAYS = [1000, 2000, 4000];

export class ProviderError extends Error {
  constructor(msg, { status, policy = false, retryable = false } = {}) {
    super(msg);
    this.name = 'ProviderError';
    this.status = status;
    this.policy = policy; // blocked by account policy (ZDR, data policy, region…): try the next model
    this.retryable = retryable;
  }
}

/** reads KEY=value from .env files at/above dir (nearest wins); env vars override */
export function loadKey(project = process.cwd()) {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  let d = resolve(project);
  for (;;) {
    const f = join(d, '.env');
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/^\s*OPENROUTER_API_KEY\s*=\s*(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  throw new ProviderError('OPENROUTER_API_KEY not set: put OPENROUTER_API_KEY=… in the video folder\'s .env (gitignored) or export it in your shell');
}

/** policy / data-retention blocks: the request can never succeed with this model on this account */
export function isPolicyBlock(status, body) {
  return [400, 403, 404].includes(status) && /zero data retention|\bzdr\b|data policy|no endpoints found|not available in your region|guardrail|privacy settings/i.test(body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client({ project, title = 'promo-clip', key, fetchImpl = fetch, delays = RETRY_DELAYS } = {}) {
  let KEY = key;
  const headers = () => {
    KEY ??= loadKey(project);
    return { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/promo-clip', 'X-Title': title };
  };

  /** POST with exponential backoff on 429 / 5xx / network errors; policy blocks throw immediately */
  async function post(path, body, { timeout = Number(process.env.OR_TIMEOUT ?? 600000) } = {}) {
    let last;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const r = await fetchImpl(BASE + path, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
        if (r.ok) return r;
        const text = (await r.text()).slice(0, 800);
        if (isPolicyBlock(r.status, text)) throw new ProviderError(`${body.model}: blocked by account policy (${r.status}): ${text}`, { status: r.status, policy: true });
        const retryable = r.status === 429 || r.status >= 500;
        last = new ProviderError(`${path} ${body.model ?? ''} ${r.status}: ${text}`, { status: r.status, retryable });
        if (!retryable) throw last;
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw e;
        last = e instanceof ProviderError ? e : new ProviderError(`${path}: ${e.message}`, { retryable: true });
      }
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
    throw last;
  }

  /** text -> audio Buffer. body: {model, voice, input, response_format} */
  async function tts(body) {
    const r = await post('/audio/speech', { response_format: 'pcm', ...body });
    return { audio: Buffer.from(await r.arrayBuffer()), id: r.headers.get('x-generation-id') };
  }

  /** audio Buffer -> verbose transcript with word timestamps */
  async function stt(buf, format, model, extra = {}) {
    const r = await post('/audio/transcriptions', {
      model,
      input_audio: { data: buf.toString('base64'), format },
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word'],
      ...extra,
    });
    const j = await r.json();
    return { ...j, id: r.headers.get('x-generation-id') ?? j.id };
  }

  /** chat completion (non-streaming), usage accounting on so the reply carries its cost */
  async function chat(body) {
    const r = await post('/chat/completions', { usage: { include: true }, ...body });
    return r.json();
  }

  /** streaming chat completion; collects text + base64 audio chunks (music) + images + final usage */
  async function chatStream(body, onChunk) {
    const r = await post('/chat/completions', { usage: { include: true }, ...body, stream: true });
    const dec = new TextDecoder();
    let buf = '', text = '', usage = null, id = null;
    const audio = [], images = [];
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        id ??= j.id;
        if (j.usage) usage = j.usage;
        const d = j.choices?.[0]?.delta ?? {};
        if (d.content) text += d.content;
        if (d.audio?.data) audio.push(d.audio.data);
        if (d.audio?.transcript) text += d.audio.transcript;
        for (const im of d.images ?? []) images.push(im.image_url?.url ?? im.url);
        onChunk?.(j);
      }
    }
    return { text, audio: audio.length ? Buffer.concat(audio.map((a) => Buffer.from(a, 'base64'))) : null, images, usage, id };
  }

  /** generation stats (actual cost) by id; OpenRouter may need a moment to have them */
  async function generation(id, tries = 3) {
    if (!id) return null;
    for (let i = 0; i < tries; i++) {
      const r = await fetchImpl(`${BASE}/generation?id=${encodeURIComponent(id)}`, { headers: headers() });
      if (r.ok) return (await r.json()).data;
      await sleep(1500 * (i + 1));
    }
    return null;
  }

  /** actual USD cost of a reply: usage.cost, else generation stats; null if unknown */
  async function actualCost(reply) {
    const c = reply?.usage?.cost;
    if (typeof c === 'number') return c;
    const g = await generation(reply?.id);
    return typeof g?.total_cost === 'number' ? g.total_cost : null;
  }

  async function credits() {
    const r = await fetchImpl(`${BASE}/credits`, { headers: headers() });
    return r.ok ? (await r.json()).data : null;
  }

  return { post, tts, stt, chat, chatStream, generation, actualCost, credits };
}

/**
 * runs fn(model) over a model chain; a policy block (or a model-not-found) moves to the next model,
 * any other error stops. Returns { model, result, skipped: [{model, error}] }.
 */
export async function withFallback(models, fn, { log = console.warn } = {}) {
  const skipped = [];
  for (const model of models) {
    try {
      return { model, result: await fn(model), skipped };
    } catch (e) {
      if (e instanceof ProviderError && e.policy) {
        skipped.push({ model, error: e.message });
        log(`${model} is blocked for this account; trying the next fallback`);
        continue;
      }
      throw e;
    }
  }
  throw new ProviderError(`every model was blocked: ${skipped.map((s) => s.model).join(', ')}. ${skipped.at(-1)?.error ?? ''}`, { policy: true });
}
