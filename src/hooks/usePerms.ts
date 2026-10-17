// 功能权限 Hook：结合当前用户等级与公开设置中的功能阈值
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { settingsApi } from '../lib/tauri';

export type Feature = 'article' | 'article_own' | 'collection' | 'collection_own' | 'tag' | 'trash' | 'user';

export interface Perms {
  /** 是否已登录 */
  isLoggedIn: boolean;
  /** 是否管理员（恒为最高权限） */
  isAdmin: boolean;
  /** 当前生效权限值（未登录=0，管理员=5） */
  level: number;
  /** 公开权限设置是否已加载（守卫用于避免加载中误判） */
  settingsLoaded: boolean;
  /** 是否可使用某管理功能 */
  can: (f: Feature) => boolean;
}

export function usePerms(): Perms {
  const user = useAuthStore((s) => s.user);
  const { data, isSuccess } = useQuery<Record<string, string>>({
    queryKey: ['public-settings'],
    queryFn: settingsApi.getPublic,
    staleTime: 30_000,
  });

  const isAdmin = !!user?.is_admin;
  const level = !user ? 0 : isAdmin ? 5 : (user.permission_level ?? 0);

  const can = (f: Feature) => {
    if (!user) return false;
    if (isAdmin) return true;
    const threshold = Number(data?.[`perm_${f}`] ?? 5);
    return level >= threshold;
  };

  return { isLoggedIn: !!user, isAdmin, level, settingsLoaded: isSuccess, can };
}
