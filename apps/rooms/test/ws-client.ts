/**
 * A tiny WebSocket test client (Node 22's global WebSocket). Every frame it receives is validated
 * with the spike server schema, so a test fails if the server ever sends something off-protocol.
 */

import { type SpikeServerMessage, spikeServerMessageSchema } from '@stemdeck/protocol/spike';

export interface TestClient {
  ws: WebSocket;
  /** Every frame received so far, raw. */
  raw: string[];
  /** Every frame received so far, parsed. */
  received: SpikeServerMessage[];
  send(msg: unknown): void;
  sendRaw(data: string | ArrayBuffer): void;
  /** Resolves with the first message (received now or later, after `from`) that matches. */
  next<T extends SpikeServerMessage['t']>(
    t: T,
    match?: (m: Extract<SpikeServerMessage, { t: T }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<SpikeServerMessage, { t: T }>>;
  closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

export async function connect(url: string): Promise<TestClient> {
  const ws = new WebSocket(url);
  const raw: string[] = [];
  const received: SpikeServerMessage[] = [];
  const waiters = new Set<() => void>();
  let cursor = 0;

  ws.addEventListener('message', (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : '';
    raw.push(text);
    received.push(spikeServerMessageSchema.parse(JSON.parse(text)));
    for (const w of waiters) w();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', (ev) => {
      resolve({ code: ev.code, reason: ev.reason });
      for (const w of waiters) w();
    });
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), {
      once: true,
    });
  });

  const client: TestClient = {
    ws,
    raw,
    received,
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendRaw: (data) => ws.send(data),
    next(t, match, timeoutMs = 5000) {
      type M = Extract<SpikeServerMessage, { t: typeof t }>;
      return new Promise<M>((resolve, reject) => {
        const check = () => {
          while (cursor < received.length) {
            const m = received[cursor++] as SpikeServerMessage;
            if (m.t === t && (!match || match(m as M))) {
              cleanup();
              resolve(m as M);
              return;
            }
          }
          if (ws.readyState === WebSocket.CLOSED) {
            cleanup();
            reject(new Error(`socket closed while waiting for ${t}`));
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timed out waiting for ${t}; got ${JSON.stringify(received)}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    },
    closed,
    close: () => ws.close(),
  };
  return client;
}
