import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useHospital } from '../../contexts/HospitalContext';

export default function AppLayout() {
  const { drillMode } = useHospital();

  return (
    <div className={`flex h-screen overflow-hidden bg-navy ${drillMode ? 'drill-mode' : ''}`}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
