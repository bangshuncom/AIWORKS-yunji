// UI 状态（Zustand）：主题、视图模式、界面语言（本地覆盖），localStorage 持久化
import { create } from 'zustand';

export type ViewMode = 'masonry' | 'card-v' | 'card-h' | 'table';

interface UIStore {
  theme: 'light' | 'dark';
  viewMode: ViewMode;
  /**
   * 界面语言本地覆盖（双击 lang 文件改不了这里）：
   * - null ＝ 跟随全局默认（管理员在设置页设定）
   * - 具体 code ＝ 仅本机生效，优先级高于全局
   * 该项不参与 React Query 缓存，语言字典由 LanguageProvider 单独加载。
   */
  language: string | null;
  toggleTheme: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  setViewMode: (mode: ViewMode) => void;
  setLanguage: (lang: string | null) => void;
}

const STORAGE_KEY = 'yunji-ui';

interface Persisted {
  theme?: 'light' | 'dark';
  viewMode?: ViewMode;
  language?: string | null;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function save(state: Persisted) {
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
  language: persisted.language ?? null,
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light';
      save({ theme: next, viewMode: s.viewMode, language: s.language });
      return { theme: next };
    }),
  setTheme: (t) => {
    set({ theme: t });
    save({ theme: t, viewMode: persisted.viewMode, language: persisted.language });
  },
  setViewMode: (mode) => {
    set({ viewMode: mode });
    save({ viewMode: mode, language: persisted.language });
  },
  setLanguage: (lang) => {
    set({ language: lang });
    save({ theme: persisted.theme, viewMode: persisted.viewMode, language: lang });
  },
}));
