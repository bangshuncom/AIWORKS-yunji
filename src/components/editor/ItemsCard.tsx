// 编辑页附件项卡片：按类型添加链接 / eD2K / 磁力种子 / 附件文件 / 直链，支持拖拽排序
import { Badge, Button, Card, Input, Label, tokens } from '@fluentui/react-components';
import { AddCircleRegular, ArrowUploadRegular, DeleteRegular } from '@fluentui/react-icons';
import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './Sortable';
import { ITEM_TYPES, useStyles, CARD_STYLE, CARD_HEAD_STYLE, type EditItem } from './shared';
import type { CreateItem } from '../../types/models';
import { useLanguage } from '../../i18n';

export function ItemsCard({
  items,
  sensors,
  onAdd,
  onRemove,
  onUpdate,
  onUploadTorrent,
  onUploadFile,
  onDragEnd,
}: {
  items: EditItem[];
  sensors: SensorDescriptor<SensorOptions>[];
  onAdd: (type: CreateItem['type']) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<EditItem>) => void;
  onUploadTorrent: (id: string) => void;
  onUploadFile: (id: string) => void;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  const styles = useStyles();
  const { t } = useLanguage();

  return (
    <Card style={CARD_STYLE}>
      <div style={CARD_HEAD_STYLE}>
        <Label>{t('itemsCard.title')}</Label>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {ITEM_TYPES.map((ty) => (
            <Button
              key={ty.value}
              appearance="outline"
              size="small"
              icon={<AddCircleRegular />}
              onClick={() => onAdd(ty.value as CreateItem['type'])}
            >
              {t(ty.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
          {t('itemsCard.empty')}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((it) => it._id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((it) => (
                <SortableItem key={it._id} item={it}>
                  <div className={styles.itemBlock}>
                    <div className={styles.itemHeader}>
                      <Badge appearance="outline">
                        {t(ITEM_TYPES.find((x) => x.value === it.type)?.labelKey ?? it.type)}
                      </Badge>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<DeleteRegular />}
                        onClick={() => onRemove(it._id)}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label>{t('itemsCard.description')}</Label>
                      <Input
                        value={it.description}
                        onChange={(_, d) => onUpdate(it._id, { description: d.value })}
                        placeholder={t('itemsCard.descriptionPlaceholder')}
                      />
                    </div>
                    {it.type === 'magnet_torrent' ? (
                      <>
                        <div className={styles.field}>
                          <Label>{t('itemsCard.magnetLink')}</Label>
                          <Input
                            value={it.content}
                            onChange={(_, d) => onUpdate(it._id, { content: d.value })}
                            placeholder="magnet:?xt=urn:btih:..."
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <Button
                            size="small"
                            appearance="outline"
                            icon={<ArrowUploadRegular />}
                            onClick={() => onUploadTorrent(it._id)}
                          >
                            {t('itemsCard.uploadTorrent')}
                          </Button>
                          {it.file_name && (
                            <>
                              <Badge
                                appearance={it.localFilePath ? 'tint' : 'outline'}
                                title={it.localFilePath ? t('itemsCard.uploadAfterSave') : undefined}
                              >
                                {it.file_name}
                                {it.localFilePath ? t('itemsCard.pendingSave') : ''}
                              </Badge>
                              <Button
                                size="small"
                                appearance="subtle"
                                icon={<DeleteRegular />}
                                onClick={() =>
                                  onUpdate(it._id, { file_path: '', file_name: '', localFilePath: undefined })
                                }
                              />
                            </>
                          )}
                        </div>
                      </>
                    ) : it.type === 'file' ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Button
                          size="small"
                          appearance="outline"
                          icon={<ArrowUploadRegular />}
                          onClick={() => onUploadFile(it._id)}
                        >
                          {t('itemsCard.uploadFile')}
                        </Button>
                        {it.file_name && (
                          <>
                            <Badge appearance="outline">{it.file_name}</Badge>
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<DeleteRegular />}
                              onClick={() => onUpdate(it._id, { file_path: '', file_name: '' })}
                            />
                          </>
                        )}
                      </div>
                    ) : (
                      <div className={styles.field}>
                        <Label>{t('itemsCard.link')}</Label>
                        <Input
                          value={it.content}
                          onChange={(_, d) => onUpdate(it._id, { content: d.value })}
                          placeholder={it.type === 'ed2k' ? 'ed2k://...' : 'https://...'}
                        />
                      </div>
                    )}
                  </div>
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}
