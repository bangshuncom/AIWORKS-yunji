// 下载种子/附件弹窗：定位到资源管理器 或 用默认软件打开
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogTrigger,
} from '@fluentui/react-components';
import { FolderRegular, OpenRegular } from '@fluentui/react-icons';
import { torrentApi } from '../../lib/tauri';
import { notifyError } from '../../lib/dialog';
import type { MtGroup } from './shared';

export function TorrentDownloadDialog({ target, onClose }: { target: MtGroup | null; onClose: () => void }) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(_, e) => {
        if (!e.open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>下载文件</DialogTitle>
          <DialogContent>
            <p style={{ margin: 0 }}>{target?.torrentFileName || '下载文件'}</p>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button appearance="secondary">取消</Button>
            </DialogTrigger>
            <Button
              icon={<FolderRegular />}
              appearance="outline"
              onClick={async () => {
                if (!target?.torrentPath) return;
                try {
                  await torrentApi.revealFile(target.torrentPath);
                  onClose();
                } catch (e: any) {
                  await notifyError(e.message || '定位失败');
                }
              }}
            >
              定位到文件
            </Button>
            <Button
              icon={<OpenRegular />}
              appearance="primary"
              onClick={async () => {
                if (!target?.torrentPath) return;
                try {
                  await torrentApi.openFile(target.torrentPath);
                  onClose();
                } catch (e: any) {
                  await notifyError(e.message || '打开失败');
                }
              }}
            >
              用默认软件打开
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
