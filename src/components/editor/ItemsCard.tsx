// 编辑页附件项卡片：按类型添加链接 / eD2K / 磁力种子 / 附件文件 / 直链，支持拖拽排序
import { Badge, Button, Card, Input, Label, tokens } from '@fluentui/react-components';
import { AddCircleRegular, ArrowUploadRegular, DeleteRegular } from '@fluentui/react-icons';
import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './Sortable';
import { ITEM_TYPES, useStyles, CARD_STYLE, CARD_HEAD_STYLE, type EditItem } from './shared';
import type { CreateItem } from '../../types/models';

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

  return (
    <Card style={CARD_STYLE}>
      <div style={CARD_HEAD_STYLE}>
        <Label>附件项（支持多个，可拖拽排序）</Label>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {ITEM_TYPES.map((t) => (
            <Button
              key={t.value}
              appearance="outline"
              size="small"
              icon={<AddCircleRegular />}
              onClick={() => onAdd(t.value as CreateItem['type'])}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
          暂无附件，点击上方按钮添加链接 / 磁力种子 / 文件等
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
                        {ITEM_TYPES.find((t) => t.value === it.type)?.label ?? it.type}
                      </Badge>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<DeleteRegular />}
                        onClick={() => onRemove(it._id)}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label>描述</Label>
                      <Input
                        value={it.description}
                        onChange={(_, d) => onUpdate(it._id, { description: d.value })}
                        placeholder="可选描述"
                      />
                    </div>
                    {it.type === 'magnet_torrent' ? (
                      <>
                        <div className={styles.field}>
                          <Label>磁力链接</Label>
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
                            上传种子文件
                          </Button>
                          {it.file_name && (
                            <>
                              <Badge
                                appearance={it.localFilePath ? 'tint' : 'outline'}
                                title={it.localFilePath ? '保存后上传' : undefined}
                              >
                                {it.file_name}
                                {it.localFilePath ? ' · 待保存' : ''}
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
                          上传文件
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
                        <Label>链接</Label>
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
