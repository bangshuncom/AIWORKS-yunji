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
import { useLanguage } from '../../i18n';

const ITEM_ICONS: Record<string, ReactElement> = {
  link: <LinkRegular />,
  direct_link: <ArrowDownloadRegular />,
  ed2k: <LinkRegular />,
  file: <DocumentRegular />,
};

const ITEM_LABEL_KEYS: Record<string, string> = {
  link: 'itemType.link',
  direct_link: 'itemType.direct_link',
  ed2k: 'itemType.ed2k',
  file: 'itemType.file',
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
  const { t } = useLanguage();

  return (
    <>
      {items.map((it) => (
        <div key={it.id} className={styles.itemBlock}>
          <div className={styles.itemHeader}>
            {ITEM_ICONS[it.type] ?? <LinkRegular />} {t(ITEM_LABEL_KEYS[it.type] ?? it.type)}
          </div>
          {it.description && <div className={styles.itemDesc}>{it.description}</div>}
          {it.type === 'file' ? (
            missingIds.has(it.id) ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <WarningRegular color={tokens.colorPaletteRedForeground1} />
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  {t('attachments.missing', { name: it.file_name || t('attachments.file') })}
                </span>
                {canArticle && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={() => navigate(`/edit/${resourceId}`)}
                  >
                    {t('attachments.reupload')}
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
                      torrentFileName: it.file_name || t('attachments.attachment'),
                      description: '',
                      itemId: it.id,
                    })
                  }
                >
                  {t('attachments.download', { name: it.file_name || t('attachments.attachment') })}
                </Button>
              </div>
            )
          ) : (
            <div
              className={styles.magnetContent}
              onClick={() => navigator.clipboard?.writeText(it.content).catch(() => {})}
              title={t('attachments.copyHint')}
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
