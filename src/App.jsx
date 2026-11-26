import ImportReport from './components/Zoki/ImportReport.jsx';
import PedagogicalMapping from './components/Students/PedagogicalMapping.jsx';
import TaskWorkspace from './components/Tasks/TaskWorkspaceRoute';
import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import AppLayout from './components/Layout/AppLayout';
import PageErrorBoundary from './components/Common/PageErrorBoundary';
import { db } from './firebase';
import { warmSchoolData, whenIdle } from './services/sessionWarmup';

// One importer per page: used both for the lazy route and to fetch the page's code ahead of time.
const pageImporters = {
  Dashboard: () => import('./components/Dashboard/Dashboard'),
  GanttChart: () => import('./components/Gantt/GanttChart'),
  StaffManagement: () => import('./components/Staff/StaffManagement'),
  TaskBoard: () => import('./components/Tasks/TaskBoard'),
  FileManager: () => import('./components/Files/FileManager'),
  Teams: () => import('./components/Teams/Teams'),
  Students: () => import('./components/Students/Students'),
  Messages: () => import('./components/Messages/Messages'),
  HolidayManager: () => import('./components/Holidays/HolidayManager'),
  Settings: () => import('./components/Settings/Settings'),
  Notifications: () => import('./components/Notifications/Notifications'),
  ForumPage: () => import('./components/Forum/ForumPage'),
  SupportPage: () => import('./components/Support/SupportPage'),
  PlatformManagement: () => import('./components/Platform/PlatformManagement'),
  ContactsPage: () => import('./components/Contacts/ContactsPage'),
  CollectiveBrainPage: () => import('./components/CollectiveBrain/CollectiveBrainPage'),
  PublicCollectiveBrainPage: () => import('./components/CollectiveBrain/PublicCollectiveBrainPage'),
};
const Dashboard = lazy(pageImporters.Dashboard);
const GanttChart = lazy(pageImporters.GanttChart);
const StaffManagement = lazy(pageImporters.StaffManagement);
const TaskBoard = lazy(pageImporters.TaskBoard);
const FileManager = lazy(pageImporters.FileManager);
const Teams = lazy(pageImporters.Teams);
const Students = lazy(pageImporters.Students);
const Messages = lazy(pageImporters.Messages);
const HolidayManager = lazy(pageImporters.HolidayManager);
const Settings = lazy(pageImporters.Settings);
const Notifications = lazy(pageImporters.Notifications);
const ForumPage = lazy(pageImporters.ForumPage);
const SupportPage = lazy(pageImporters.SupportPage);
const PlatformManagement = lazy(pageImporters.PlatformManagement);
const ContactsPage = lazy(pageImporters.ContactsPage);
const CollectiveBrainPage = lazy(pageImporters.CollectiveBrainPage);
const PublicCollectiveBrainPage = lazy(pageImporters.PublicCollectiveBrainPage);

function ProtectedRoute({ children }) {
  const { currentUser, loading, selectedSchool, userData } = useAuth();
  const schoolId = selectedSchool || userData?.schoolId;
  const signedIn = Boolean(currentUser) && !loading;
  // Once the user is in, fetch the code of the other pages and the calendar's base data in the
  // background, so moving between pages does not wait for them.
  useEffect(() => {
    if (!signedIn) return undefined;
    return whenIdle(() => {
      Object.values(pageImporters).forEach(load => load().catch(() => undefined));
      warmSchoolData(db, schoolId);
    });
  }, [signedIn, schoolId]);
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>טוען...</p>
      </div>
    );
  }
  if (!currentUser) return <Navigate to="/login" />;
  return children;
}

function AdminRoute({ children }) {
  const { isPlatformAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isPlatformAdmin()) return <Navigate to="/" />;
  return children;
}
function SchoolRequiredRoute({ children }) {
  const { userData, selectedSchool, loading, isPlatformAdmin } = useAuth();
  if (loading) return null;
  if (isPlatformAdmin()) return <Navigate to="/platform" />;
  const schoolId = selectedSchool || userData?.schoolId;
  if (!schoolId) {
    return <Navigate to="/" />;
  }
  return children;
}

