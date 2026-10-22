import type { EngineEvent } from '../../../shared/protocol';
import { getPlatform } from '../platform';
import { useUi } from '../store/ui';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * One WebSocket to the engine, reconnecting with backoff. Every (re)connect calls `onOpen` first, so the caller can
 * reload the full state and never miss events that happened while it was away.
 */
export function connectEvents(onEvent: (e: EngineEvent) => void, onOpen: () => Promise<void>): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const setStatus = (s: WsStatus) => useUi.getState().setWsStatus(s);

  const open = () => {
    const { engineUrl, token } = getPlatform();
    const url = `${engineUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);
    ws.onopen = async () => {
      delay = 500;
      setStatus('open');
      await onOpen().catch(() => undefined);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as EngineEvent);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      setStatus('reconnecting');
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 5000);
    };
  };

  setStatus('connecting');
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
    setStatus('closed');
  };
}
