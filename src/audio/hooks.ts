import { useEffect, useState, useSyncExternalStore } from 'react';
import { engine, type EngineState, type LatencyInfo } from './engine';
import { player, type PlayerState } from './player';

export function useEngine<T = EngineState>(select?: (s: EngineState) => T): T {
  const s = useSyncExternalStore(engine.subscribe, engine.getState);
  return select ? select(s) : (s as unknown as T);
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState);
}

/** Polls a value on animation frames (for timers that must not re-render the whole tree). */
export function useFrameValue<T>(read: () => T, active: boolean, intervalMs = 100): T {
  const [v, setV] = useState(read);
  useEffect(() => {
    setV(read());
    if (!active) return;
    const id = setInterval(() => setV(read()), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs]);
  return v;
}

export function useLatency(active: boolean): LatencyInfo | null {
  return useFrameValue(() => engine.getLatency(), active, 1000);
}
