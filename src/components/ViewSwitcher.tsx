// 视图切换器 + 主题切换（浮动在内容区右下角）
import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Tooltip } from '@fluentui/react-components';
import {
  AppsListRegular,
  GridRegular,
  GridDotsRegular,
  TextBulletListRegular,
  WeatherSunnyRegular,
  WeatherMoonRegular,
} from '@fluentui/react-icons';
import { useUIStore, type ViewMode } from '../stores/uiStore';
import { useSharedStyles } from '../styles/shared';
import { useLanguage } from '../i18n';

const VIEW_MODES: { mode: ViewMode; icon: ReactElement; labelKey: string }[] = [
  { mode: 'masonry', icon: <GridDotsRegular />, labelKey: 'view.masonry' },
  { mode: 'card-v', icon: <GridRegular />, labelKey: 'view.cardV' },
  { mode: 'card-h', icon: <AppsListRegular />, labelKey: 'view.cardH' },
  { mode: 'table', icon: <TextBulletListRegular />, labelKey: 'view.table' },
];

export function ViewSwitcher() {
  const s = useSharedStyles();
  const { viewMode, setViewMode, theme, toggleTheme } = useUIStore();
  const location = useLocation();
  const { t } = useLanguage();
  // 仅在支持多视图的文章列表页（全部列表、回收站）显示视图切换按钮
  const showViewModes = location.pathname === '/' || location.pathname === '/trash';

  return (
    <div className={s.viewSwitcher}>
      {showViewModes &&
        VIEW_MODES.map(({ mode, icon, labelKey }) => (
          <Tooltip key={mode} content={t(labelKey)} relationship="label">
            <Button
              icon={icon}
              size="small"
              appearance="subtle"
              className={`${s.viewSwitcherBtn} ${viewMode === mode ? s.viewSwitcherActive : ''}`}
              onClick={() => setViewMode(mode)}
            />
          </Tooltip>
        ))}
      {showViewModes && <span className={s.viewSwitcherDivider} />}
      <Tooltip content={theme === 'light' ? t('view.toDark') : t('view.toLight')} relationship="label">
        <Button
          icon={theme === 'light' ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
          size="small"
          appearance="subtle"
          className={s.viewSwitcherBtn}
          onClick={toggleTheme}
        />
      </Tooltip>
    </div>
  );
}
