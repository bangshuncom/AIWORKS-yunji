// 详情页共享：样式与各区块共用的数据类型
import { makeStyles, tokens } from '@fluentui/react-components';

export const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    // 阅读类页面限制行宽并居中，宽屏下正文不会拉成上百字一行
    width: '100%',
    maxWidth: '880px',
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
  header: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
    '@media (max-width: 640px)': {
      flexDirection: 'column',
    },
  },
  // 与编辑页封面同为 4:3，同一张图在两个页面不会被裁成不同比例
  thumb: {
    width: '200px',
    height: '150px',
    objectFit: 'cover',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  title: { fontSize: '28px', fontWeight: 700, margin: 0, lineHeight: 1.3 },
  descBlock: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1.7,
    color: tokens.colorNeutralForeground2,
    fontStyle: 'italic',
    position: 'relative',
    paddingLeft: '18px',
    '&::before': {
      content: '"“"',
      position: 'absolute',
      left: 0,
      top: '-2px',
      fontSize: '22px',
      color: tokens.colorBrandForeground1,
      fontStyle: 'normal',
      lineHeight: 1,
    },
  },
  meta: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
  // 作者胶囊：与 meta 里的时间、徽章同一行，高度与各处 Badge 对齐
  authorChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '3px 10px 3px 3px',
    border: 'none',
    borderRadius: '16px',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    fontSize: '13px',
    lineHeight: '20px',
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  tags: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  content: {
    // 与下方各区块同为 20px，保证同一页面里卡片内边距只有一种规格
    padding: '20px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    lineHeight: 1.8,
    fontSize: '15px',
    '& img': { maxWidth: '100%', borderRadius: '8px' },
    '& pre': { overflowX: 'auto', background: tokens.colorNeutralBackground2, padding: '12px', borderRadius: '8px' },
    '& code': { fontFamily: 'Consolas, Monaco, monospace' },
  },
  itemBlock: {
    padding: '20px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    fontWeight: 600,
  },
  itemDesc: { fontSize: '13px', color: tokens.colorNeutralForeground2, lineHeight: 1.6 },
  magnetContent: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontFamily: 'Consolas, Monaco, monospace',
    fontSize: '13px',
    wordBreak: 'break-all',
    cursor: 'pointer',
  },
  gallery: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },
  galleryImg: {
    width: '100%',
    aspectRatio: '4 / 3',
    objectFit: 'cover',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'transform 0.15s',
    '&:hover': { transform: 'scale(1.02)' },
  },
  filesBox: {
    marginTop: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  filesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 14px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  filesTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  filesRow: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  filesName: {
    padding: '8px 14px',
    textAlign: 'left',
    wordBreak: 'break-all',
  },
  filesSize: {
    padding: '8px 14px',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3,
    minWidth: '80px',
  },
});

/** 一条磁力种子的分组（种子文件与磁力链接同属一个 item） */
export interface MtGroup {
  magnetContent: string;
  magnetFileName: string;
  torrentPath: string;
  torrentFileName: string;
  description: string;
  itemId: number;
}

/** 从磁力链接中提取文件名（dn 参数） */
export function extractMagnetFilename(magnet: string): string {
  const m = magnet.match(/[?&]dn=([^&]+)/i);
  if (!m) return 'magnet';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
