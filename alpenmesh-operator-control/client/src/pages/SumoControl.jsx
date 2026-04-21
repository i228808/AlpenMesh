import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  Activity,
  AlertTriangle,
  TrafficCone,
  Shield,
  RefreshCw,
  Zap,
  TrendingUp,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const SumoControl = () => {
  const [status, setStatus] = useState({ running: false, pid: null });
  const [metrics, setMetrics] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [connectionIssue, setConnectionIssue] = useState(null);
  const [confirmGlobal, setConfirmGlobal] = useState(null); // { action, tone, title, description, confirmText }

  const cameras = [
    '1st_Ave__Madison_St',
    '1st_Ave__Seneca_St',
    '1st_Ave__Stewart_St',
    '1st_Ave__Union_St',
    '2nd_Ave__Marion_St',
    '2nd_Ave__Pike_St_NS',
    '2nd_Ave__Spring_St',
    '2nd_Ave__Stewart_St',
    '2nd_Ave__University_St',
    '3rd_Ave__Columbia_St',
    '3rd_Ave__Seneca_St',
    '3rd_Ave__Spring_St',
    '3rd_Ave__Stewart_st',
    '3rd_Ave__Union_St',
    '3rd_Ave__University_St',
    '4th_Ave__Cherry_St_EW',
    '4th_Ave__James_St',
    '4th_Ave__Madison_St',
    '4th_Ave__Pine_St',
    '5th_Ave__Madison_St_EW',
    '5th_Ave__Madison_St_NS',
    '5th_Ave__Marion_St',
    '5th_Ave__Pike_St',
    '5th_Ave__Pine_St_EW',
    '5th_Ave__Pine_St_NS',
    '5th_Ave__Spring_St',
    '5th_Ave__Union_St',
    '6th_Ave__Cherry_St',
    '6th_Ave__Seneca_St',
    '7th_Ave__James_St',
    '7th_Ave__Pike_St',
    '8th_Ave__Pike_St',
    'Alaskan_Way__Columbia_St',
    'Alaskan_Way__Madison_St',
    'Alaskan_Way__Marion_St',
    'Alaskan_Way__Spring_St',
    'Alaskan_Way__Union_St',
    'Alaskan_Way__Yesler_Way',
    'Western_Ave__Spring_St',
  ];

  const API_BASE = 'http://localhost:8080';

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/status`);
      const data = await res.json();
      setStatus(data);
      setConnectionIssue(null);
    } catch (e) {
      console.error('Failed to fetch status');
      setConnectionIssue('SUMO API is unreachable. Check that the control service is running.');
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sumo-metrics`);
      const data = await res.json();
      setMetrics(data);
      setConnectionIssue(null);
    } catch (e) {
      setConnectionIssue('SUMO metrics unavailable. Check that simulation endpoints are running.');
    }
  };

  const fetchOverrides = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      setOverrides(data.active_overrides || {});
      setConnectionIssue(null);
    } catch (e) {
      setConnectionIssue('Override status unavailable. Check that the control service is running.');
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchMetrics();
    fetchOverrides();
    const interval = setInterval(() => {
      fetchStatus();
      fetchMetrics();
      fetchOverrides();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/start`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'started' || data.status === 'already_running') {
        toast.success(`Simulation started (PID: ${data.pid})`);
        fetchStatus();
      } else {
        toast.error(data.error || 'Failed to start');
      }
    } catch (e) {
      toast.error('Network error');
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/stop`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'stopped') {
        toast.success('Simulation stopped');
        setStatus({ running: false, pid: null });
        setMetrics(null);
      } else {
        toast.error(data.error || 'Failed to stop');
      }
    } catch (e) {
      toast.error('Network error');
    }
  };

  const handleOverride = async (cam, action) => {
    try {
      const payload = {
        camera_name: cam,
        action: action,
        target_roi: 'UP',
        duration: 60,
      };
      const res = await fetch(`${API_BASE}/api/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'set') toast.success(`Force ${action} on ${cam}`);
      else if (data.status === 'cleared') toast.success(`Auto Mode for ${cam}`);
      fetchOverrides();
    } catch (e) {
      toast.error('Failed to send command');
    }
  };

  const handleGlobalAction = async (action) => {
    const promises = cameras.map((cam) => {
      const payload = {
        camera_name: cam,
        action: action,
        target_roi: 'UP',
        duration: 60,
      };
      return fetch(`${API_BASE}/api/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    try {
      await Promise.all(promises);
      toast.success(
        action === 'AUTO' ? 'All cameras reset to Auto' : `Global ${action} command sent`,
      );
      setTimeout(fetchOverrides, 500);
    } catch (e) {
      toast.error('Failed to execute global command');
    }
  };

  return (
    <div className="relative min-h-screen p-8 text-white font-sans selection:bg-sky-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 bg-[#0f172a] -z-20" />
      <div className="fixed inset-0 bg-gradient-to-br from-indigo-950/30 via-slate-900/0 to-cyan-900/20 -z-10 pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] -z-10 pointer-events-none mix-blend-overlay" />

      {/* Header Section */}
      {connectionIssue ? (
        <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Connection issue</p>
            <p className="text-rose-200/80 text-xs mt-0.5">{connectionIssue}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              fetchStatus();
              fetchMetrics();
              fetchOverrides();
            }}
            className="shrink-0 px-3 py-2 rounded-lg border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/15 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      ) : null}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6 animate-fadeIn">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-sky-500/20 border border-sky-400/20 backdrop-blur-sm">
              <Activity size={24} className="text-sky-400" />
            </div>
            <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-sky-300 via-cyan-200 to-indigo-300 bg-clip-text text-transparent drop-shadow-lg">
              SUMO CONTROL
            </h1>
          </div>
          <p className="text-slate-400 text-sm font-medium tracking-wide uppercase pl-14">
            Traffic Simulation & Network Command
          </p>
        </div>

        <div className="flex items-center gap-6">
          {/* Status Pill */}
          <div
            className={`
                        flex items-center gap-3 px-5 py-2.5 rounded-full border backdrop-blur-md shadow-2xl transition-all duration-500
                        ${
                          status.running
                            ? 'bg-emerald-950/30 border-emerald-500/30 shadow-emerald-900/20'
                            : 'bg-rose-950/30 border-rose-500/30 shadow-rose-900/20'
                        }
                    `}
          >
            <div className="relative">
              <div
                className={`w-3 h-3 rounded-full ${status.running ? 'bg-emerald-400' : 'bg-rose-500'}`}
              />
              {status.running && (
                <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
              )}
            </div>
            <span
              className={`font-mono text-sm tracking-wider ${status.running ? 'text-emerald-200' : 'text-rose-200'}`}
            >
              {status.running ? `ONLINE (PID:${status.pid})` : 'OFFLINE'}
            </span>
          </div>

          {status.running ? (
            <button
              onClick={handleStop}
              className="group flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-full shadow-lg hover:shadow-rose-500/40 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <Square size={16} className="fill-current" /> STOP SIM
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="group flex items-center gap-2 px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-full shadow-lg hover:shadow-sky-500/40 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <Play size={16} className="fill-current" /> START SIM
            </button>
          )}
        </div>
      </header>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {/* Card Template */}
        <div className="relative group bg-slate-900/40 backdrop-blur-xl border border-white/5 hover:border-sky-400/30 p-6 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-sky-900/10">
          <div className="absolute top-0 right-0 p-5 opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all duration-500">
            <Clock size={64} className="text-sky-400" />
          </div>
          <div>
            <h3 className="text-sky-200/60 text-xs font-bold uppercase tracking-widest mb-2">
              Wait Time At Intersection
            </h3>
            <div className="flex items-baseline gap-2">
              <div className="text-5xl font-black text-white tracking-tighter drop-shadow-md">
                {metrics?.avg_wait_time ? metrics.avg_wait_time.toFixed(1) : '--'}
              </div>
              <span className="text-xl font-medium text-sky-400">s</span>
            </div>
            <div className="mt-4 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all duration-700 ease-out"
                style={{ width: `${Math.min((metrics?.avg_wait_time || 0) * 2, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-sky-200/40">Avg Wait Time</p>
          </div>
        </div>

        <div className="relative group bg-slate-900/40 backdrop-blur-xl border border-white/5 hover:border-amber-400/30 p-6 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-amber-900/10">
          <div className="absolute top-0 right-0 p-5 opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all duration-500">
            <TrafficCone size={64} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-amber-200/60 text-xs font-bold uppercase tracking-widest mb-2">
              Congestion Level
            </h3>
            <div className="flex items-baseline gap-2">
              <div className="text-5xl font-black text-white tracking-tighter drop-shadow-md">
                {metrics?.total_queue ?? '--'}
              </div>
              <span className="text-xl font-medium text-amber-400">vehs</span>
            </div>
            <div className="mt-4 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-700 ease-out"
                style={{ width: `${Math.min(metrics?.total_queue || 0, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-amber-200/40">Total Queue Length</p>
          </div>
        </div>

        <div className="relative group bg-slate-900/40 backdrop-blur-xl border border-white/5 hover:border-emerald-400/30 p-6 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-emerald-900/10">
          <div className="absolute top-0 right-0 p-5 opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all duration-500">
            <TrendingUp size={64} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-emerald-200/60 text-xs font-bold uppercase tracking-widest mb-2">
              Throughput
            </h3>
            <div className="flex items-baseline gap-2">
              <div className="text-5xl font-black text-white tracking-tighter drop-shadow-md">
                {metrics?.throughput ?? '--'}
              </div>
              <span className="text-xl font-medium text-emerald-400">vehs</span>
            </div>
            <div className="mt-4 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-700 ease-out"
                style={{ width: '100%' }} // Simple full bar for accumulation
              />
            </div>
            <p className="mt-2 text-xs text-emerald-200/40">Total Arrived</p>
          </div>
        </div>
      </div>

      {/* Control Section */}
      <div className="bg-slate-900/30 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        {/* Toolbar */}
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 bg-white/5">
          <div className="flex items-center gap-3">
            <Shield className="text-amber-400 animate-pulse" />
            <h2 className="text-lg font-bold text-white tracking-wide uppercase">
              Manual Override Protocols
            </h2>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() =>
                setConfirmGlobal({
                  action: 'SWITCH_RED',
                  tone: 'danger',
                  title: 'Emergency: force ALL RED?',
                  description: 'Sends an emergency override to all camera nodes for 60 seconds.',
                  confirmText: 'Send ALL RED',
                })
              }
              className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 hover:shadow-[0_0_15px_rgba(244,63,94,0.3)]"
            >
              <AlertTriangle size={14} /> Emergency All Red
            </button>
            <button
              onClick={() =>
                setConfirmGlobal({
                  action: 'AUTO',
                  tone: 'neutral',
                  title: 'Restore AUTO mode for all cameras?',
                  description:
                    'Clears manual overrides and returns all nodes to automatic control.',
                  confirmText: 'Restore AUTO',
                })
              }
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 hover:shadow-[0_0_15px_rgba(99,102,241,0.3)]"
            >
              <RefreshCw size={14} /> Restore Auto
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-white/5 bg-slate-950/30">
                <th className="p-6">Camera Node</th>
                <th className="p-6">Control State</th>
                <th className="p-6 text-right">Command</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {cameras.map((cam, idx) => {
                const isOverridden = overrides[cam];
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={cam}
                    className={`group transition-colors ${isEven ? 'bg-white/[0.02]' : 'bg-transparent'} hover:bg-white/[0.05]`}
                  >
                    <td className="p-6 font-mono text-slate-300 group-hover:text-white transition-colors">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${isOverridden ? 'bg-amber-400' : 'bg-sky-500/30'}`}
                        />
                        {cam}
                      </div>
                    </td>
                    <td className="p-6">
                      {isOverridden ? (
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold text-xs uppercase tracking-wider shadow-[0_0_10px_rgba(251,191,36,0.1)]">
                          <Zap size={12} className="fill-current" /> Force{' '}
                          {isOverridden.action.replace('SWITCH_', '')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400 font-bold text-xs uppercase tracking-wider">
                          <Activity size={12} /> Auto Pilot
                        </span>
                      )}
                    </td>
                    <td className="p-6 text-right">
                      <div className="inline-flex bg-slate-950/50 p-1 rounded-lg border border-white/10">
                        <button
                          onClick={() => handleOverride(cam, 'SWITCH_GREEN')}
                          className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${
                            isOverridden?.action === 'SWITCH_GREEN'
                              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                              : 'text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          Green
                        </button>
                        <button
                          onClick={() => handleOverride(cam, 'SWITCH_RED')}
                          className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${
                            isOverridden?.action === 'SWITCH_RED'
                              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                              : 'text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          Red
                        </button>
                        <button
                          onClick={() => handleOverride(cam, 'AUTO')}
                          className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${
                            !isOverridden
                              ? 'bg-sky-600/80 text-white shadow-lg shadow-sky-500/20'
                              : 'text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          Auto
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmGlobal}
        tone={confirmGlobal?.tone}
        title={confirmGlobal?.title}
        description={confirmGlobal?.description}
        confirmText={confirmGlobal?.confirmText}
        cancelText="Cancel"
        onCancel={() => setConfirmGlobal(null)}
        onConfirm={() => {
          const action = confirmGlobal?.action;
          setConfirmGlobal(null);
          if (action) handleGlobalAction(action);
        }}
      />
    </div>
  );
};

export default SumoControl;
