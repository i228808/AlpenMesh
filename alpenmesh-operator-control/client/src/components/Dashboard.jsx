import React, { useCallback, useEffect, useState, useContext, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  Legend,
} from 'recharts';
import {
  Activity,
  Radio,
  AlertTriangle,
  ShieldCheck,
  Video,
  Car,
  TrendingUp,
  Clock,
  Zap,
  Mountain,
  Thermometer,
  Wind,
  ChevronRight,
  RefreshCw,
  Signal,
} from 'lucide-react';
import AuthContext from '../context/AuthContext';
import toast from 'react-hot-toast';
import ConfirmDialog from './ui/ConfirmDialog';

const API_BASE = 'http://localhost:8080';
const REPORTING_BASE = 'http://localhost:8001';

// Animated number component
const AnimatedNumber = ({ value, suffix = '' }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 500;
    const steps = 20;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>
      {displayValue}
      {suffix}
    </span>
  );
};

// Glassmorphism Card Component
const GlassCard = ({ children, className = '', gradient = false, hover = true }) => (
  <div
    className={`
        relative overflow-hidden rounded-2xl 
        ${
          gradient
            ? 'bg-gradient-to-br from-sky-500/10 via-cyan-500/5 to-transparent'
            : 'bg-gray-800/50'
        }
        backdrop-blur-xl border border-white/10
        ${hover ? 'hover:border-sky-400/30 hover:shadow-lg hover:shadow-sky-500/10 transition-all duration-300' : ''}
        ${className}
    `}
  >
    {/* Subtle glow effect */}
    <div className="absolute -top-24 -right-24 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
    <div className="relative z-10">{children}</div>
  </div>
);

// Traffic Signal Component with Animation
const TrafficSignal = ({ state, size = 'md' }) => {
  const sizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-6 h-6' };
  const isGreen = state === 'KEEP_GREEN' || state === 'EXTEND_GREEN' || state === 'FORCE_GREEN';
  const isYellow = state === 'SWITCH_GREEN';

  return (
    <div className={`flex gap-1.5 ${size === 'lg' ? 'flex-col' : ''}`}>
      <div
        className={`${sizes[size]} rounded-full ${!isGreen && !isYellow ? 'bg-red-500 shadow-lg shadow-red-500/50 animate-pulse' : 'bg-red-900/50'}`}
      />
      <div
        className={`${sizes[size]} rounded-full ${isYellow ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50 animate-pulse' : 'bg-yellow-900/50'}`}
      />
      <div
        className={`${sizes[size]} rounded-full ${isGreen ? 'bg-green-500 shadow-lg shadow-green-500/50 animate-pulse' : 'bg-green-900/50'}`}
      />
    </div>
  );
};

// Mountain Stats Banner
const MountainBanner = ({ totalVehicles, activeCameras, systemUptime }) => (
  <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-sky-900/50 to-slate-900 p-6 mb-6">
    {/* Mountain SVG Background */}
    <svg
      className="absolute bottom-0 left-0 right-0 h-32 text-sky-800/20"
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
    >
      <path
        fill="currentColor"
        d="M0,64 L60,48 L120,80 L180,32 L240,96 L300,16 L360,64 L420,48 L480,80 L540,24 L600,72 L660,40 L720,88 L780,32 L840,64 L900,16 L960,80 L1020,48 L1080,96 L1140,24 L1200,72 L1260,40 L1320,88 L1380,48 L1440,64 L1440,120 L0,120 Z"
      />
    </svg>
    <svg
      className="absolute bottom-0 left-0 right-0 h-24 text-sky-900/30"
      viewBox="0 0 1440 100"
      preserveAspectRatio="none"
    >
      <path
        fill="currentColor"
        d="M0,50 L80,30 L160,60 L240,20 L320,70 L400,10 L480,50 L560,35 L640,65 L720,25 L800,55 L880,15 L960,60 L1040,30 L1120,70 L1200,20 L1280,55 L1360,35 L1440,50 L1440,100 L0,100 Z"
      />
    </svg>

    <div className="relative z-10 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-sky-500/20 rounded-2xl backdrop-blur-sm border border-sky-400/20">
          <Mountain className="w-8 h-8 text-sky-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-sky-200 bg-clip-text text-transparent">
            AlpenMesh Control Center
          </h1>
          <p className="text-sky-300/70 text-sm mt-1">Real-time Traffic Intelligence System</p>
        </div>
      </div>

      <div className="flex gap-8">
        <div className="text-center">
          <div className="text-3xl font-bold text-white">
            <AnimatedNumber value={totalVehicles} />
          </div>
          <div className="text-xs text-sky-300/60 uppercase tracking-wider">Vehicles/hr</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-sky-400">
            <AnimatedNumber value={activeCameras} />
          </div>
          <div className="text-xs text-sky-300/60 uppercase tracking-wider">Active Nodes</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-green-400">99.9%</div>
          <div className="text-xs text-sky-300/60 uppercase tracking-wider">Uptime</div>
        </div>
      </div>
    </div>

    {/* Live indicator */}
    <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-green-500/20 rounded-full border border-green-500/30">
      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      <span className="text-xs text-green-400 font-medium">LIVE</span>
    </div>
  </div>
);

