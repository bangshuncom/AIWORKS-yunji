// 多语言（i18n）前端核心：Provider + useLanguage + t()
//
// 完整设计见 docs/i18n-design.md。要点：
//   1. 字典由后端 get_language 返回（已按回退链合并，缺的条目用简体中文补齐），
//      前端只负责渲染，不在前端再维护一份完整翻译。
//   2. 首帧先用 BUILTIN_ZH_CN 这个极简内置兜底字典（覆盖 P1 使用到的 key），
//      异步拿到后端字典后整体替换，避免出现空白或闪烁。
//   3. 生效语言优先级：本地 localStorage 覆盖 ＞ 全局默认（管理员设定）＞ zh-CN。
//   4. 切换语言只换 Context 与 <html lang>，不失效任何 React Query 缓存（业务数据与语言无关）。

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';

/** 语言清单项（与后端 LangInfo 对应；字段名走 camelCase 以贴合前端习惯） */
export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  isSeed: boolean;
  total: number;
  missing: number;
  coverage: number;
  status: string;
  error?: string | null;
  warning?: string | null;
  path: string;
}

/**
 * 极简内置兜底字典。仅用于首帧异步加载前的瞬时兜底，覆盖 P1 阶段用到的高频 key。
 * 必须与仓库根 lang/zh-CN.json 中同名 key 的简体中文保持一致；新增 P1 key 时两边同步加。
 */
const BUILTIN_ZH_CN: Record<string, string> = {
  'app.name': '云记',
  'nav.all': '全部',
  'nav.collections': '合集',
  'nav.tags': '标签',
  'nav.authors': '作者',
  'nav.trash': '回收站',
  'nav.newArticle': '新建文章',
  'nav.categories': '分类管理',
  'nav.profile': '个人资料',
  'nav.settings': '系统设置',
  'nav.logout': '退出登录',
  'nav.login': '登录',
  'auth.login': '登录',
  'auth.noAccount': '还没有账户？',
  'auth.register': '注册',
  'auth.username': '用户名',
  'auth.password': '密码',
  'auth.loginFailed': '登录失败',
  'auth.loggingIn': '登录中...',
  'settings.title': '应用设置',
  'settings.tab.general': '常规设置',
  'settings.tab.list': '文章列表',
  'settings.tab.language': '语言',
  'settings.tab.users': '用户管理',
  'settings.tab.permissions': '权限管理',
  'settings.tab.proxy': '代理设置',
  'settings.tab.translate': '翻译设置',
  'settings.tab.cleanup': '附件清理',
  'settings.noAccess.title': '无权访问',
  'settings.noAccess.desc': '当前账户没有任何设置项的访问权限。',
  'settings.loading': '加载中...',
  'lang.title': '界面语言',
  'lang.desc': '语言包来自程序目录下的 lang 文件夹。',
  'lang.effective': '当前生效',
  'lang.globalDefault': '全局默认语言',
  'lang.personal': '我的界面语言',
  'lang.followGlobal': '跟随全局默认',
  'lang.coverage': '覆盖 {percent}%',
  'lang.missing': '缺 {count} 项',
  'lang.complete': '完整',
  'lang.invalid': '无法解析：{error}',
  'lang.refresh': '刷新',
  'lang.openFolder': '打开语言文件夹',
  'lang.folderPath': '语言目录：{path}',
  'lang.saved': '已保存',
  'lang.switchFailed': '切换失败：{error}',
  'lang.official': '内置',
  'lang.user': '自建',
  'common.save': '保存',
  'common.cancel': '取消',
  'common.loading': '加载中...',
  'list.edit': '编辑',
  'list.delete': '删除',
  'list.empty': '暂无资源',
  'list.unit.article': '篇',
  'filter.collection': '合集',
  'filter.tag': '标签',
  'filter.author': '作者',
  'list.batchDelete': '批量删除',
  'detail.back': '返回',
  'detail.protected': '此内容受保护',
  'detail.inputPassword': '输入访问密码',
  'detail.notFound': '资源不存在或已被删除',
  'common.none': '无',
  'common.unknownError': '未知错误',
  'general.remove': '移除',
  'common.success': '操作成功',
  'common.fail': '操作失败',
  'dialog.confirmTitle': '确认操作',
  'dialog.confirm': '确认',
  'dialog.notice': '提示',
  'dialog.failed': '操作失败',
};

const FALLBACK = 'zh-CN';

