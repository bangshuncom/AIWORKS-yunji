// 侧边导航栏
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Avatar,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuList,
  MenuItem,
  MenuPopover,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
// tokens is also used in inline styles of CategoryNavItem
import {
  HomeRegular,
  TagRegular,
  FolderRegular,
  AppsRegular,
  DeleteRegular,
  SettingsRegular,
  AddRegular,
  PersonRegular,
  ArrowExitRegular,
  FolderRegular as FolderIcon,
  FolderOpenRegular,
  DocumentRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  PeopleRegular,
  CubeRegular,
} from '@fluentui/react-icons';
import { useAuthStore } from '../../stores/authStore';
import { usePerms } from '../../hooks/usePerms';
import { settingsApi, categoryApi, assetUrl } from '../../lib/tauri';
import type { Category } from '../../types/models';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '220px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: 100,
  },
  // 头部区域
  header: {
    padding: '20px 16px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brand: {
    fontSize: '20px',
    fontWeight: 700,
    cursor: 'pointer',
    userSelect: 'none',
    color: tokens.colorBrandForeground1,
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '30px',
  },
  logoRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  logoIcon: {
    fontSize: '24px',
    color: tokens.colorBrandForeground1,
  },
  logoIconImg: {
    height: '24px',
    width: '24px',
    objectFit: 'contain' as const,
    borderRadius: '4px',
    flexShrink: 0,
  },
  // 图片 LOGO：铺满整个左上角头部区域
  headerImage: {
    padding: 0,
  },
  brandImage: {
    display: 'block',
    width: '100%',
    height: '64px',
    cursor: 'pointer',
  },
  logoImageFull: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },
  // 导航区域
  nav: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '8px 0',
  },
  navTop: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '0 8px',
  },
  navBottom: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '0 8px',
  },
  sectionLabel: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '8px 12px 4px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    color: tokens.colorNeutralForeground1,
    textDecoration: 'none',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    transition: 'background 0.15s',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  navItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: 600,
    '&:hover': {
      backgroundColor: tokens.colorBrandBackground2Hover,
    },
  },
  navItemIcon: {
    fontSize: '18px',
    flexShrink: 0,
  },
  navItemText: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  navItemCount: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '10px',
    padding: '1px 8px',
    minWidth: '20px',
    textAlign: 'center',
  },
  // 底部区域
  footer: {
    padding: '12px 8px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export function Navbar() {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { isAdmin, can } = usePerms();
  const canArticle = can('article_own');
  const canTrash = can('trash');
  const canUser = can('user');
  const canSettings = isAdmin || canUser;
  // 公开设置：站点名称 / LOGO 模式（与 usePerms 共享缓存，设置保存后自动刷新）
  const { data: pubSettings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: settingsApi.getPublic,
    staleTime: 30_000,
  });
  const siteName = pubSettings?.site_name || '云记';
  const logoMode = pubSettings?.logo_mode || 'text';
  const logoImage = pubSettings?.logo_image_path || '';
  const logoIcon = pubSettings?.logo_icon_path || '';

  // 与 ListPage 共享 categories-tree 缓存
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-tree'],
    queryFn: categoryApi.listTree,
  });

  const currentPath = location.pathname;
  // 当前处于某分类的筛选视图时，"全部"不再高亮
  const isCategoryView = new URLSearchParams(location.search).has('category');

  const NavItem = ({
    icon,
    label,
    path,
    onClick,
    count,
    active,
  }: {
    icon: React.ReactNode;
    label: string;
    path?: string;
    onClick?: () => void;
    count?: number;
    /** 覆盖默认的 pathname 判断 */
    active?: boolean;
  }) => {
    const isActive = active ?? (path != null && currentPath === path);
    return (
      <button
        className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
        onClick={onClick ?? (() => path && navigate(path))}
      >
        <span className={styles.navItemIcon}>{icon}</span>
        <span className={styles.navItemText}>{label}</span>
        {count != null && count > 0 && <span className={styles.navItemCount}>{count}</span>}
      </button>
    );
  };

  return (
    <nav className={styles.root}>
      {/* 头部区域 - LOGO */}
      {logoMode === 'image' && logoImage ? (
        <div className={`${styles.header} ${styles.headerImage}`}>
          <div className={styles.brandImage} onClick={() => navigate('/')} title={siteName}>
            <img className={styles.logoImageFull} src={assetUrl(logoImage)} alt={siteName} />
          </div>
        </div>
      ) : (
        <div className={styles.header}>
          <div className={styles.brand} onClick={() => navigate('/')} title={siteName}>
            {logoMode === 'icon_text' ? (
              <span className={styles.logoRow}>
                {logoIcon ? (
                  <img className={styles.logoIconImg} src={assetUrl(logoIcon)} alt="" />
                ) : (
                  <CubeRegular className={styles.logoIcon} />
                )}
                <span>{siteName}</span>
              </span>
            ) : (
              siteName
            )}
          </div>
        </div>
      )}

      {/* 导航区域 */}
      <div className={styles.nav}>
        {/* 上半部分：一级分类 */}
        <div className={styles.navTop}>
          <NavItem icon={<HomeRegular />} label="全部" path="/" active={currentPath === '/' && !isCategoryView} />
          {categories.map((cat) => (
            <CategoryNavItem key={cat.id} cat={cat} level={0} />
          ))}
        </div>

        {/* 下半部分：合集/标签/回收站 */}
        <div className={styles.navBottom}>
          <NavItem icon={<FolderRegular />} label="合集" path="/collections" />
          <NavItem icon={<TagRegular />} label="标签" path="/tags" />
          <NavItem icon={<PeopleRegular />} label="作者" path="/authors" />
          {canTrash && <NavItem icon={<DeleteRegular />} label="回收站" path="/trash" />}
        </div>
      </div>

      {/* 底部区域 - 登录/用户按钮 */}
      <div className={styles.footer}>
        {user ? (
          <Menu positioning={{ position: 'above' }}>
            <MenuTrigger>
              <MenuButton
                appearance="transparent"
                icon={
                  <Avatar
                    name={user.nickname || user.username}
                    size={28}
                    image={user.avatar_path ? { src: assetUrl(user.avatar_path) } : undefined}
                  />
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '8px 12px' }}
              >
                {user.nickname || user.username}
              </MenuButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {canArticle && (
                  <MenuItem icon={<AddRegular />} onClick={() => navigate('/edit')}>
                    新建文章
                  </MenuItem>
                )}
                {canArticle && (
                  <MenuItem icon={<AppsRegular />} onClick={() => navigate('/categories')}>
                    分类管理
                  </MenuItem>
                )}
                <MenuItem icon={<PersonRegular />} onClick={() => navigate('/profile')}>
                  个人资料
                </MenuItem>
                {canSettings && (
                  <MenuItem icon={<SettingsRegular />} onClick={() => navigate('/admin')}>
                    系统设置
                  </MenuItem>
                )}
                <MenuItem
                  icon={<ArrowExitRegular />}
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  退出登录
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        ) : (
          <Button
            appearance="outline"
            icon={<PersonRegular />}
            onClick={() => navigate('/login')}
            style={{ width: '100%' }}
          >
            登录
          </Button>
        )}
      </div>
    </nav>
  );
}

