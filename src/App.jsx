import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { HospitalProvider } from './contexts/HospitalContext';

// Pages
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import Rooms from './pages/Rooms';
import AlertDetail from './pages/AlertDetail';
import Staff from './pages/Staff';
import Drill from './pages/Drill';
import HospitalMapEditor from './pages/HospitalMapEditor';
import AIMonitor from './pages/AIMonitor';

// Layout
import AppLayout from './components/layout/AppLayout';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner" />
          <p className="text-white/50 text-sm">Loading GuardianAI…</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <HospitalProvider>
        <BrowserRouter>
          <Routes>
            {/* Always show landing page first — no auto-redirect for authenticated users */}
            <Route path="/" element={<LandingPage />} />

            {/* Protected — inside AppLayout (sidebar + topbar) */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/alerts/:alertId" element={<AlertDetail />} />
              <Route path="/staff" element={<Staff />} />
              <Route path="/drill" element={<Drill />} />
              <Route path="/ai-monitor" element={<AIMonitor />} />
              <Route path="/map-editor" element={<HospitalMapEditor />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </HospitalProvider>
    </AuthProvider>
  );
}
