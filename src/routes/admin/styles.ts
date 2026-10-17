// 设置页各 Tab 共享的样式
import { makeStyles, tokens } from '@fluentui/react-components';

export const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '760px',
  },
  card: {
    padding: '16px',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
  },
  feedback: {
    marginBottom: '12px',
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  userCheck: {
    flexShrink: 0,
  },
  userInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  userName: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userMeta: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cleanupContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '960px',
  },
  filterBar: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  orphanRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  orphanCheck: {
    flexShrink: 0,
  },
  orphanThumb: {
    width: '36px',
    height: '36px',
    objectFit: 'cover',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  orphanIcon: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
});
