import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import AppLayout from './components/Layout/AppLayout';
import PageErrorBoundary from './components/Common/PageErrorBoundary';

const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const GanttChart = lazy(() => import('./components/Gantt/GanttChart'));
const CategoryManager = lazy(() => import('./components/Gantt/CategoryManager'));
const StaffManagement = lazy(() => import('./components/Staff/StaffManagement'));
const TaskBoard = lazy(() => import('./components/Tasks/TaskBoard'));
const FileManager = lazy(() => import('./components/Files/FileManager'));
const Teams = lazy(() => import('./components/Teams/Teams'));
const Students = lazy(() => import('./components/Students/Students'));
const Messages = lazy(() => import('./components/Messages/Messages'));
const HolidayManager = lazy(() => import('./components/Holidays/HolidayManager'));
const Settings = lazy(() => import('./components/Settings/Settings'));
const Notifications = lazy(() => import('./components/Notifications/Notifications'));
const ForumPage = lazy(() => import('./components/Forum/ForumPage'));
const SupportPage = lazy(() => import('./components/Support/SupportPage'));
const PlatformManagement = lazy(() => import('./components/Platform/PlatformManagement'));

function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
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

            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<HomeRoute />} />
              <Route path="calendar" element={<ApprovedRoute><SchoolRequiredRoute><GanttChart /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="categories" element={<ApprovedRoute><SchoolRequiredRoute><CategoryManager /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="staff" element={<ApprovedRoute><SchoolRequiredRoute><StaffManagement /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="tasks" element={<ApprovedRoute><SchoolRequiredRoute><PageErrorBoundary><TaskBoard /></PageErrorBoundary></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="files" element={<ApprovedRoute><SchoolRequiredRoute><FileManager /></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="teams" element={<ApprovedRoute><SchoolRequiredRoute><Teams /></SchoolRequiredRoute></ApprovedRoute>} />
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
