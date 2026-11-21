import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AppVersion from './AppVersion';
import ZokiLauncher from '../Zoki/ZokiLauncher';
import { ContextMenuProvider } from '../Common/ContextMenu';
import { useGlobalEscape } from '../../hooks/useGlobalEscape';
import './Layout.css';

export default function AppLayout() {
  useGlobalEscape();
  return (
    <ContextMenuProvider>
      <div className="app-layout">
        <Sidebar />
        <main className="app-main">
          <Outlet />
        </main>
        <ZokiLauncher />
        <AppVersion />
      </div>
    </ContextMenuProvider>
  );
}
