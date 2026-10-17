// 元素进入视口检测（用于无限滚动的底部哨兵）
import { useCallback, useEffect, useState } from 'react';

export function useInView<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit & { enabled?: boolean },
) {
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const enabled = options?.enabled ?? true;
  const root = options?.root ?? null;
  const rootMargin = options?.rootMargin ?? '300px';
  const threshold = options?.threshold ?? 0;

  // 用回调 ref 而不是 useRef：哨兵是条件渲染的（列表有数据之后才出现），
  // 得把元素存进 state，挂载动作本身才能重新触发下面的 effect。
  // 否则首屏 el 还是 null，之后依赖没变 effect 不再跑，observer 永远绑不上。
  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el || !enabled) {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      root,
      rootMargin,
      threshold,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, enabled, root, rootMargin, threshold]);

  return { ref, inView };
}
