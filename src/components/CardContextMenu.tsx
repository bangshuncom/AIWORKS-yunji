// 通用右键菜单组件：包裹任意卡片，右键时显示菜单
import type { ReactElement } from 'react';
import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, tokens } from '@fluentui/react-components';

export interface ContextMenuItem {
  icon?: ReactElement;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface CardContextMenuProps {
  items: ContextMenuItem[];
  children: ReactElement;
}

export function CardContextMenu({ items, children }: CardContextMenuProps) {
  // 无可用操作（调用方按功能权限传空数组）时不渲染菜单，直接返回子元素
  if (items.length === 0) return children;

  return (
    <Menu openOnContext>
      <MenuTrigger>{children}</MenuTrigger>
      <MenuPopover>
        <MenuList>
          {items.map((item, i) => (
            <MenuItem
              key={i}
              icon={item.icon}
              onClick={item.onClick}
              style={item.danger ? { color: tokens.colorPaletteRedForeground1 } : undefined}
            >
              {item.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
