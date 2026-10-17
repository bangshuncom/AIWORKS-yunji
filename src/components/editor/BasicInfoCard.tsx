// 编辑页基本信息卡片：标题 / 描述 / 正文 / 标签
// 缩略图、阅读权限、马甲、分类、合集、访问密码都在 EditPage 的「元数据」卡片里
import { useMemo } from 'react';
import { Card, Input, Label, Textarea, tokens } from '@fluentui/react-components';
import { MarkdownEditor, type UploadedAsset } from '../MarkdownEditor';
import { TranslateButton } from '../common/TranslateButton';
import { PillPicker, type PillOption } from './PillPicker';
import type { Tag } from '../../types/models';
import { useStyles, CARD_STYLE, normalizeTagInput } from './shared';
import { useComposingInput } from '../../hooks/useComposingInput';
import { useLanguage } from '../../i18n';

export interface BasicInfoValues {
  title: string;
  description: string;
  content: string;
  tagIds: number[];
  newTagNames: string;
}

export function BasicInfoCard({
  values,
  onChange,
  tags,
  uploadContentAsset,
}: {
  values: BasicInfoValues;
  onChange: (patch: Partial<BasicInfoValues>) => void;
  tags: Tag[] | undefined;
  uploadContentAsset: (kind: 'image' | 'file') => Promise<UploadedAsset | null>;
}) {
  const styles = useStyles();
  const { t } = useLanguage();
  // 输入法组词保护：见 useComposingInput 的说明，组词期间不改写输入内容
  const composing = useComposingInput();

  const tagOptions = useMemo<PillOption[]>(
    () => (tags ?? []).map((tag) => ({ id: tag.id, label: tag.name, count: tag.count })),
    [tags],
  );

  // 输入框里填的、且当前不存在的标签名——只统计真正会新建的，已存在的会被复用
  const newTagList = useMemo(() => {
    const known = new Set((tags ?? []).map((tag) => tag.name));
    return values.newTagNames
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !known.has(s));
  }, [tags, values.newTagNames]);

  return (
    <Card style={CARD_STYLE}>
      <div className={styles.field}>
        <Label htmlFor="title">{t('basicInfo.title')}</Label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <Input
            id="title"
            value={values.title}
            onChange={(_, d) => onChange({ title: d.value })}
            style={{ flex: 1 }}
          />
          <TranslateButton value={values.title} onChange={(v) => onChange({ title: v })} />
        </div>
      </div>
      <div className={styles.field}>
        <Label htmlFor="desc">{t('itemsCard.description')}</Label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <Textarea
            id="desc"
            value={values.description}
            onChange={(_, d) => onChange({ description: d.value })}
            rows={2}
            style={{ flex: 1 }}
          />
          <TranslateButton value={values.description} onChange={(v) => onChange({ description: v })} />
        </div>
      </div>
      <div className={styles.field}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <Label>{t('basicInfo.content')}</Label>
          <TranslateButton value={values.content} onChange={(v) => onChange({ content: v })} />
        </div>
        <MarkdownEditor
          value={values.content}
          onChange={(v) => onChange({ content: v })}
          height={480}
          placeholder={t('basicInfo.contentPlaceholder')}
          upload={uploadContentAsset}
        />
      </div>
      {/* 标签：常用标签直接点选，搜索框实时过滤；新建仍走单行输入 */}
      <div className={styles.field}>
        <Label>{t('basicInfo.tags')}</Label>
        <PillPicker
          options={tagOptions}
          selectedIds={values.tagIds}
          onChange={(ids) => onChange({ tagIds: ids })}
          searchPlaceholder={t('basicInfo.searchTag')}
          emptyHint={t('basicInfo.noTags')}
          noMatchHint={t('basicInfo.noMatchTags')}
        />
        <Input
          placeholder={t('basicInfo.newTagPlaceholder')}
          value={values.newTagNames}
          onChange={(_, d) => onChange({ newTagNames: composing.transform(d.value, normalizeTagInput) })}
          onCompositionStart={composing.onCompositionStart}
          onCompositionEnd={(ev) => {
            composing.onCompositionEnd();
            onChange({ newTagNames: normalizeTagInput(ev.currentTarget.value) });
          }}
        />
        {newTagList.length > 0 && (
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {t('basicInfo.willCreate', { n: newTagList.length, names: newTagList.join('、') })}
          </span>
        )}
      </div>
    </Card>
  );
}
