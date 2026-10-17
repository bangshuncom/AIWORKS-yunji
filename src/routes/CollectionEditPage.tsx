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

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
});

export function CollectionEditPage() {
  const styles = useStyles();
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
  // 本次保存是否清除访问密码
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
      filters: kind === 'image' ? [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] : undefined,
    });
    if (typeof selected !== 'string') return null;
    const name = selected.split(/[\\/]/).pop() || 'file';
    const marker = registerPendingAsset(selected);
    return { path: marker, name };
  };

  const pickThumbnail = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (typeof selected === 'string') setPendingThumbnail(selected);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('请填写合集名称');

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
    onError: (e: Error) => setError(e.message || '保存失败'),
  });

  if (isEdit && isLoading) return <Spinner label="加载中..." />;
  // 取数失败（如无查看权限）时不要一直转圈
  if (isEdit && !loaded) {
    if (loadError) {
      return (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(loadError) || '加载合集失败'}</MessageBarBody>
        </MessageBar>
      );
    }
    return <Spinner label="加载中..." />;
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
          返回
        </Button>
        <Button appearance="primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !title.trim()}>
          {saveMut.isPending ? '保存中...' : '保存'}
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
          <Label htmlFor="title">名称 *</Label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Input
              id="title"
              value={title}
              onChange={(_, d) => setTitle(d.value)}
              placeholder="合集名称"
              style={{ flex: 1 }}
            />
            <TranslateButton value={title} onChange={setTitle} />
          </div>
        </div>
        <div className={styles.field}>
          <Label htmlFor="desc">描述</Label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Textarea
              id="desc"
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              rows={2}
              placeholder="可选描述"
              style={{ flex: 1 }}
            />
            <TranslateButton value={description} onChange={setDescription} />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <Label>可见性</Label>
            <Dropdown
              value={visibility === 'public' ? '公开' : '私有'}
              selectedOptions={[visibility]}
              onOptionSelect={(_, d) => {
                if (d.optionValue) setVisibility(d.optionValue);
              }}
            >
              <Option value="private" text="私有">
                私有
              </Option>
              <Option value="public" text="公开">
                公开
              </Option>
            </Dropdown>
          </div>
          {isAdmin && (
            <div className={styles.field}>
              <Label>发布身份（马甲）</Label>
              <Dropdown
                value={
                  authorId == null
                    ? '当前账号'
                    : authors?.find((a) => a.id === authorId)
                      ? `${authors.find((a) => a.id === authorId)!.nickname || authors.find((a) => a.id === authorId)!.username}`
                      : `用户 #${authorId}`
                }
                selectedOptions={[String(authorId ?? 'me')]}
                onOptionSelect={(_, d) => {
                  const v = d.optionValue;
                  setAuthorId(v === 'me' ? null : Number(v));
                }}
              >
                <Option value="me" text="当前账号">
                  当前账号
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
          <Label htmlFor="pwd">访问密码</Label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Input
              id="pwd"
              type="password"
              placeholder={hasPassword ? '已设置密码，留空则不修改' : '留空 = 不设密码'}
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
                {clearPassword ? '撤销清除' : '清除密码'}
              </Button>
            )}
          </div>
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {clearPassword
              ? '保存后清除访问密码'
              : accessPassword
                ? '保存后设为新的访问密码，读者需凭密码查看'
                : hasPassword
                  ? '已设置访问密码，留空则保持不变（作者本人与管理员不受密码限制）'
                  : visibility === 'public'
                    ? '提示：公开且不设密码 = 任何人（包括未登录用户）可访问'
                    : '提示：私有合集仅作者本人、管理员，或凭密码解锁后可访问'}
          </span>
        </div>
        <div className={styles.field}>
          <Label>封面</Label>
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
                alt="封面"
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
                无（保存时取正文首图）
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <Button appearance="outline" size="small" icon={<ArrowUploadRegular />} onClick={pickThumbnail}>
                {pendingThumbnail || thumbnailPath ? '更换封面' : '上传封面'}
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
                  清除
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <Label>正文（Markdown，支持粘贴图片自动本地化）</Label>
            <TranslateButton value={content} onChange={setContent} />
          </div>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            height={480}
            placeholder="在此输入合集介绍正文..."
            upload={uploadContentAsset}
          />
        </div>
      </Card>
    </div>
  );
}
