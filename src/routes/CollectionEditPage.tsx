// 合集编辑页：与文章编辑页同风格（工具栏 + 表单卡片 + Markdown 编辑器）
// 支持正文粘贴远程图片本地化、封面回退（后端：正文首图）
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Input,
  Label,
  Textarea,
  Dropdown,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowUploadRegular, DeleteRegular } from '@fluentui/react-icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  collectionApi,
  imageApi,
  resourceApi,
  authorApi,
  assetUrl,
  registerPendingAsset,
  listPendingAssets,
  clearPendingAsset,
} from '../lib/tauri';
import { errorText } from '../lib/errors';
import type { CreateCollection, AuthorInfo } from '../types/models';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { TranslateButton } from '../components/common/TranslateButton';
import { usePerms } from '../hooks/usePerms';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
});

export function CollectionEditPage() {
  const styles = useStyles();
  const { t } = useLanguage();
  const { cid } = useParams<{ cid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!cid;
  const cidNum = cid ? Number(cid) : NaN;

  const isAdmin = usePerms().isAdmin;
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [accessPassword, setAccessPassword] = useState('');
  // 服务端记录的密码状态：是否已设置（不回传密码本身）
  const [hasPassword, setHasPassword] = useState(false);
  // 本次保存是否{t('edit.clear')}访问密码
  const [clearPassword, setClearPassword] = useState(false);
  const [thumbnailPath, setThumbnailPath] = useState('');
  // 选中但尚未上传的本地封面（保存时才上传）
  const [pendingThumbnail, setPendingThumbnail] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(!isEdit);

  // 管理员马甲
  const { data: authors } = useQuery<AuthorInfo[]>({
    queryKey: ['authors'],
    queryFn: authorApi.list,
    enabled: isAdmin,
  });

  // 编辑模式加载合集
  const {
    data: collection,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['collection', cidNum],
    queryFn: () => collectionApi.get(cidNum),
    enabled: isEdit && !Number.isNaN(cidNum),
    retry: false,
  });

  useEffect(() => {
    if (isEdit && collection && !loaded) {
      setTitle(collection.title);
      setDescription(collection.description);
      setVisibility(collection.visibility);
      setHasPassword(!!collection.has_password);
      setThumbnailPath(collection.thumbnail_path);
      setContent(collection.content || '');
      setAuthorId(collection.user_id ?? null);
      setLoaded(true);
    }
  }, [isEdit, collection, loaded]);

  // Markdown 正文内选择图片/附件：仅注册本地暂存（插入占位符），保存时才上传
  const uploadContentAsset = async (kind: 'image' | 'file') => {
    const selected = await openDialog({
      multiple: false,
      filters:
        kind === 'image'
          ? [{ name: t('edit.filterImage'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
          : undefined,
    });
    if (typeof selected !== 'string') return null;
    const name = selected.split(/[\\/]/).pop() || 'file';
    const marker = registerPendingAsset(selected);
    return { path: marker, name };
  };

  const pickThumbnail = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: t('edit.filterImage'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (typeof selected === 'string') setPendingThumbnail(selected);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t('collectionEdit.nameRequired'));

      // 1. 上传正文内暂存的本地附件（替换 __pending__ 占位符）
      let finalContent = content;
      for (const [token, localPath] of listPendingAssets()) {
        const marker = `__pending__/${token}/file`;
        if (!finalContent.includes(marker)) {
          clearPendingAsset(token);
          continue;
        }
        const relPath = await resourceApi.uploadFile(localPath, 'content');
        finalContent = finalContent.split(marker).join(relPath);
        clearPendingAsset(token);
      }
      setContent(finalContent);

      const payload: CreateCollection = {
        title: title.trim(),
        description: description.trim(),
        visibility,
        access_password: accessPassword,
        clear_password: clearPassword || undefined,
        thumbnail_path: thumbnailPath,
        content: finalContent.trim(),
        author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
      };

      // 2. 新建合集拿到 id（封面随后上传）
      let savedId = cidNum;
      if (!isEdit) {
        savedId = await collectionApi.create(payload);
        // 3. 上传本地暂存封面
        if (pendingThumbnail) {
          const result = await imageApi.uploadCollectionImage(savedId, pendingThumbnail);
          payload.thumbnail_path = result.file_path;
          await collectionApi.update(savedId, payload);
        }
      } else {
        // 编辑：直接更新；有本地封面时先上传再更新
        if (pendingThumbnail) {
          const result = await imageApi.uploadCollectionImage(savedId, pendingThumbnail);
          payload.thumbnail_path = result.file_path;
        }
        await collectionApi.update(savedId, payload);
      }
      return savedId;
    },
    onSuccess: (savedId) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['collection', savedId ?? cidNum] });
      navigate(`/collection/${savedId ?? cidNum}`);
    },
    onError: (e: Error) => setError(e.message || t('edit.saveFailed')),
  });

  if (isEdit && isLoading) return <Spinner label={t('common.loading')} />;
  // 取数失败（如无查看权限）时不要一直转圈
  if (isEdit && !loaded) {
    if (loadError) {
      return (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(loadError) || t('collectionEdit.loadFailed')}</MessageBarBody>
        </MessageBar>
      );
    }
    return <Spinner label={t('common.loading')} />;
  }

  return (
    <div className={styles.container}>
      {/* 顶部工具栏 */}
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate(isEdit ? `/collection/${cidNum}` : '/collections')}
        >
          {t('detail.back')}
        </Button>
        <Button appearance="primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !title.trim()}>
          {saveMut.isPending ? t('edit.saving') : t('common.save')}
        </Button>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* 基本信息 */}
      <Card style={{ padding: '16px' }}>
        <div className={styles.field}>
          <Label htmlFor="title">{t('categories.nameRequired')}</Label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Input
              id="title"
              value={title}
              onChange={(_, d) => setTitle(d.value)}
              placeholder={t('collectionEdit.namePlaceholder')}
              style={{ flex: 1 }}
            />
            <TranslateButton value={title} onChange={setTitle} />
          </div>
        </div>
        <div className={styles.field}>
          <Label htmlFor="desc">{t('collectionEdit.description')}</Label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Textarea
              id="desc"
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              rows={2}
              placeholder={t('collectionEdit.descPlaceholder')}
              style={{ flex: 1 }}
            />
            <TranslateButton value={description} onChange={setDescription} />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <Label>{t('collectionEdit.visibility')}</Label>
            <Dropdown
              value={visibility === 'public' ? t('collectionEdit.public') : t('collectionEdit.private')}
              selectedOptions={[visibility]}
              onOptionSelect={(_, d) => {
                if (d.optionValue) setVisibility(d.optionValue);
              }}
            >
              <Option value="private" text={t('collectionEdit.private')}>
                {t('collectionEdit.private')}
              </Option>
              <Option value="public" text={t('collectionEdit.public')}>
                {t('collectionEdit.public')}
              </Option>
            </Dropdown>
          </div>
          {isAdmin && (
            <div className={styles.field}>
              <Label>{t('edit.authorMask')}</Label>
              <Dropdown
                value={
                  authorId == null
                    ? t('edit.currentAccount')
                    : authors?.find((a) => a.id === authorId)
                      ? `${authors.find((a) => a.id === authorId)!.nickname || authors.find((a) => a.id === authorId)!.username}`
                      : t('edit.unknownUser', { id: authorId })
                }
                selectedOptions={[String(authorId ?? 'me')]}
                onOptionSelect={(_, d) => {
                  const v = d.optionValue;
                  setAuthorId(v === 'me' ? null : Number(v));
                }}
              >
                <Option value="me" text={t('edit.currentAccount')}>
                  {t('edit.currentAccount')}
                </Option>
                {authors?.map((a) => (
                  <Option key={a.id} value={String(a.id)} text={a.nickname || a.username}>
                    {a.nickname || a.username}
                  </Option>
                ))}
              </Dropdown>
            </div>
          )}
        </div>
        <div className={styles.field}>
          <Label htmlFor="pwd">{t('edit.accessPassword')}</Label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Input
              id="pwd"
              type="password"
              placeholder={hasPassword ? t('edit.pwdSetLeaveEmpty') : t('edit.pwdEmpty')}
              value={accessPassword}
              onChange={(_, d) => {
                setAccessPassword(d.value);
                setClearPassword(false);
              }}
            />
            {hasPassword && (
              <Button
                appearance="outline"
                onClick={() => {
                  setClearPassword(!clearPassword);
                  setAccessPassword('');
                }}
              >
                {clearPassword ? t('edit.undoClearPwd') : t('edit.clearPwd')}
              </Button>
            )}
          </div>
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {clearPassword
              ? t('collectionEdit.pwdClearHint')
              : accessPassword
                ? t('collectionEdit.pwdSetNewHint')
                : hasPassword
                  ? t('collectionEdit.pwdKeepHint')
                  : visibility === 'public'
                    ? t('collectionEdit.pwdPublicHint')
                    : t('collectionEdit.pwdPrivateHint')}
          </span>
        </div>
        <div className={styles.field}>
          <Label>{t('collectionEdit.cover')}</Label>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {pendingThumbnail || thumbnailPath ? (
              <img
                style={{
                  width: '160px',
                  height: '90px',
                  objectFit: 'cover',
                  borderRadius: '6px',
                  backgroundColor: tokens.colorNeutralBackground3,
                }}
                src={pendingThumbnail ? convertFileSrc(pendingThumbnail) : assetUrl(thumbnailPath)}
                alt={t('collectionEdit.cover')}
              />
            ) : (
              <div
                style={{
                  width: '160px',
                  height: '90px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  backgroundColor: tokens.colorNeutralBackground3,
                  color: tokens.colorNeutralForeground3,
                  fontSize: '12px',
                }}
              >
                {t('collectionEdit.coverNone')}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <Button appearance="outline" size="small" icon={<ArrowUploadRegular />} onClick={pickThumbnail}>
                {pendingThumbnail || thumbnailPath ? t('collectionEdit.changeCover') : t('collectionEdit.uploadCover')}
              </Button>
              {(pendingThumbnail || thumbnailPath) && (
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DeleteRegular />}
                  onClick={() => {
                    setPendingThumbnail(null);
                    setThumbnailPath('');
                  }}
                >
                  {t('edit.clear')}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <Label>{t('collectionEdit.contentLabel')}</Label>
            <TranslateButton value={content} onChange={setContent} />
          </div>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            height={480}
            placeholder={t('collectionEdit.contentPlaceholder')}
            upload={uploadContentAsset}
          />
        </div>
      </Card>
    </div>
  );
}
