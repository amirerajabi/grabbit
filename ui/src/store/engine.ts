import { create } from 'zustand';
import type { CategoryInfo, EngineState, Queue, Settings } from '../../../shared/protocol';
import { api } from '../api/client';

/** Engine-owned configuration: settings, queues and the category list. */
interface EngineConfigState {
  settings: Settings | null;
  queues: Queue[];
  categories: CategoryInfo[];
  version: string;
  load(s: EngineState): void;
  setSettings(s: Settings): void;
  setQueues(q: Queue[]): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

export const useEngine = create<EngineConfigState>((set) => ({
  settings: null,
  queues: [],
  categories: [],
  version: '',
  load(s) {
    set({ settings: s.settings, queues: s.queues, categories: s.categories, version: s.version });
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
