// 图片本地化进度：订阅后端 collector-progress 事件并渲染进度面板。
// 后端 collector_set_thumbnail / collector_add_images 在下载过程中推事件，
// 保存流程与（曾经的）采集弹窗共用这一套展示。
import { useCallback, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { formatBytes } from '../../lib/format';

/** 后端 collector-progress 事件载荷 */
export interface CollectorProgressEvent {
  kind: 'cover' | 'image';
  /** 图集内序号（封面固定 0）；与传给后端的 urls 下标一致 */
  index: number;
  total_tasks: number;
  done: number;
  size?: number | null;
  round: number;
  /** 当前生效的代理；null = 直连 */
  proxy?: string | null;
}

export interface TaskProgress {
  done: number;
  size?: number | null;
  /** 断点续传轮次（0 起） */
  round: number;
  /** bytes/s（指数平滑） */
  speed: number;
}

/** 进度面板的一行；key 需与后端推送的 `${kind}-${index}` 对齐 */
export interface ProgressRow {
  key: string;
  label: string;
}

const useStyles = makeStyles({
  panel: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' },
  proxyBanner: { fontSize: '12px', padding: '6px 10px', borderRadius: '6px' },
  taskRow: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 2px' },
  taskLine: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', gap: '8px' },
  barTrack: { height: '5px', borderRadius: '3px', background: tokens.colorNeutralBackground3, overflow: 'hidden' },
  barFill: { height: '100%', background: tokens.colorBrandBackground, transition: 'width .2s' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
});

/**
 * 在异步任务执行期间订阅后端图片下载进度。
 * 刻意用 listen() 直接包裹任务，而不是 useEffect 订阅：
 * 后者存在「effect 还没跑，下载已经开始」的竞态，会丢掉开头的进度事件。
 */
export function useImageDownloadProgress() {
  const [proxy, setProxy] = useState<string | null | undefined>(undefined);
  const [progress, setProgress] = useState<Record<string, TaskProgress>>({});
  // 上一帧的 (时间, 已下载字节)，用于估算瞬时速度
  const speedRef = useRef<Map<string, { t: number; b: number }>>(new Map());

  const reset = useCallback(() => {
    setProgress({});
    setProxy(undefined);
    speedRef.current.clear();
  }, []);

  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const unlisten = await listen<CollectorProgressEvent>('collector-progress', (ev) => {
      const p = ev.payload;
      if (p.proxy !== undefined && p.proxy !== null) setProxy(p.proxy);
      else if (p.proxy === null) setProxy(null);

      const key = `${p.kind}-${p.index}`;
      const now = performance.now();
      const prev = speedRef.current.get(key);
      let speed = 0;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0) speed = Math.max(0, (p.done - prev.b) / dt);
      }
      speedRef.current.set(key, { t: now, b: p.done });

      setProgress((m) => ({
        ...m,
        [key]: {
          done: p.done,
          size: p.size ?? m[key]?.size,
          round: p.round,
          // 平滑一下，避免数字乱跳
          speed: m[key] ? m[key].speed * 0.6 + speed * 0.4 : speed,
        },
      }));
    });
    try {
      return await fn();
    } finally {
      unlisten();
    }
  }, []);

  return { proxy, progress, reset, track };
}

/** 逐张下载进度面板（无状态，可直接复用在任何容器里） */
export function ImageProgressPanel({
  proxy,
  rows,
  progress,
}: {
  proxy: string | null | undefined;
  rows: ProgressRow[];
  progress: Record<string, TaskProgress>;
}) {
  const s = useStyles();
  return (
    <div className={s.panel}>
      <div
        className={s.proxyBanner}
        style={{
          background:
            proxy === undefined
              ? tokens.colorNeutralBackground3
              : proxy
                ? tokens.colorPaletteGreenBackground2
                : tokens.colorPaletteRedBackground2,
          color: proxy === undefined ? tokens.colorNeutralForeground3 : undefined,
        }}
      >
        {proxy === undefined && '正在建立连接…'}
        {proxy === null && (
          <>
            ⚠ 未检测到系统代理，当前为<b>直连</b>。浏览器能秒开而这里很慢，通常是 Clash 只开了浏览器代理/已关闭 ——请在
            Clash 中打开「系统代理」后重试（TUN 模式可忽略此提示）
          </>
        )}
        {proxy && (
          <>
            网络出口：系统代理 <b>{proxy}</b>
          </>
        )}
      </div>

      {rows.map(({ key, label }) => {
        const t = progress[key];
        const pct = t?.size ? Math.min(100, Math.round((t.done / t.size) * 100)) : undefined;
        return (
          <div key={key} className={s.taskRow}>
            <div className={s.taskLine}>
              <span>{label}</span>
              <span style={{ color: tokens.colorNeutralForeground3 }}>
                {!t
                  ? '排队中…'
                  : `${formatBytes(t.done, true)}${t.size ? ` / ${formatBytes(t.size, true)}` : ''}${
                      pct !== undefined ? ` · ${pct}%` : ''
                    } · ${formatBytes(t.speed, true)}/s${t.round > 0 ? ` · 续传第 ${t.round + 1} 次` : ''}`}
              </span>
            </div>
            <div className={s.barTrack}>
              <div
                className={s.barFill}
                style={{
                  width: pct !== undefined ? `${pct}%` : t ? '100%' : '0%',
                  opacity: pct === undefined ? 0.35 : 1,
                }}
              />
            </div>
          </div>
        );
      })}
      <span className={s.hint}>单张图片 30 秒无数据才会超时并重试，慢而不断会持续下载，请勿关闭窗口</span>
    </div>
  );
}

/** 保存期间的模态进度：下载远程图片时挡住表单，避免边改边存 */
export function SaveProgressDialog({
  open,
  rows,
  proxy,
  progress,
}: {
  open: boolean;
  rows: ProgressRow[];
  proxy: string | null | undefined;
  progress: Record<string, TaskProgress>;
}) {
  if (!open) return null;
  return (
    <Dialog open modalType="alert">
      <DialogSurface>
        <DialogBody>
          <DialogTitle>正在把远程图片本地化…</DialogTitle>
          <DialogContent>
            <ImageProgressPanel proxy={proxy} rows={rows} progress={progress} />
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
