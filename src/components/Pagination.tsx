// 通用分页条
import { useEffect, useState } from 'react';
import { Button, Input, tokens } from '@fluentui/react-components';
import { ChevronLeftRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { useComposingInput } from '../hooks/useComposingInput';

/** 跳页框只放行数字；组词期间不改写内容，见 useComposingInput */
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');

export interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, onChange }: PaginationProps) {
  const [jump, setJump] = useState(String(page));
  const composing = useComposingInput();

  // 外部翻页后同步输入框
  useEffect(() => {
    setJump(String(page));
  }, [page]);

  if (totalPages <= 1) return null;

  const doJump = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n)) {
      onChange(Math.min(totalPages, Math.max(1, n)));
    } else {
      setJump(String(page));
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '10px',
        padding: '16px 0 8px',
        flexWrap: 'wrap',
      }}
    >
      <Button
        appearance="outline"
        size="small"
        icon={<ChevronLeftRegular />}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <span style={{ color: tokens.colorNeutralForeground2, fontSize: '13px' }}>
        第 {page} / {totalPages} 页{total != null && ` · 共 ${total} 项`}
      </span>
      <Button
        appearance="outline"
        size="small"
        iconPosition="after"
        icon={<ChevronRightRegular />}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
        <span style={{ color: tokens.colorNeutralForeground3, fontSize: '13px' }}>跳至</span>
        <Input
          size="small"
          style={{ width: '64px' }}
          value={jump}
          onChange={(_, d) => setJump(composing.transform(d.value, onlyDigits))}
          onCompositionStart={composing.onCompositionStart}
          onCompositionEnd={(ev) => {
            composing.onCompositionEnd();
            setJump(onlyDigits(ev.currentTarget.value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doJump();
          }}
          onBlur={doJump}
        />
        <span style={{ color: tokens.colorNeutralForeground3, fontSize: '13px' }}>页</span>
      </span>
    </div>
  );
}
