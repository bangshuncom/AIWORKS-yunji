// 作者列表页：展示有文章的作者，点击进入该作者的文章列表
// 有用户管理权限者可右键编辑/删除作者（编辑弹窗复用 UserEditDialog，同设置-用户管理）
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { PeopleRegular, EditRegular, DeleteRegular } from '@fluentui/react-icons';
import { authorApi, userApi, assetUrl } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import { usePerms } from '../hooks/usePerms';
import { CardContextMenu } from '../components/CardContextMenu';
import { UserEditDialog } from '../components/UserEditDialog';
import { Pagination } from '../components/Pagination';
import { useSharedStyles } from '../styles/shared';
import { useAuthStore } from '../stores/authStore';
import type { AuthorInfo, AdminUser } from '../types/models';
import { useLanguage } from '../i18n';

const PAGE_SIZE = 36;

const useStyles = makeStyles({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  authorCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    transition: 'background 0.15s',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  bio: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: '2px',
  },
});

export function AuthorsPage() {
  const s = useSharedStyles();
  const styles = useStyles();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canUser = usePerms().can('user');
  const currentUserId = useAuthStore((st) => st.user?.id);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['authors', 'paged', page],
    queryFn: () => authorApi.listPage(page, PAGE_SIZE),
  });

  const authors = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['authors'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  // 删除作者（复用用户删除，后端自动跳过自己/管理员）
  const deleteMut = useMutation({
    mutationFn: (id: number) => userApi.deleteMany([id]),
    onSuccess: (res) => {
      invalidate();
      if (res.deleted === 0) {
        setMsg({ ok: false, text: t('authors.cannotDeleteSelfOrAdmin') });
      } else {
        setMsg({ ok: true, text: t('authors.deleted') });
      }
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('authors.deleteFailed') }),
  });

  // 编辑前拉取完整用户信息（AuthorInfo 缺 email/permission_level 等字段）
  const openEdit = async (a: AuthorInfo) => {
    setMsg(null);
    try {
      const list = await userApi.list();
      const full = list.find((u) => u.id === a.id);
      if (!full) {
        setMsg({ ok: false, text: t('authors.userNotFound') });
        return;
      }
      setEditTarget(full);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || t('authors.loadUserFailed') });
    }
  };

  const handleDelete = async (a: AuthorInfo) => {
    const name = a.nickname || a.username;
    // 第一层确认（先弹，不依赖异步请求）
    if (!(await confirmDanger(t('authors.deleteConfirm', { name })))) return;
    try {
      // 初始 admin 删除权限 5 目标：二次确认；查询失败不阻断，后端会做最终过滤
      const all = await userApi.list();
      const full = all.find((u) => u.id === a.id);
      if (full && (full.is_admin || full.permission_level >= 5)) {
        const adminIds = all.filter((u) => u.is_admin).map((u) => u.id);
        if (adminIds.length > 0 && currentUserId === Math.min(...adminIds)) {
          if (!(await confirmDanger(t('authors.deleteAdminConfirm', { name })))) return;
        }
      }
    } catch {
      // 忽略，交给后端过滤
    }
    deleteMut.mutate(a.id);
  };

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>{t('authors.title')}</h2>
      </div>

      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? t('common.success') : t('common.fail')}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : authors.length === 0 ? (
        <div className={s.emptyState}>
          <PeopleRegular fontSize={36} />
          <p>{t('authors.empty')}</p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {authors.map((a) => {
              const name = a.nickname || a.username;
              return (
                <CardContextMenu
                  key={a.id}
                  items={
                    canUser && a.id !== currentUserId
                      ? [
                          {
                            icon: <EditRegular />,
                            label: t('common.edit'),
                            onClick: () => openEdit(a),
                          },
                          {
                            icon: <DeleteRegular />,
                            label: t('common.delete'),
                            danger: true,
                            onClick: () => handleDelete(a),
                          },
                        ]
                      : []
                  }
                >
                  <div
                    className={styles.authorCard}
                    onClick={() => navigate(`/?author=${a.id}`)}
                    title={t('authors.viewAllArticles', { name })}
                  >
                    <Avatar
                      size={48}
                      name={name}
                      image={a.avatar_path ? { src: assetUrl(a.avatar_path) } : undefined}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </strong>
                        <Badge appearance="tint" color="brand">
                          {a.resource_count} {t('list.unit.article')}
                        </Badge>
                      </div>
                      {a.bio && <div className={styles.bio}>{a.bio}</div>}
                    </div>
                  </div>
                </CardContextMenu>
              );
            })}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
        </>
      )}

      {/* 编辑用户对话框（与设置-用户管理共用同一组件） */}
      <UserEditDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onChanged={() => setMsg({ ok: true, text: t('authors.saved') })}
      />
    </div>
  );
}
