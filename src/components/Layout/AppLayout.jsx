import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AppVersion from './AppVersion';
import ZokiLauncher from '../Zoki/ZokiLauncher';
import './Layout.css';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
      <ZokiLauncher />
      <AppVersion />
    </div>
  );
}
