import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import AppLayout from './components/Layout/AppLayout';
import Dashboard from './components/Dashboard/Dashboard';
import GanttChart from './components/Gantt/GanttChart';
import CategoryManager from './components/Gantt/CategoryManager';
import StaffManagement from './components/Staff/StaffManagement';
import TaskBoard from './components/Tasks/TaskBoard';
import FileManager from './components/Files/FileManager';
import SchoolManagement from './components/Schools/SchoolManagement';
import Teams from './components/Teams/Teams';
import Students from './components/Students/Students';
import Messages from './components/Messages/Messages';
import HolidayManager from './components/Holidays/HolidayManager';
import Settings from './components/Settings/Settings';
import Notifications from './components/Notifications/Notifications';

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
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (userData?.role !== 'global_admin') return <Navigate to="/" />;
  return children;
}

function PrincipalRoute({ children }) {
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (userData?.role !== 'global_admin' && userData?.role !== 'principal') {
    return <Navigate to="/" />;
  }
  return children;
}

// Requires at least editor role (blocks viewers)
function SchoolRequiredRoute({ children }) {
  const { userData, selectedSchool, loading } = useAuth();
  if (loading) return null;
  const schoolId = selectedSchool || userData?.schoolId;
  if (!schoolId) {
    return <Navigate to="/" />;
  }
  return children;
}

// Blocks pending users from accessing any route except dashboard
function ApprovedRoute({ children }) {
  const { userData, loading, isPending } = useAuth();
  if (loading) return null;
  if (isPending()) return <Navigate to="/" />;
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
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

          <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<ApprovedRoute><SchoolRequiredRoute><GanttChart /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="categories" element={<ApprovedRoute><SchoolRequiredRoute><CategoryManager /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="staff" element={<ApprovedRoute><SchoolRequiredRoute><StaffManagement /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="tasks" element={<ApprovedRoute><SchoolRequiredRoute><TaskBoard /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="files" element={<ApprovedRoute><SchoolRequiredRoute><FileManager /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="teams" element={<ApprovedRoute><SchoolRequiredRoute><Teams /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="students" element={<ApprovedRoute><SchoolRequiredRoute><Students /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="messages" element={<ApprovedRoute><Messages /></ApprovedRoute>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="holidays" element={<ApprovedRoute><SchoolRequiredRoute><HolidayManager /></SchoolRequiredRoute></ApprovedRoute>} />
            <Route path="schools" element={<AdminRoute><SchoolManagement /></AdminRoute>} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
