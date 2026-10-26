import { create } from 'zustand';
import type { CategoryInfo, EngineState, Queue, Settings, WhenDoneAction } from '../../../shared/protocol';
import { api } from '../api/client';

/** Engine-owned configuration: settings, queues and the category list. */
interface EngineConfigState {
  settings: Settings | null;
  queues: Queue[];
  categories: CategoryInfo[];
  version: string;
  /** A when-done countdown in progress (the action runs at `at`). */
  whenDone: { action: WhenDoneAction; at: number } | null;
  load(s: EngineState): void;
  setWhenDone(w: { action: WhenDoneAction; at: number } | null): void;
  setSettings(s: Settings): void;
  setQueues(q: Queue[]): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

export const useEngine = create<EngineConfigState>((set) => ({
  settings: null,
  queues: [],
  categories: [],
  version: '',
  whenDone: null,
  load(s) {
    set({ settings: s.settings, queues: s.queues, categories: s.categories, version: s.version, whenDone: s.whenDone ?? null });
  },
  setWhenDone(whenDone) {
    set({ whenDone });
  },
  setSettings(settings) {
    set({ settings });
  },
  setQueues(queues) {
    set({ queues });
  },
  async updateSettings(patch) {
    const settings = await api.updateSettings(patch);
    set({ settings });
  },
}));

export function useSettings<T>(pick: (s: Settings) => T, fallback: T): T {
  return useEngine((s) => (s.settings ? pick(s.settings) : fallback));
}
