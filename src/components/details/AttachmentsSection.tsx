// 详情页其他条目区块：链接 / 直链 / ED2K / 附件（不含磁力种子）
import { useNavigate } from 'react-router-dom';
import { Button, tokens } from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  CopyRegular,
  DocumentRegular,
  EditRegular,
  LinkRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import type { ResourceItem } from '../../types/models';
import { useStyles, type MtGroup } from './shared';

const ITEM_ICONS: Record<string, ReactElement> = {
  link: <LinkRegular />,
  direct_link: <ArrowDownloadRegular />,
  ed2k: <LinkRegular />,
  file: <DocumentRegular />,
};

const ITEM_LABELS: Record<string, string> = {
  link: '链接',
  direct_link: '直链',
  ed2k: 'ED2K',
  file: '附件',
};

export function AttachmentsSection({
  items,
  resourceId,
  missingIds,
  canArticle,
  onOpenTorrent,
}: {
  items: ResourceItem[];
  resourceId: number;
  missingIds: Set<number>;
  canArticle: boolean;
  onOpenTorrent: (g: MtGroup) => void;
}) {
  const styles = useStyles();
  const navigate = useNavigate();

  return (
    <>
      {items.map((it) => (
        <div key={it.id} className={styles.itemBlock}>
          <div className={styles.itemHeader}>
            {ITEM_ICONS[it.type] ?? <LinkRegular />} {ITEM_LABELS[it.type] ?? it.type}
          </div>
          {it.description && <div className={styles.itemDesc}>{it.description}</div>}
          {it.type === 'file' ? (
            missingIds.has(it.id) ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <WarningRegular color={tokens.colorPaletteRedForeground1} />
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  附件「{it.file_name || '文件'}」已丢失（可能被手动删除），无法下载
                </span>
                {canArticle && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={() => navigate(`/edit/${resourceId}`)}
                  >
                    编辑文章重新上传
                  </Button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button
                  appearance="outline"
                  size="small"
                  icon={<ArrowDownloadRegular />}
                  onClick={() =>
                    onOpenTorrent({
                      magnetContent: '',
                      magnetFileName: '',
                      torrentPath: it.file_path,
                      torrentFileName: it.file_name || '附件',
                      description: '',
                      itemId: it.id,
                    })
                  }
                >
                  下载 {it.file_name || '附件'}
                </Button>
              </div>
            )
          ) : (
            <div
              className={styles.magnetContent}
              onClick={() => navigator.clipboard?.writeText(it.content).catch(() => {})}
              title="点击复制"
            >
              <span style={{ flex: 1 }}>{it.content}</span>
              <CopyRegular />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
