import { useSyncExternalStore } from "react";
import { stationStore } from "./station";
import type { StationState } from "./seed";

export function useStation(): StationState {
  return useSyncExternalStore(stationStore.subscribe, stationStore.getState);
}

export function newClientToken(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `tok-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
