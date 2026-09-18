// 应用外壳：左侧侧边栏 + Outlet + 右上角搜索
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { ViewSwitcher } from '../ViewSwitcher';
import { SearchDialog } from '../SearchDialog';
import { makeStyles, tokens, Button, Tooltip } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  shell: {
    minHeight: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  main: {
    padding: '20px 28px 20px 248px',
    overflowY: 'auto',
    minHeight: '100vh',
  },
  searchBtn: {
    position: 'fixed',
    top: '16px',
    right: '24px',
    zIndex: 200,
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export function AppShell() {
  const styles = useStyles();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <Navbar />
      <main className={styles.main} data-scroll-container>
        <Outlet />
      </main>
      <ViewSwitcher />
      <Tooltip content="搜索" relationship="label">
        <Button
          className={styles.searchBtn}
          appearance="subtle"
          icon={<SearchRegular />}
          onClick={() => setSearchOpen(true)}
        />
      </Tooltip>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
