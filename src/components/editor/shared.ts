// 编辑页共享：样式、条目类型、附件项与图集项的数据结构
import { makeStyles, tokens } from '@fluentui/react-components';
import type { CSSProperties } from 'react';
import type { CreateItem } from '../../types/models';

// 卡片统一规格。用 inline style 而非 makeStyles：Card 自带默认内边距，
// 单类选择器压不过组件默认样式，inline 才能确保各卡片内边距一致。
export const CARD_STYLE: CSSProperties = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

// 卡片标题行：标题居左、操作居右，窄屏自动换行
export const CARD_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '8px',
};

// 缩略图操作按钮：等宽，避免「选择」和「清除」宽度差一截
export const THUMB_ACTION_STYLE: CSSProperties = { minWidth: '88px' };

export const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    // 表单类页面限制阅读宽度并居中，否则宽屏下全部挤在左侧、右侧留大片空白
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto',
  },
  // 返回居左、操作居右
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
  },
  // 字段纵向排列，间距由所属卡片的 gap 统一提供，不要再给单个字段加 marginBottom
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  // auto-fit：只有一项时也占满整行，不留半边空白
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' },
  // 元数据卡：左列固定给缩略图，右列放分类 / 合集 / 访问密码，窄屏时上下堆叠
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '20px',
    alignItems: 'start',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  // 右列内部纵向堆叠，间距与卡片其余部分保持一致
  metaFields: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 },
  itemBlock: {
    padding: '14px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  // 预览在上、操作按钮在下；左对齐，避免窄图时按钮被拉到很远
  thumbBox: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' },
  thumbActions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  // 不锁高度：按原图比例显示，只限制最大宽度，竖图/长图不会被裁成 4:3
  thumb: {
    display: 'block',
    width: 'auto',
    height: 'auto',
    maxWidth: '300px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0,
  },
  // 无图时的占位框：图片本身没有高度，占位需要自己撑出一块，否则会塌成一条线
  thumbEmpty: {
    width: '300px',
    height: '169px',
    borderRadius: '8px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    flexShrink: 0,
  },
  gallery: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  galleryItem: {
    position: 'relative',
    width: '132px',
    height: '99px',
  },
  galleryImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', cursor: 'move' },
  galleryPending: {
    position: 'absolute',
    left: '2px',
    bottom: '2px',
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    pointerEvents: 'none',
  },
  galleryDelete: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
  },
  // 标签候选项：点选切换，可换行
  tagOptions: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' },
});

export interface EditItem extends CreateItem {
  _id: string; // 临时 ID，用于 dnd-kit
  _isNew?: boolean;
  /** 选中但尚未上传的本地文件路径，保存时才真正上传 */
  localFilePath?: string;
}

export interface EditImage {
  id: number | string;
  file_path: string;
  /** 新建/未保存时选中的本地文件路径，保存时才真正上传 */
  localPath?: string;
  /** 采集回填的远程图片地址，保存时才下载本地化 */
  remoteUrl?: string;
  /** 下载远程图片防盗链所需的 Referer */
  remoteReferer?: string;
}

/** 是否为「尚未落库」的图集项（本地待上传 或 远程待本地化） */
export const isPendingImage = (im: EditImage) => !!im.localPath || !!im.remoteUrl;

/**
 * 标签输入归一化：中英文逗号都当分隔符，输入中文逗号时立刻换成英文逗号。
 * 编辑页保存时切分也走这里，保证「输入时看到的分隔」和「保存时切分的结果」一致。
 */
export const normalizeTagInput = (s: string) => s.replace(/，/g, ',');

export const genId = () => Math.random().toString(36).slice(2, 11);

export const ITEM_TYPES = [
  { value: 'link', labelKey: 'itemsCard.type.link' },
  { value: 'ed2k', labelKey: 'itemsCard.type.ed2k' },
  { value: 'magnet_torrent', labelKey: 'itemsCard.type.magnet_torrent' },
  { value: 'file', labelKey: 'itemsCard.type.file' },
  { value: 'direct_link', labelKey: 'itemsCard.type.direct_link' },
];
