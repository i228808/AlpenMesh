import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './ui/Sidebar';
import { useBackendHealth } from '../hooks/useBackendHealth';

const DashboardLayout = () => {
  const health = useBackendHealth();

  return (
    <div className="min-h-screen bg-gray-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-lg focus:bg-slate-950 focus:border focus:border-white/10 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to main content
      </a>
      <Sidebar health={health} />
      <main id="main-content" className="ml-64 min-h-screen" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