interface LanguageContextValue {
  /** 取翻译。支持 {name} 形式占位符替换；缺失时回退内置兜底，再缺失回退 key 本身 */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** 已扫描到的语言清单 */
  languages: LanguageInfo[];
  /** 实际生效的语言 code */
  effective: string;
  /** 全局默认语言（管理员设定） */
  globalDefault: string;
  /** 本地覆盖（localStorage）；null = 跟随全局 */
  localOverride: string | null;
  /** 字典是否已加载完成（首帧兜底期间为 false） */
  ready: boolean;
  /** 设置本地语言覆盖；传 null 表示跟随全局 */
  setLocalLanguage: (code: string | null) => void;
  /** 重新扫描 lang 目录（新增/改动了文件后调用） */
  refreshLanguages: () => Promise<void>;
  /**
   * 重新读取全局默认语言（管理员在语言页修改后必须调用）。
   * Provider 挂载时只读一次，写库后不主动刷新的话下拉框与生效语言都会停在旧值上。
   */
  refreshGlobalDefault: () => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function applyHtmlLang(code: string) {
  document.documentElement.lang = code;
}

/**
 * React 之外的纯函数（如 lib/dialog.ts 的默认标题、Vditor 回调里的 tip）取翻译用。
 * LanguageProvider 每次渲染后刷新，切语言 / 换字典后自动跟上；
 * Provider 未挂载时返回 key 本身（正常不会发生：对话框只可能从已挂载的 UI 触发）。
 */
let outsideT: (key: string, params?: Record<string, string | number>) => string = (key) => key;

export function tOutside(key: string, params?: Record<string, string | number>): string {
  return outsideT(key, params);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const localOverride = useUIStore((s) => s.language);
  const setLocalLanguage = useUIStore((s) => s.setLanguage);

  const [globalDefault, setGlobalDefault] = useState<string>(FALLBACK);
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [dict, setDict] = useState<Record<string, string>>(BUILTIN_ZH_CN);
  const [ready, setReady] = useState(false);

  const effective = localOverride || globalDefault || FALLBACK;

  const loadGlobalDefault = useCallback(async () => {
    try {
      const pub = (await invoke<Record<string, string>>('get_public_settings')) as Record<string, string>;
      if (pub.ui_language) setGlobalDefault(pub.ui_language);
    } catch (e) {
      console.warn('[i18n] 读取全局默认语言失败', e);
    }
  }, []);

  // 启动时：拿到全局默认语言（公开设置）+ 扫描语言清单。
  // 两者互不依赖，前者失败不阻断后者。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadGlobalDefault();
      if (cancelled) return;
      try {
        const list = (await invoke<LanguageInfo[]>('list_languages')) as LanguageInfo[];
        if (cancelled) return;
        setLanguages(list);
      } catch (e) {
        console.warn('[i18n] 加载语言清单失败，将使用内置简体中文', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadGlobalDefault]);

  // 生效语言变化时：拉取完整字典（已含回退合并），替换本地渲染用字典
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    applyHtmlLang(effective);
    (async () => {
      try {
        const d = (await invoke<Record<string, string>>('get_language', { code: effective })) as Record<string, string>;
        if (cancelled) return;
        setDict(d);
      } catch (e) {
        console.warn('[i18n] 加载语言字典失败，使用内置简体中文兜底', e);
        if (!cancelled) setDict(BUILTIN_ZH_CN);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effective]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let s = dict[key] ?? BUILTIN_ZH_CN[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return s;
    },
    [dict],
  );

  const refreshLanguages = useCallback(async () => {
    const list = (await invoke<LanguageInfo[]>('list_languages', { force: true })) as LanguageInfo[];
    setLanguages(list);
  }, []);

  // 登录态确立（含登出后换账户登录）时重读全局默认：
  // Provider 挂在最外层、不随路由卸载，仅靠挂载时那一次读取的话，
  // 同进程内换账户后拿到的还是上一个账户期间读到的旧值。
  const authUser = useAuthStore((s) => s.user);
  const lastUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    const id = authUser?.id ?? null;
    if (id !== null && id !== lastUserIdRef.current) {
      lastUserIdRef.current = id;
      loadGlobalDefault();
    }
  }, [authUser, loadGlobalDefault]);

  // 供 React 之外的调用方（lib/dialog.ts 默认标题等）拿到当前语言的 t
  useEffect(() => {
    outsideT = t;
  }, [t]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      t,
      languages,
      effective,
      globalDefault,
      localOverride,
      ready,
      setLocalLanguage,
      refreshLanguages,
      refreshGlobalDefault: loadGlobalDefault,
    }),
    [
      t,
      languages,
      effective,
      globalDefault,
      localOverride,
      ready,
      setLocalLanguage,
      refreshLanguages,
      loadGlobalDefault,
    ],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage 必须在 <LanguageProvider> 内使用');
  return ctx;
}
