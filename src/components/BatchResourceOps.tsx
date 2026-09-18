// 资源批量操作组件：状态/可见性/密码/分类/合集，放入 BatchBar 的 children
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  Input,
  Spinner,
} from '@fluentui/react-components';
import {
  ShieldRegular,
  KeyRegular,
  BoxRegular,
  PeopleRegular,
} from '@fluentui/react-icons';
import { resourceApi, collectionApi, categoryApi, authorApi } from '../lib/tauri';
import type { Collection, Category, AuthorInfo } from '../types/models';
import type { SelectionController } from './batch';
import { CategoryTreeSelect } from './CategoryTreeSelect';

interface BatchResourceOpsProps {
  selection: SelectionController;
}

export function BatchResourceOps({ selection }: BatchResourceOpsProps) {
  const queryClient = useQueryClient();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdValue, setPwdValue] = useState('');
  const [busy, setBusy] = useState(false);

  const ids = Array.from(selection.selected);

  const { data: collections } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });
  const { data: categoriesTree } = useQuery<Category[]>({
    queryKey: ['categories-tree'],
    queryFn: categoryApi.listTree,
  });
  const { data: authors } = useQuery<AuthorInfo[]>({
    queryKey: ['authors'],
    queryFn: authorApi.list,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['collections'] });
  };

  const batchUpdateMut = useMutation({
    mutationFn: (payload: Parameters<typeof resourceApi.batchUpdate>[0]) =>
      resourceApi.batchUpdate(payload),
    onSuccess: invalidate,
  });

  const doBatchUpdate = async (
    payload: Omit<Parameters<typeof resourceApi.batchUpdate>[0], 'ids'>,
    msg: string,
  ) => {
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await batchUpdateMut.mutateAsync({ ...payload, ids });
      selection.clear();
    } finally {
      setBusy(false);
    }
  };

  const btnProps = { appearance: 'outline' as const, size: 'small' as const, disabled: busy };

  return (
    <>
      {/* 阅读权限 */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<ShieldRegular />}>阅读权限</Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => doBatchUpdate({ read_level: 0 }, `将 ${ids.length} 项设为公开（无需登录）？`)}>
              0 - 公开（无需登录）
            </MenuItem>
            {[1, 2, 3, 4, 5].map((n) => (
              <MenuItem
                key={n}
                onClick={() => doBatchUpdate({ read_level: n }, `将 ${ids.length} 项阅读权限设为 ${n}（需权限 ${n} 及以上）？`)}
              >
                {n} - 需权限 {n} 及以上
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>

      {/* 密码 */}
      <Button
        {...btnProps}
        icon={<KeyRegular />}
        onClick={() => {
          setPwdValue('');
          setPwdOpen(true);
        }}
      >
        密码
      </Button>
      <Dialog open={pwdOpen} onOpenChange={(_, d) => setPwdOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>设置访问密码（{ids.length} 项）</DialogTitle>
            <DialogContent>
              <Input
                placeholder="输入密码，留空则清除密码"
                value={pwdValue}
                onChange={(_, d) => setPwdValue(d.value)}
                type="password"
                style={{ width: '100%' }}
              />
            </DialogContent>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button appearance="subtle" onClick={() => setPwdOpen(false)}>取消</Button>
              <Button
                appearance="primary"
                onClick={async () => {
                  setPwdOpen(false);
                  await doBatchUpdate(
                    { access_password: pwdValue },
                    pwdValue ? `为 ${ids.length} 项设置访问密码？` : `清除 ${ids.length} 项的访问密码？`,
                  );
                }}
              >
                确定
              </Button>
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 分类（与编辑页统一使用树形层级选择） */}
      <CategoryTreeSelect
        categories={categoriesTree}
        value={null}
        onChange={(id) => {
          doBatchUpdate(
            { category_id: id },
            id != null ? `将 ${ids.length} 项分类修改为此分类？` : `清除 ${ids.length} 项的分类？`,
          );
        }}
        placeholder="修改分类"
        emptyLabel="清除分类"
        showCount
        size="small"
        style={{ minWidth: 0 }}
      />

      {/* 合集 */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<BoxRegular />}>合集</Button>
        </MenuTrigger>
        <MenuPopover style={{ minWidth: '220px', maxHeight: '360px' }}>
          <MenuList>
            {collections?.map((c) => (
              <MenuItem
                key={c.id}
                onClick={() => doBatchUpdate({ add_collection_id: c.id }, `将 ${ids.length} 项加入「${c.title}」？`)}
              >
                {c.title} ({c.resource_count ?? 0})
              </MenuItem>
            ))}
            {(!collections || collections.length === 0) && (
              <MenuItem disabled>暂无合集</MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>

      {/* 修改作者（含清除作者） */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<PeopleRegular />}>作者</Button>
        </MenuTrigger>
        <MenuPopover style={{ minWidth: '220px', maxHeight: '360px' }}>
          <MenuList>
            <MenuItem
              onClick={() => doBatchUpdate({ user_id: null }, `清除 ${ids.length} 项的作者（变为无作者）？`)}
            >
              清除作者（无作者）
            </MenuItem>
            {authors?.map((a) => (
              <MenuItem
                key={a.id}
                onClick={() => doBatchUpdate(
                  { user_id: a.id },
                  `将 ${ids.length} 项作者改为「${a.nickname || a.username}」？`,
                )}
              >
                {a.nickname || a.username} ({a.resource_count} 篇)
              </MenuItem>
            ))}
            {(!authors || authors.length === 0) && (
              <MenuItem disabled>暂无作者</MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>

      {busy && <Spinner size="tiny" />}
    </>
  );
}