// Camera Control Card
const CameraCard = ({ cam, override, user, onRequestOverride }) => {
  const camName = cam.camera_name || 'Unknown';
  const decision = cam.decision;
  const state = override?.action || decision?.action || 'IDLE';

  return (
    <GlassCard gradient className="p-5">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <TrafficSignal state={state} size="lg" />
          <div>
            <h3 className="font-bold text-white">{camName}</h3>
            <p className="text-xs text-gray-400">Zone Alpha</p>
          </div>
        </div>
        {override ? (
          <span className="px-3 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-full border border-orange-500/30 animate-pulse">
            MANUAL
          </span>
        ) : (
          <span className="px-3 py-1 bg-sky-500/20 text-sky-400 text-xs rounded-full border border-sky-500/30">
            AUTO
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-black/20 rounded-xl p-3 text-center">
          <Car className="w-4 h-4 text-sky-400 mx-auto mb-1" />
          <div className="text-xl font-bold text-white">{cam.total_vehicles || 0}</div>
          <div className="text-xs text-gray-500">Vehicles</div>
        </div>
        <div className="bg-black/20 rounded-xl p-3 text-center">
          <TrendingUp className="w-4 h-4 text-green-400 mx-auto mb-1" />
          <div className="text-xl font-bold text-white">
            {Object.values(cam.congestion_levels || {}).includes('High') ? 'High' : 'Normal'}
          </div>
          <div className="text-xs text-gray-500">Flow</div>
        </div>
        <div className="bg-black/20 rounded-xl p-3 text-center">
          <Zap className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
          <div className="text-xl font-bold text-white">{decision?.confidence || 85}%</div>
          <div className="text-xs text-gray-500">AI Score</div>
        </div>
      </div>

      {/* Control Buttons */}
      {user?.role === 'admin' ? (
        <div className="flex gap-2">
          <button
            onClick={() =>
              onRequestOverride(camName, 'FORCE_GREEN', Object.keys(cam.vehicle_counts || {})[0])
            }
            className="flex-1 py-2.5 bg-green-600/80 hover:bg-green-500 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-green-600/20"
          >
            ● GREEN
          </button>
          <button
            onClick={() => onRequestOverride(camName, 'FORCE_RED')}
            className="flex-1 py-2.5 bg-red-600/80 hover:bg-red-500 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-600/20"
          >
            ● RED
          </button>
          <button
            onClick={() => onRequestOverride(camName, 'AUTO')}
            className="flex-1 py-2.5 bg-sky-600/80 hover:bg-sky-500 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-sky-600/20"
          >
            ⚡ AUTO
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-3 bg-gray-800/50 rounded-xl text-gray-500 text-xs">
          <ShieldCheck className="w-4 h-4" />
          Admin access required for controls
        </div>
      )}
    </GlassCard>
  );
};

// Custom Tooltip for Charts
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900/95 backdrop-blur-xl px-4 py-3 rounded-xl border border-white/10 shadow-xl">
        <p className="text-sky-400 font-medium mb-1">{label}</p>
        {payload.map((item, idx) => (
          <p key={idx} className="text-white text-sm">
            {item.name}: <span className="font-bold">{item.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historicalData, setHistoricalData] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [confirmOverride, setConfirmOverride] = useState(null); // { cameraName, action, targetRoi }
  const { user } = useContext(AuthContext);
  const seenAlerts = useRef(new Set());

  const fetchData = useCallback(async () => {
    try {
      setFetchError(null);
      const [metricsRes, statusRes] = await Promise.all([
        axios.get(`${API_BASE}/api/metrics`),
        axios.get(`${API_BASE}/api/status`),
      ]);
      setMetrics(metricsRes.data);
      setStatus(statusRes.data);

      // Build historical data for charts
      setHistoricalData((prev) => {
        const newPoint = {
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          vehicles: metricsRes.data.reduce((sum, cam) => sum + (cam.total_vehicles || 0), 0),
        };
        const updated = [...prev, newPoint].slice(-12);
        return updated;
      });
    } catch (err) {
      console.error('Failed to fetch data', err);
      setFetchError('Unable to reach the control API. Check that services are running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Poll reporting agent for new alerts and toast them (brief 3s; details live in Alerts tab)
  useEffect(() => {
    const poll = async () => {
      try {
        const alertRes = await axios.get(`${REPORTING_BASE}/alerts?limit=20`);
        (alertRes.data || []).forEach((a) => {
          if (seenAlerts.current.has(a.id)) return;
          seenAlerts.current.add(a.id);
          const isAcc = a.type === 'accident';
          const title = isAcc ? 'Accident detected' : 'Congestion detected';
          const cam = a.camera_name ? ` • ${a.camera_name}` : '';
          toast.custom(
            () => (
              <div
                className="max-w-sm rounded-2xl border bg-slate-900 p-3 text-sm text-slate-100 shadow-lg"
                style={{ borderColor: isAcc ? 'rgba(248,113,113,0.35)' : 'rgba(251,191,36,0.35)' }}
              >
                <div className="flex items-center gap-3">
                  {isAcc ? (
                    <AlertTriangle className="w-5 h-5 text-rose-300" />
                  ) : (
                    <Radio className="w-5 h-5 text-amber-300" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-white">{title}</p>
                    <p className="text-slate-400 text-xs">View full details in Alerts{cam}</p>
                  </div>
                </div>
              </div>
            ),
            { duration: 3000, id: a.id },
          );
        });
      } catch (err) {
        // silently ignore toast polling errors
      }
    };

    poll();
    const interval = setInterval(poll, 7000);
    return () => clearInterval(interval);
  }, []);

  const handleOverride = async (cameraName, action, targetRoi = null) => {
    try {
      await axios.post(`${API_BASE}/api/override`, {
        camera_name: cameraName,
        action: action,
        target_roi: targetRoi,
        duration: 60,
      });
      toast.success(`Command sent: ${cameraName} → ${action}`);
    } catch (err) {
      console.error('Override failed', err);
      toast.error('Failed to send override command');
    }
  };

  const requestOverride = (cameraName, action, targetRoi = null) => {
    if (action === 'AUTO') {
      handleOverride(cameraName, action, targetRoi);
      return;
    }
    setConfirmOverride({ cameraName, action, targetRoi });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-sky-500/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-transparent border-t-sky-500 rounded-full animate-spin" />
            <Mountain className="absolute inset-0 m-auto w-8 h-8 text-sky-400" />
          </div>
          <p className="text-sky-400 font-medium">Connecting to AlpenMesh...</p>
          <p className="text-gray-500 text-sm mt-1">Initializing traffic nodes</p>
        </div>
      </div>
    );
  }

  const totalVehicles = metrics.reduce((sum, cam) => sum + (cam.total_vehicles || 0), 0);
  const congestionData = [
    {
      name: 'Low',
      value: metrics.filter((m) =>
        Object.values(m.congestion_levels || {}).every((v) => v === 'Low'),
      ).length,
      color: '#22c55e',
    },
    {
      name: 'Medium',
      value: metrics.filter((m) => Object.values(m.congestion_levels || {}).includes('Medium'))
        .length,
      color: '#eab308',
    },
    {
      name: 'High',
      value: metrics.filter((m) => Object.values(m.congestion_levels || {}).includes('High'))
        .length,
      color: '#ef4444',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900 text-gray-100 p-6">
      {fetchError ? (
        <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Connection issue</p>
            <p className="text-rose-200/80 text-xs mt-0.5">{fetchError}</p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="shrink-0 px-3 py-2 rounded-lg border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/15 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      ) : null}
      {/* Alpine Banner */}
      <MountainBanner
        totalVehicles={totalVehicles}
        activeCameras={metrics.length}
        systemUptime={99.9}
      />

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Camera Controls */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Signal className="w-5 h-5 text-sky-400" />
              Traffic Nodes
            </h2>
            <button
              type="button"
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              onClick={fetchData}
              aria-label="Refresh traffic node data"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="space-y-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700">
            {metrics.map((cam) => (
              <CameraCard
                key={cam.camera_name}
                cam={cam}
                override={status?.active_overrides?.[cam.camera_name]}
                user={user}
                onRequestOverride={requestOverride}
              />
            ))}

            {metrics.length === 0 && (
              <GlassCard className="p-8 text-center">
                <Video className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No active traffic nodes detected</p>
                <p className="text-gray-600 text-sm mt-1">Waiting for camera connections...</p>
              </GlassCard>
            )}
          </div>
        </div>

        {/* Right: Analytics */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Real-time Flow Chart */}
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-5 h-5 text-sky-400" />
                Real-time Traffic Flow
              </h3>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Clock className="w-4 h-4" />
                Updated every 2s
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData}>
                  <defs>
                    <linearGradient id="vehicleGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="time" stroke="#6b7280" fontSize={12} tickLine={false} />
                  <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="vehicles"
                    stroke="#0ea5e9"
                    strokeWidth={3}
                    fill="url(#vehicleGradient)"
                    name="Vehicles"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* Congestion Pie Chart */}
            <GlassCard className="p-4">
              <h4 className="text-sm text-gray-400 mb-3">Congestion Distribution</h4>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={congestionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {congestionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-2">
                {congestionData.map((item) => (
                  <div key={item.name} className="flex items-center gap-1 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-gray-400">{item.name}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* System Health */}
            <GlassCard className="p-4">
              <h4 className="text-sm text-gray-400 mb-3">System Health</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">AI Engine</span>
                  <span className="text-green-400 text-xs font-medium">Optimal</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full w-[95%] bg-gradient-to-r from-green-500 to-cyan-500 rounded-full" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Network</span>
                  <span className="text-green-400 text-xs font-medium">12ms</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full w-[88%] bg-gradient-to-r from-sky-500 to-blue-500 rounded-full" />
                </div>
              </div>
            </GlassCard>

            {/* Quick Stats */}
            <GlassCard className="p-4">
              <h4 className="text-sm text-gray-400 mb-3">Quick Stats</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-black/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-gray-300">Alerts</span>
                  </div>
                  <span className="text-lg font-bold text-white">0</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-black/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-gray-300">Online</span>
                  </div>
                  <span className="text-lg font-bold text-white">{metrics.length}</span>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmOverride}
        tone="danger"
        title="Send manual override?"
        description={
          confirmOverride
            ? `Camera: ${confirmOverride.cameraName} • Action: ${confirmOverride.action} (60s)`
            : undefined
        }
        confirmText="Send override"
        cancelText="Cancel"
        onCancel={() => setConfirmOverride(null)}
        onConfirm={() => {
          const p = confirmOverride;
          setConfirmOverride(null);
          if (p) handleOverride(p.cameraName, p.action, p.targetRoi);
        }}
      />
    </div>
  );
}
