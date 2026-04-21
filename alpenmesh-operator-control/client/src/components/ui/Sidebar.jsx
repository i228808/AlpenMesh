import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MapPin,
  LogOut,
  User,
  Radio,
  TrafficCone,
  AlertTriangle,
  BellRing,
  GitGraph,
  RefreshCw,
} from 'lucide-react';
import AuthContext from '../../context/AuthContext';

const dotClass = (state) => {
  if (state === 'ok') return 'bg-emerald-400';
  if (state === 'error') return 'bg-rose-400';
  return 'bg-slate-500';
};

const labelForOverall = (overall) => {
  if (overall === 'ok') return 'Systems Online';
  if (overall === 'error') return 'Degraded';
  return 'Checking...';
};

const Sidebar = ({ health }) => {
  const { user, logout } = useContext(AuthContext);

  const navItems = [
    {
      to: '/dashboard',
      label: 'Operator Control',
      sublabel: 'Monitoring & Override',
      icon: LayoutDashboard,
    },
    {
      to: '/camera-map',
      label: 'Camera Map',
      sublabel: 'Live Stream Overview',
      icon: MapPin,
    },
    {
      to: '/congestion-logs',
      label: 'Congestion Logs',
      sublabel: 'Lane pressure archive',
      icon: TrafficCone,
    },
    {
      to: '/accident-logs',
      label: 'Accident Logs',
      sublabel: 'Impact evidence & audit',
      icon: AlertTriangle,
    },
    {
      to: '/alerts',
      label: 'Alerts',
      sublabel: 'Live signals & notices',
      icon: BellRing,
    },
    {
      to: '/sumo-control',
      label: 'SUMO Control',
      sublabel: 'Traffic overrides',
      icon: GitGraph,
    },
  ];

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col z-50">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          {/* Mountain Range SVG */}
          <svg
            className="w-10 h-10 text-sky-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 21L1 12l4-4 3 3 4-5 4 5 3-3 4 4-7 9H8z" />
            <path d="M5 8L8 5l4 4" />
            <circle cx="18" cy="5" r="2" fill="currentColor" opacity="0.5" />
          </svg>
          <div>
            <h1 className="text-xl font-bold tracking-widest uppercase bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
              AlpenMesh
            </h1>
            <p className="text-xs text-gray-500 tracking-wider">TRAFFIC CONTROL SYSTEM</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white border border-transparent'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <div>
              <div className="font-medium text-sm">{item.label}</div>
              <div className="text-xs text-gray-500 group-hover:text-gray-400">{item.sublabel}</div>
            </div>
          </NavLink>
        ))}
      </nav>

      {/* Status */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Radio
              className={`w-3 h-3 ${health?.overall === 'ok' ? 'text-emerald-400 animate-pulse' : health?.overall === 'error' ? 'text-rose-400' : 'text-slate-400'}`}
            />
            <span className={health?.overall === 'error' ? 'text-rose-300' : 'text-gray-500'}>
              {labelForOverall(health?.overall)}
            </span>
          </div>
          <button
            type="button"
            onClick={health?.refresh}
            disabled={!health?.refresh || health?.isRefreshing}
            className="p-2 -mr-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-60 disabled:hover:bg-transparent transition-colors"
            aria-label="Refresh system status"
            title="Refresh system status"
          >
            <RefreshCw className={`w-4 h-4 ${health?.isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
          <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/40 px-2 py-1.5">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dotClass(health?.api?.state)}`} />
              API
            </span>
            <span className="tabular-nums text-gray-400">
              {typeof health?.api?.latencyMs === 'number' ? `${health.api.latencyMs}ms` : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/40 px-2 py-1.5">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dotClass(health?.reporting?.state)}`} />
              Reporting
            </span>
            <span className="tabular-nums text-gray-400">
              {typeof health?.reporting?.latencyMs === 'number'
                ? `${health.reporting.latencyMs}ms`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-sky-500/30 flex items-center justify-center">
            <User className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-200">{user?.username}</div>
            <div className="text-xs text-gray-500 uppercase">{user?.role}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded-lg text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
