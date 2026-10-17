// 资源批量操作组件：状态/可见性/{t('auth.password')}/分类/{t('filter.collection')}，放入 BatchBar 的 children
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
import { ShieldRegular, KeyRegular, BoxRegular, PeopleRegular } from '@fluentui/react-icons';
import { resourceApi, collectionApi, categoryApi, authorApi } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import { invalidateArticleData } from '../lib/invalidate';
import type { Collection, Category, AuthorInfo } from '../types/models';
import type { SelectionController } from './Selection';
import { CategoryTreeSelect } from './CategoryTreeSelect';
import { useLanguage } from '../i18n';

interface BatchResourceOpsProps {
  selection: SelectionController;
}

export function BatchResourceOps({ selection }: BatchResourceOpsProps) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
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
    // 批量改分类/{t('filter.collection')}/{t('filter.author')}/{t('edit.readPermission')}都会影响各处的计数与列表，统一失效
    invalidateArticleData(queryClient);
  };

  const batchUpdateMut = useMutation({
    mutationFn: (payload: Parameters<typeof resourceApi.batchUpdate>[0]) => resourceApi.batchUpdate(payload),
    onSuccess: invalidate,
  });

  const doBatchUpdate = async (payload: Omit<Parameters<typeof resourceApi.batchUpdate>[0], 'ids'>, msg: string) => {
    if (!(await confirmDanger(msg))) return;
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
      {/* {t('edit.readPermission')} */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<ShieldRegular />}>
            {t('edit.readPermission')}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => doBatchUpdate({ read_level: 0 }, t('batch.setPublic', { n: ids.length }))}>
              0 - {t('edit.readLevel.public')}
            </MenuItem>
            {[1, 2, 3, 4, 5].map((n) => (
              <MenuItem
                key={n}
                onClick={() => doBatchUpdate({ read_level: n }, t('batch.setLevel', { n: ids.length, level: n }))}
              >
                {n} - {t('edit.readLevel.need', { level: n })}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>

      {/* {t('auth.password')} */}
      <Button
        {...btnProps}
        icon={<KeyRegular />}
        onClick={() => {
          setPwdValue('');
          setPwdOpen(true);
        }}
      >
        {t('auth.password')}
      </Button>
      <Dialog open={pwdOpen} onOpenChange={(_, d) => setPwdOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('batch.setPwdTitle', { n: ids.length })}</DialogTitle>
            <DialogContent>
              <Input
                placeholder={t('batch.pwdPlaceholder')}
                value={pwdValue}
                onChange={(_, d) => setPwdValue(d.value)}
                type="password"
                style={{ width: '100%' }}
              />
            </DialogContent>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button appearance="subtle" onClick={() => setPwdOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                appearance="primary"
                onClick={async () => {
                  setPwdOpen(false);
                  await doBatchUpdate(
                    { access_password: pwdValue },
                    pwdValue
                      ? t('batch.setPwdConfirm', { n: ids.length })
                      : t('batch.clearPwdConfirm', { n: ids.length }),
                  );
                }}
              >
                {t('batch.confirm')}
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
            id != null
              ? t('batch.setCategoryConfirm', { n: ids.length })
              : t('batch.clearCategoryConfirm', { n: ids.length }),
          );
        }}
        placeholder={t('batch.changeCategory')}
        emptyLabel={t('batch.clearCategory')}
        showCount
        size="small"
        style={{ minWidth: 0 }}
      />

      {/* {t('filter.collection')} */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<BoxRegular />}>
            {t('filter.collection')}
          </Button>
        </MenuTrigger>
        <MenuPopover style={{ minWidth: '220px', maxHeight: '360px' }}>
          <MenuList>
            {collections?.map((c) => (
              <MenuItem
                key={c.id}
                onClick={() =>
                  doBatchUpdate(
                    { add_collection_id: c.id },
                    t('batch.addCollectionConfirm', { n: ids.length, title: c.title }),
                  )
                }
              >
                {c.title} ({c.resource_count ?? 0})
              </MenuItem>
            ))}
            {(!collections || collections.length === 0) && <MenuItem disabled>{t('batch.noCollections')}</MenuItem>}
          </MenuList>
        </MenuPopover>
      </Menu>

      {/* 修改{t('filter.author')}（含清除{t('filter.author')}） */}
      <Menu>
        <MenuTrigger>
          <Button {...btnProps} icon={<PeopleRegular />}>
            {t('filter.author')}
          </Button>
        </MenuTrigger>
        <MenuPopover style={{ minWidth: '220px', maxHeight: '360px' }}>
          <MenuList>
            <MenuItem
              onClick={() => doBatchUpdate({ user_id: null }, t('batch.clearAuthorConfirm', { n: ids.length }))}
            >
              {t('batch.clearAuthor')}
            </MenuItem>
            {authors?.map((a) => (
              <MenuItem
                key={a.id}
                onClick={() =>
                  doBatchUpdate(
                    { user_id: a.id },
                    t('batch.setAuthorConfirm', { n: ids.length, name: a.nickname || a.username }),
                  )
                }
              >
                {a.nickname || a.username} ({a.resource_count} {t('list.unit.article')})
              </MenuItem>
            ))}
            {(!authors || authors.length === 0) && <MenuItem disabled>{t('batch.noAuthors')}</MenuItem>}
          </MenuList>
        </MenuPopover>
      </Menu>

      {busy && <Spinner size="tiny" />}
    </>
  );
}
