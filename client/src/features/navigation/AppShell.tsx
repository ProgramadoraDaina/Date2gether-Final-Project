import type { ReactNode } from 'react';
import { AppNav } from './AppNav';
import styles from './AppShell.module.css';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppNav />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
