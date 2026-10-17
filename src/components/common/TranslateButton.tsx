// 翻译按钮：翻译 → 取消 → 还原 三态，附带目标语言下拉
//
// 还原是零成本的：翻译前把原文存在本地 state 里，所以任何时候都能一键退回。
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Button, Dropdown, Option, Spinner, tokens } from '@fluentui/react-components';
import { TranslateRegular, ArrowUndoRegular } from '@fluentui/react-icons';
import { translateApi } from '../../lib/tauri';
import { errorText } from '../../lib/errors';

interface TranslateButtonProps {
  /** 待翻译的当前内容 */
  value: string;
  /** 写回译文 / 还原原文 */
  onChange: (next: string) => void;
}

/**
 * 单行控件的标准高度（Fluent medium = 32px）。
 * 这些按钮总是挨着 Input / Textarea 放，尺寸必须和它们一致，
 * 否则同一行里控件高度参差——所以不再提供 small 变体。
 */
const CONTROL_SIZE = 'medium' as const;

interface ProgressPayload {
  done: number;
  total: number;
}

/** 语言列表加载完成前的兜底，保证首帧也能显示当前语言 */
const LANG_FALLBACK = [{ code: 'zh', name: '简体中文' }];

export function TranslateButton({ value, onChange }: TranslateButtonProps) {
  const [lang, setLang] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 非 null 表示当前内容已是译文，点「还原」回到这个原文 */
  const [original, setOriginal] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: options } = useQuery({
    queryKey: ['translate-options'],
    queryFn: translateApi.options,
    staleTime: 5 * 60 * 1000,
  });
  const targetLang = lang ?? options?.target_lang ?? 'zh';
  const langs = options?.languages ?? LANG_FALLBACK;
  const langName = langs.find((l) => l.code === targetLang)?.name ?? targetLang;
  const notConfigured = options != null && !options.configured;

  const run = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setErr(null);
    setProgress(null);
    let unlisten: UnlistenFn | undefined;
    try {
      // 先订阅再发请求：反过来的话，最早几段的进度会在订阅建立前就发出去
      unlisten = await listen<ProgressPayload>('translate-progress', (ev) => {
        setProgress(ev.payload);
      });
      const res = await translateApi.text(value, targetLang);
      setOriginal(value);
      onChange(res.text);
      if (res.cancelled) {
        setErr('翻译已取消，已翻译的部分已保留');
      } else if (res.failed_blocks > 0) {
        setErr(res.error ?? `有 ${res.failed_blocks} 段未能翻译，已保留原文`);
      }
    } catch (e) {
      setErr(errorText(e));
    } finally {
      unlisten?.();
      setBusy(false);
      setCancelling(false);
      setProgress(null);
    }
  };

  /** 取消是「批间生效」的：当前这一批请求要等它自己返回，所以按钮上要有反馈 */
  const cancel = async () => {
    setCancelling(true);
    try {
      await translateApi.cancel();
    } catch {
      // 取消失败不影响已有进度，交给本轮请求自然结束
      setCancelling(false);
    }
  };

  const restore = () => {
    if (original === null) return;
    onChange(original);
    setOriginal(null);
    setErr(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {busy ? (
          <>
            <Button size={CONTROL_SIZE} icon={<Spinner size="tiny" />} disabled>
              {progress ? `翻译中 ${progress.done}/${progress.total}` : '翻译中…'}
            </Button>
            <Button size={CONTROL_SIZE} appearance="subtle" onClick={cancel} disabled={cancelling}>
              {cancelling ? '取消中…' : '取消'}
            </Button>
          </>
        ) : original !== null ? (
          <Button
            size={CONTROL_SIZE}
            appearance="subtle"
            icon={<ArrowUndoRegular />}
            onClick={restore}
            title="回到翻译前的原文"
          >
            还原
          </Button>
        ) : (
          <>
            <Button
              size={CONTROL_SIZE}
              icon={<TranslateRegular />}
              onClick={run}
              disabled={!value.trim()}
              title={notConfigured ? '管理员尚未配置翻译服务' : '翻译成所选语言'}
            >
              翻译
            </Button>
            <Dropdown
              size={CONTROL_SIZE}
              // 同 TranslateTab：不传受控 value 时 Dropdown 首帧显示不出文本
              value={langName}
              selectedOptions={[targetLang]}
              onOptionSelect={(_, d) => setLang(d.optionValue ?? 'zh')}
              placeholder="语言"
              title={`目标语言：${langName}`}
              // 按钮本身窄一点省空间，弹出列表给足宽度，避免长语言名被裁切
              style={{ minWidth: '96px', maxWidth: '116px' }}
              listbox={{ style: { minWidth: '150px' } }}
            >
              {langs.map((l) => (
                <Option key={l.code} value={l.code} text={l.name}>
                  {l.name}
                </Option>
              ))}
            </Dropdown>
          </>
        )}
      </div>
      {err && <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>{err}</span>}
    </div>
  );
}
