import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { usePermissions } from './hooks/usePermissions';

const Login = lazy(() => import('./components/Auth/Login'));
const Register = lazy(() => import('./components/Auth/Register'));
const AppLayout = lazy(() => import('./components/Layout/AppLayout'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const GanttChart = lazy(() => import('./components/Gantt/GanttChart'));
const CategoryManager = lazy(() => import('./components/Gantt/CategoryManager'));
const StaffManagement = lazy(() => import('./components/Staff/StaffManagement'));
const TaskBoard = lazy(() => import('./components/Tasks/TaskBoard'));
const FileManager = lazy(() => import('./components/Files/FileManager'));
const SchoolManagement = lazy(() => import('./components/Schools/SchoolManagement'));
const Teams = lazy(() => import('./components/Teams/Teams'));
const Students = lazy(() => import('./components/Students/Students'));
const Messages = lazy(() => import('./components/Messages/Messages'));
const HolidayManager = lazy(() => import('./components/Holidays/HolidayManager'));
const Settings = lazy(() => import('./components/Settings/Settings'));
const Notifications = lazy(() => import('./components/Notifications/Notifications'));

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>טוען...</p>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!currentUser) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (userData?.role !== 'global_admin') return <Navigate to="/" replace />;
  return children;
}

// Requires a school context.
function SchoolRequiredRoute({ children }) {
  const { userData, selectedSchool, loading } = useAuth();
  if (loading) return null;
  const schoolId = selectedSchool || userData?.schoolId;
  if (!schoolId) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// Blocks pending users from accessing any route except dashboard
function ApprovedRoute({ children }) {
  const { loading, isPending } = useAuth();
  if (loading) return null;
  if (isPending()) return <Navigate to="/" replace />;
  return children;
}

function PermissionRoute({ permission, children }) {
  const { permissions, loading } = usePermissions();
  if (loading) return <LoadingScreen />;
  if (!permissions[permission]) return <Navigate to="/" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading) return null;
  if (currentUser) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="calendar" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="calendar_view"><GanttChart /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="categories" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="categories_view"><CategoryManager /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="staff" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="staff_view"><StaffManagement /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="tasks" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="tasks_view"><TaskBoard /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="files" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="files_view"><FileManager /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="teams" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="teams_view"><Teams /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="students" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="students_view"><Students /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="messages" element={<ApprovedRoute><PermissionRoute permission="messages_send"><Messages /></PermissionRoute></ApprovedRoute>} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="holidays" element={<ApprovedRoute><SchoolRequiredRoute><PermissionRoute permission="holidays_view"><HolidayManager /></PermissionRoute></SchoolRequiredRoute></ApprovedRoute>} />
              <Route path="schools" element={<AdminRoute><SchoolManagement /></AdminRoute>} />
              <Route path="settings" element={<Settings />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </HashRouter>
  );
}