function HomeRoute() {
  const { isPlatformAdmin, isGlobalAdmin, selectedSchool } = useAuth();
  if (isPlatformAdmin()) return <Navigate to="/platform" />;
  if (!isGlobalAdmin() && !selectedSchool) return <Navigate to="/login" />;
  return <Dashboard />;
}

function NonPlatformRoute({ children }) {
  const { loading, isPlatformAdmin } = useAuth();
  if (loading) return null;
  return isPlatformAdmin() ? <Navigate to="/platform" /> : children;
}

// Blocks pending users from accessing any route except dashboard
function ApprovedRoute({ children }) {
  const { loading, isPending } = useAuth();
  if (loading) return null;
  if (isPending()) return <Navigate to="/" />;
  return children;
}

function LoginRoute({ children }) {
  const { currentUser, loading, selectedSchool, isGlobalAdmin, isPlatformAdmin } = useAuth();
  if (loading) return null;
  if (currentUser && (selectedSchool || isGlobalAdmin() || isPlatformAdmin())) return <Navigate to="/" />;
  return children;
}

function PublicRoute({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading) return null;
  if (currentUser) return <Navigate to="/" />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Suspense fallback={(
          <div className="loading-screen">
            <div className="loading-spinner" />
            <p>טוען...</p>
          </div>
        )}>
          <Routes>
            <Route path="/login" element={<LoginRoute><Login /></LoginRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/brain/shared/:shareId" element={<PublicCollectiveBrainPage />} />

            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<HomeRoute />} />
              <Route path="calendar" element={<ApprovedRoute><SchoolRequiredRoute><GanttChart /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="categories" element={<ApprovedRoute><SchoolRequiredRoute><Navigate to="/calendar?categories=1" replace /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="staff" element={<ApprovedRoute><SchoolRequiredRoute><StaffManagement /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="tasks" element={<ApprovedRoute><SchoolRequiredRoute><PageErrorBoundary><TaskWorkspace /></PageErrorBoundary></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="tasks/advanced" element={<ApprovedRoute><SchoolRequiredRoute><PageErrorBoundary><TaskBoard /></PageErrorBoundary></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="files" element={<ApprovedRoute><SchoolRequiredRoute><FileManager /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="teams" element={<ApprovedRoute><SchoolRequiredRoute><Teams /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="contacts" element={<ApprovedRoute><SchoolRequiredRoute><ContactsPage /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="collective-brain" element={<ApprovedRoute><SchoolRequiredRoute><PageErrorBoundary><CollectiveBrainPage /></PageErrorBoundary></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="zoki" element={<Navigate to="/" replace />} />
              <Route path="imports" element={<ApprovedRoute><SchoolRequiredRoute><ImportReport /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="mappings" element={<ApprovedRoute><SchoolRequiredRoute><PedagogicalMapping /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="students" element={<ApprovedRoute><SchoolRequiredRoute><Students /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="messages" element={<NonPlatformRoute><ApprovedRoute><Messages /></ApprovedRoute></NonPlatformRoute>} />
              <Route path="notifications" element={<NonPlatformRoute><Notifications /></NonPlatformRoute>} />
              <Route path="holidays" element={<ApprovedRoute><SchoolRequiredRoute><HolidayManager /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="schools" element={<AdminRoute><Navigate to="/platform" /></AdminRoute>} />
              <Route path="forum" element={<ApprovedRoute><ForumPage /></ApprovedRoute>} />
              <Route path="support" element={<ApprovedRoute><SchoolRequiredRoute><SupportPage /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="platform" element={<AdminRoute><PlatformManagement /></AdminRoute>} />
              <Route path="settings" element={<NonPlatformRoute><Settings /></NonPlatformRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </HashRouter>
  );
}
