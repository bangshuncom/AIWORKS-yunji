// UI 状态（Zustand）：主题、视图模式，localStorage 持久化
import { create } from 'zustand';

export type ViewMode = 'masonry' | 'card-v' | 'card-h' | 'table';

interface UIStore {
  theme: 'light' | 'dark';
  viewMode: ViewMode;
  toggleTheme: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  setViewMode: (mode: ViewMode) => void;
}

const STORAGE_KEY = 'yunji-ui';

function load(): Partial<Pick<UIStore, 'theme' | 'viewMode'>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(state: Partial<Pick<UIStore, 'theme' | 'viewMode'>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const persisted = load();

export const useUIStore = create<UIStore>((set) => ({
  theme: persisted.theme ?? 'light',
  viewMode: persisted.viewMode ?? 'masonry',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light';
      save({ theme: next, viewMode: s.viewMode });
      return { theme: next };
    }),
  setTheme: (t) => {
    set({ theme: t });
    save({ theme: t });
  },
  setViewMode: (mode) => {
    set({ viewMode: mode });
    save({ viewMode: mode });
  },
}));
