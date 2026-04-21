import { Suspense, lazy, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AuthContext, { AuthProvider } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import { Toaster } from 'react-hot-toast';

const Dashboard = lazy(() => import('./components/Dashboard'));
const CameraMap = lazy(() => import('./pages/CameraMap'));
const CongestionLogs = lazy(() => import('./pages/CongestionLogs'));
const AccidentLogs = lazy(() => import('./pages/AccidentLogs'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const SumoControl = lazy(() => import('./pages/SumoControl'));

const RouteSkeleton = ({ label = 'Loading…' }) => (
  <div className="min-h-screen bg-gray-950 flex items-center justify-center">
    <div className="text-center">
      <div className="w-12 h-12 border-4 border-sky-500/40 border-t-sky-400 rounded-full animate-spin mx-auto mb-4" />
      <p className="text-slate-400 text-sm">{label}</p>
    </div>
  </div>
);

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <Suspense fallback={<RouteSkeleton label="Loading login…" />}>
                <Login />
              </Suspense>
            }
          />
          <Route
            path="/register"
            element={
              <Suspense fallback={<RouteSkeleton label="Loading registration…" />}>
                <Register />
              </Suspense>
            }
          />

          {/* Protected Dashboard Routes with Sidebar Layout */}
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading dashboard…" />}>
                  <Dashboard />
                </Suspense>
              }
            />
            <Route
              path="/camera-map"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading map…" />}>
                  <CameraMap />
                </Suspense>
              }
            />
            <Route
              path="/congestion-logs"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading congestion logs…" />}>
                  <CongestionLogs />
                </Suspense>
              }
            />
            <Route
              path="/accident-logs"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading accident logs…" />}>
                  <AccidentLogs />
                </Suspense>
              }
            />
            <Route
              path="/alerts"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading alerts…" />}>
                  <AlertsPage />
                </Suspense>
              }
            />
            <Route
              path="/sumo-control"
              element={
                <Suspense fallback={<RouteSkeleton label="Loading SUMO control…" />}>
                  <SumoControl />
                </Suspense>
              }
            />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" />} />
        </Routes>
        <Toaster position="bottom-right" toastOptions={{ duration: 8000 }} />
      </AuthProvider>
    </Router>
  );
}

export default App;
