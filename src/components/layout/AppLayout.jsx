import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useHospital } from '../../contexts/HospitalContext';
import StaffTrackingRuntime from '../staff/StaffTrackingRuntime';

export default function AppLayout() {
  const { drillMode } = useHospital();
  const location = useLocation();
  const isMapEditor = location.pathname === '/map-editor';

  return (
    <div className={`flex h-screen overflow-hidden bg-navy ${drillMode ? 'drill-mode' : ''}`}>
      <StaffTrackingRuntime />

      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className={`flex-1 min-h-0 ${isMapEditor ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
