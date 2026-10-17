// 编辑页图集卡片：添加图片、拖拽排序、删除
import { Button, Card, Label, tokens } from '@fluentui/react-components';
import { AddCircleRegular } from '@fluentui/react-icons';
import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableImage } from './Sortable';
import { useStyles, CARD_STYLE, CARD_HEAD_STYLE, type EditImage } from './shared';

export function GalleryCard({
  images,
  sensors,
  onUpload,
  onDelete,
  onDragEnd,
}: {
  images: EditImage[];
  sensors: SensorDescriptor<SensorOptions>[];
  onUpload: () => void;
  onDelete: (img: EditImage) => void;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  const styles = useStyles();

  return (
    <Card style={CARD_STYLE}>
      <div style={CARD_HEAD_STYLE}>
        <Label>图集</Label>
        <Button size="small" appearance="outline" icon={<AddCircleRegular />} onClick={onUpload}>
          添加图片
        </Button>
      </div>
      {images.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>暂无图片</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((im) => String(im.id))} strategy={horizontalListSortingStrategy}>
            <div className={styles.gallery}>
              {images.map((im) => (
                <SortableImage key={im.id} img={im} onDelete={() => onDelete(im)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}
