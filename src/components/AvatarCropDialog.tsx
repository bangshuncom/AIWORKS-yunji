// 头像裁剪弹窗：本地图片 -> 方形裁剪（拖动 + 缩放）-> PNG 字节上传
import { useCallback, useEffect, useRef, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { ZoomInRegular, ZoomOutRegular } from '@fluentui/react-icons';
import { authApi, userApi } from '../lib/tauri';
import { useAuthStore } from '../stores/authStore';

const VIEW = 300; // 裁剪视口尺寸（正方形）
const OUTPUT = 256; // 输出头像尺寸

interface Props {
  filePath: string;
  onClose: () => void;
  /** 传入则为管理员给该用户设置头像；不传则设置当前登录用户自己的头像 */
  targetUserId?: number;
  /** 上传完成后的回调（管理员场景用于刷新列表），参数为保存后的头像相对路径 */
  onUploaded?: (avatarPath: string) => void;
}

export function AvatarCropDialog({ filePath, onClose, targetUserId, onUploaded }: Props) {
  const setUser = useAuthStore((s) => s.setUser);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // scale = 显示像素 / 自然像素；x/y = 图片左上角相对视口的偏移
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1); // 相对最小填满比例的倍数
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 用 fs 读取字节并生成同源 blob: URL，避免 asset 协议跨域污染 canvas
  const [src, setSrc] = useState('');
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    let url = '';
    let cancelled = false;
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : 'image/png';
    readFile(filePath)
      .then((bytes) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setSrc(url);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(String(e?.message || e));
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [filePath]);
  const minScale = size ? Math.max(VIEW / size.w, VIEW / size.h) : 1;
  const realScale = minScale * zoom;

  // 限制偏移，保证图片始终铺满视口
  const clamp = useCallback((s: number, p: { x: number; y: number }, w: number, h: number) => {
    const dw = w * s;
    const dh = h * s;
    const maxX = 0;
    const minX = VIEW - dw;
    const maxY = 0;
    const minY = VIEW - dh;
    return {
      x: dw <= VIEW ? (VIEW - dw) / 2 : Math.min(maxX, Math.max(minX, p.x)),
      y: dh <= VIEW ? (VIEW - dh) / 2 : Math.min(maxY, Math.max(minY, p.y)),
    };
  }, []);

  // 缩放时以视口中心为锚点
  const applyZoom = useCallback(
    (newZoom: number) => {
      if (!size) return;
      const oldScale = realScale;
      const nextScale = minScale * newZoom;
      const cx = VIEW / 2;
      const cy = VIEW / 2;
      setPos((p) => {
        const ix = (cx - p.x) / oldScale;
        const iy = (cy - p.y) / oldScale;
        return clamp(nextScale, { x: cx - ix * nextScale, y: cy - iy * nextScale }, size.w, size.h);
      });
      setScale(nextScale);
      setZoom(newZoom);
    },
    [size, minScale, realScale, clamp],
  );

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setSize({ w, h });
    const s = Math.max(VIEW / w, VIEW / h);
    setScale(s);
    setPos({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !size) return;
    setPos(clamp(scale, { x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }, size.w, size.h));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const confirm = async () => {
    if (!size) return;
    setBusy(true);
    setError('');
    try {
      const img = new Image();
      img.src = src;
      await img.decode().catch(
        () =>
          new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
          }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');
      ctx.imageSmoothingQuality = 'high';
      // 视口 300px 对应自然图上的区域：(-pos)/scale, VIEW/scale
      const sx = -pos.x / scale;
      const sy = -pos.y / scale;
      const sw = VIEW / scale;
      const sh = VIEW / scale;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('生成图片失败'))), 'image/png'),
      );
      const buf = await blob.arrayBuffer();
      let savedPath = '';
      if (targetUserId != null) {
        savedPath = await userApi.setAvatar(targetUserId, buf, 'png');
      } else {
        savedPath = await authApi.uploadAvatarBytes(buf, 'png');
        const fresh = await authApi.me();
        if (fresh) setUser(fresh);
      }
      onUploaded?.(savedPath);
      onClose();
    } catch (e: any) {
      setError(e?.message || '头像上传失败');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <Dialog
      open
      onOpenChange={(_, d) => {
        if (!d.open && !busy) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>裁剪头像</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  position: 'relative',
                  width: VIEW,
                  height: VIEW,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  backgroundColor: tokens.colorNeutralBackground3,
                  cursor: busy ? 'wait' : 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                {!size && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Spinner size="small" />
                  </div>
                )}
                {src && (
                  <img
                    src={src}
                    alt="待裁剪头像"
                    onLoad={onImgLoad}
                    draggable={false}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transformOrigin: '0 0',
                      transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                      maxWidth: 'none',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: VIEW }}>
                <ZoomOutRegular />
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.01}
                  value={zoom}
                  disabled={!size || busy}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <ZoomInRegular />
              </div>
              <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                拖动调整位置，滑动缩放，输出 {OUTPUT}×{OUTPUT} 方形 PNG
              </span>
              {error && <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>{error}</span>}
              {loadErr && (
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  读取图片失败：{loadErr}
                </span>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={confirm} disabled={!size || busy}>
              {busy ? '上传中...' : '确认裁剪'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