// 递归渲染分类导航项
function CategoryNavItem({ cat, level }: { cat: Category; level: number }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!(cat.children && cat.children.length > 0);
  const catPath = `/?category=${cat.id}`;
  const isActive = location.search === `?category=${cat.id}`;

  return (
    <div>
      <div
        className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        <span
          className={styles.navItemIcon}
          style={{
            cursor: 'pointer',
            fontSize: '16px',
            color: isActive ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3,
          }}
          onClick={() => navigate(catPath)}
        >
          {hasChildren ? expanded ? <FolderOpenRegular /> : <FolderIcon /> : <DocumentRegular />}
        </span>
        <span className={styles.navItemText} style={{ cursor: 'pointer' }} onClick={() => navigate(catPath)}>
          {cat.name}
        </span>
        {cat.resource_count != null && cat.resource_count > 0 && (
          <span className={styles.navItemCount}>{cat.resource_count}</span>
        )}
        {hasChildren && (
          <span
            style={{
              cursor: 'pointer',
              width: '16px',
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
              color: tokens.colorNeutralForeground3,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />}
          </span>
        )}
      </div>
      {hasChildren &&
        expanded &&
        cat.children!.map((child) => <CategoryNavItem key={child.id} cat={child} level={level + 1} />)}
    </div>
  );
}
