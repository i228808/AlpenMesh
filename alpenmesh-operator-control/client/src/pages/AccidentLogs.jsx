import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ImageOff,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  ShieldAlert,
  StickyNote,
  Trash2,
  XCircle,
  Zap,
  Activity,
  Car,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Link } from 'react-router-dom';

const REPORTING_BASE = 'http://localhost:8001';

// ── Accent colour per status ──────────────────────────────────────────────────
const STATUS_META = {
  open:          { bar: 'bg-rose-500',    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/25',    label: 'Pending Review' },
  confirmed:     { bar: 'bg-rose-700',    badge: 'bg-rose-700/20 text-rose-200 border-rose-600/30',    label: 'Confirmed' },
  false_alarm:   { bar: 'bg-slate-600',   badge: 'bg-slate-700/30 text-slate-400 border-slate-600/20', label: 'False Alarm' },
  investigating: { bar: 'bg-amber-500',   badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25', label: 'Investigating' },
  resolved:      { bar: 'bg-emerald-600', badge: 'bg-emerald-600/15 text-emerald-300 border-emerald-600/25', label: 'Resolved' },
};

const meta = (status) => STATUS_META[status] ?? STATUS_META.open;

const formatTime = (ts, human) => {
  if (human) return human;
  if (!ts) return 'Unknown';
  return new Date(ts * 1000).toLocaleString();
};

// ── Emergency modal ───────────────────────────────────────────────────────────
const EmergencyModal = ({ camera, onClose }) => {
  const dispatchId = useRef(`EMG-${Date.now().toString(36).toUpperCase()}`);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleAck = () => {
    setAcknowledged(true);
    setTimeout(onClose, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-sm mx-4 rounded-3xl border border-rose-500/30 bg-[#0f0a0a] shadow-2xl shadow-rose-950 overflow-hidden">
        {/* top bar */}
        <div className="h-1 w-full bg-gradient-to-r from-rose-700 via-rose-500 to-orange-500" />

        <div className="px-8 pt-8 pb-10 text-center">
          {/* icon */}
          <div className="relative mx-auto mb-7 w-20 h-20">
            <div className="absolute inset-0 rounded-full bg-rose-500/10 animate-ping" />
            <div className="absolute inset-2 rounded-full bg-rose-500/15" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Phone className="w-8 h-8 text-rose-400" strokeWidth={1.5} />
            </div>
          </div>

          <p className="text-[10px] font-bold tracking-[0.25em] text-rose-500 uppercase mb-2">
            Emergency Dispatch
          </p>
          <h2 className="text-2xl font-black text-white mb-1 tracking-tight leading-tight">
            Services Contacted
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-7">
            Units dispatched to{' '}
            <span className="text-rose-300 font-semibold">
              {camera?.replace(/__/g, ' & ').replace(/_/g, ' ') || 'incident location'}
            </span>
          </p>

          {/* dispatch info */}
          <div className="rounded-xl border border-white/5 bg-white/[0.03] divide-y divide-white/5 text-xs mb-7">
            {[
              ['Dispatch ID', dispatchId.current],
              ['Time', new Date().toLocaleTimeString()],
              ['Priority', 'HIGH'],
              ['Status', 'ACKNOWLEDGED'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-slate-500 font-medium tracking-wide">{k}</span>
                <span className={`font-mono font-bold ${k === 'Status' ? 'text-emerald-400' : k === 'Priority' ? 'text-rose-400' : 'text-slate-200'}`}>
                  {v}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={handleAck}
            disabled={acknowledged}
            className={`w-full py-3 rounded-xl font-black text-sm tracking-widest uppercase transition-all duration-300 ${
              acknowledged
                ? 'bg-emerald-600/80 text-white'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/50 hover:shadow-rose-700/40'
            }`}
          >
            {acknowledged ? '✓ Confirmed' : 'Acknowledged'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Inline notes editor ───────────────────────────────────────────────────────
const NotesEditor = ({ id, initialNotes, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${REPORTING_BASE}/accidents/${id}`, { notes: value });
      onSaved(value);
      setEditing(false);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left flex items-start gap-2.5 group rounded-xl px-3.5 py-2.5 border border-transparent hover:border-white/10 hover:bg-white/[0.03] transition-all"
      >
        <FileText className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0 group-hover:text-slate-400 transition-colors" />
        <span className="flex-1 text-xs text-slate-400 group-hover:text-slate-300 transition-colors leading-relaxed">
          {value || <span className="italic text-slate-600">No operator notes — click to add</span>}
        </span>
        <Pencil className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0 mt-0.5" />
      </button>
    );
  }

  return (
    <div className="space-y-2 px-1">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder="Add operator notes…"
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50 resize-none leading-relaxed"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold tracking-wide disabled:opacity-50 transition-all"
        >
          {saving ? 'Saving…' : 'Save notes'}
        </button>
        <button
          onClick={() => { setValue(initialNotes || ''); setEditing(false); }}
          className="px-4 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5 text-xs transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Metric chip ───────────────────────────────────────────────────────────────
const Chip = ({ label, value, color = 'slate' }) => {
  const colors = {
    slate: 'border-slate-700/50 bg-slate-800/40 text-slate-300',
    rose:  'border-rose-500/20  bg-rose-500/10  text-rose-300',
    sky:   'border-sky-500/20   bg-sky-500/10   text-sky-300',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  };
  return (
    <div className={`rounded-lg border px-3 py-1.5 ${colors[color]}`}>
      <p className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-60 mb-0.5">{label}</p>
      <p className="text-xs font-bold tabular-nums">{value}</p>
    </div>
  );
};

// ── Accident card ─────────────────────────────────────────────────────────────
const AccidentCard = ({ log: initialLog, onRequestDelete, onStatus }) => {
  const [log, setLog] = useState(initialLog);
  const [showEmergency, setShowEmergency] = useState(false);

  const m = meta(log.status);
  const imgUrl = log.image_id ? `${REPORTING_BASE}/image/${log.image_id}` : null;
  const involved = log.details?.involved_ids || [];
  const reasons  = log.details?.reasons || [];
  const lanes    = log.details?.lanes || [];
  const iou      = log.details?.iou;
  const sp1      = log.details?.speed_1;
  const sp2      = log.details?.speed_2;

  const setStatus = (s) => {
    setLog((p) => ({ ...p, status: s }));
    onStatus(log.id, s);
  };

  const locationLabel = log.camera_name?.replace(/__/g, ' & ').replace(/_/g, ' ') || 'Unknown location';

  return (
    <>
      {showEmergency && (
        <EmergencyModal camera={log.camera_name} onClose={() => setShowEmergency(false)} />
      )}

      <div className="flex flex-col rounded-2xl overflow-hidden border border-white/[0.07] bg-[#0d1117] shadow-xl shadow-black/40 hover:border-white/[0.12] transition-colors">

        {/* ── Accent bar ── */}
        <div className={`h-[3px] w-full ${m.bar}`} />

        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 shrink-0 p-2 rounded-xl bg-rose-500/10 border border-rose-500/15">
              <AlertTriangle className="w-4 h-4 text-rose-400" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white leading-tight tracking-tight truncate">
                {locationLabel}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Clock className="w-3 h-3" />{formatTime(log.timestamp, log.datetime)}
                </span>
                {lanes.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <MapPin className="w-3 h-3" />Lanes {lanes.join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${m.badge}`}>
              {m.label}
            </span>
            {log.camera_name && (
              <Link
                to={`/camera-map?camera=${encodeURIComponent(log.camera_name)}`}
                className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                title="Open on map"
              >
                <MapPin className="w-3.5 h-3.5" />
              </Link>
            )}
            <button
              onClick={() => onRequestDelete(log.id)}
              className="p-1.5 rounded-lg border border-white/10 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Delete log"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Snapshot ── */}
        <div className="mx-5 rounded-xl overflow-hidden border border-white/[0.07] bg-black/40 relative">
          {imgUrl ? (
            <img src={imgUrl} alt="Accident frame" className="w-full h-44 object-cover" loading="lazy" />
          ) : (
            <div className="h-44 flex flex-col items-center justify-center gap-2 text-slate-700">
              <ImageOff className="w-5 h-5" />
              <span className="text-[11px] tracking-wide">No snapshot available</span>
            </div>
          )}
          {/* live badge overlay */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-300 tracking-widest uppercase">Incident</span>
          </div>
        </div>

        {/* ── AI detection details ── */}
        <div className="px-5 pt-4 pb-3 space-y-3">
          {/* Metric chips */}
          <div className="flex flex-wrap gap-2">
            {iou != null && (
              <Chip label="IoU Overlap" value={iou.toFixed(3)} color="rose" />
            )}
            {sp1 != null && (
              <Chip label="Speed 1" value={`${sp1.toFixed(1)} px/s`} color="sky" />
            )}
            {sp2 != null && (
              <Chip label="Speed 2" value={`${sp2.toFixed(1)} px/s`} color="sky" />
            )}
            {involved.length > 0 && (
              <Chip label="Vehicles" value={involved.length.toString()} color="amber" />
            )}
          </div>

          {/* Involved / reasons */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-1">Involved</p>
              <p className="text-slate-300 font-medium leading-relaxed">
                {involved.join(', ') || 'N/A'}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-1">Reasons</p>
              <p className="text-slate-300 font-medium leading-relaxed">
                {reasons.join(', ') || 'Unspecified'}
              </p>
            </div>
          </div>

          {/* Operator notes */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-3.5 pt-2.5 pb-1 flex items-center gap-2">
              <StickyNote className="w-3 h-3 text-slate-600" />
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Operator Notes</span>
            </div>
            <div className="pb-2">
              <NotesEditor
                id={log.id}
                initialNotes={log.notes}
                onSaved={(notes) => setLog((p) => ({ ...p, notes }))}
              />
            </div>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-5 h-px bg-white/[0.05]" />

        {/* ── Human-in-the-loop review ── */}
        <div className="px-5 py-4 space-y-2.5">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              Operator Review
            </span>
          </div>

          {/* Confirm / False alarm */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setStatus('confirmed')}
              className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                log.status === 'confirmed'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/40 ring-1 ring-rose-500/50'
                  : 'border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 bg-transparent'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
            </button>
            <button
              onClick={() => setStatus('false_alarm')}
              className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                log.status === 'false_alarm'
                  ? 'bg-slate-600 text-white ring-1 ring-slate-500/50'
                  : 'border border-slate-600/30 text-slate-500 hover:bg-slate-700/20 bg-transparent'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" /> False Alarm
            </button>
          </div>

          {/* Emergency services */}
          <button
            onClick={() => setShowEmergency(true)}
            className="w-full py-3 rounded-xl border border-rose-700/40 bg-rose-900/20 hover:bg-rose-900/35 text-rose-300 text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 hover:border-rose-600/50 hover:shadow-[0_0_24px_rgba(190,18,60,0.2)]"
          >
            <Phone className="w-3.5 h-3.5" /> Call Emergency Services
          </button>
        </div>

        {/* ── Workflow ── */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setStatus('investigating')}
            className={`py-2.5 rounded-xl text-[11px] font-bold tracking-wide transition-all ${
              log.status === 'investigating'
                ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                : 'border border-white/[0.07] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            Investigating
          </button>
          <button
            onClick={() => setStatus('resolved')}
            className={`py-2.5 rounded-xl text-[11px] font-bold tracking-wide transition-all flex items-center justify-center gap-1.5 ${
              log.status === 'resolved'
                ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-600/40'
                : 'border border-white/[0.07] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
          </button>
        </div>
      </div>
    </>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────
const Shell = ({ children }) => (
  <div className="relative overflow-hidden rounded-2xl bg-[#0d1117] border border-white/[0.07] shadow-xl">
    <div className="relative z-10">{children}</div>
  </div>
);

const AccidentLogs = () => {
  const [logs, setLogs]                       = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [query, setQuery]                     = useState('');
  const [statusFilter, setStatusFilter]       = useState('all');
  const [sortOrder, setSortOrder]             = useState('newest');
  const [page, setPage]                       = useState(1);
  const pageSize = 20;

  const fetchLogs = async () => {
    try {
      const res = await axios.get(`${REPORTING_BASE}/accidents?limit=80`);
      setLogs(res.data || []);
    } catch {
      setError('Could not load accident archive');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${REPORTING_BASE}/accidents/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      toast.success('Log deleted');
    } catch {
      toast.error('Failed to delete log');
    }
  };

  const handleStatus = async (id, status) => {
    try {
      await axios.patch(`${REPORTING_BASE}/accidents/${id}`, { status });
      setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    } catch {
      toast.error('Failed to update status');
    }
  };

  const pendingReview = logs.filter((l) => !l.status || l.status === 'open');

  return (
    <div className="min-h-screen bg-[#080c10] text-slate-50 p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] text-rose-500 uppercase mb-2">
              AlpenMesh · Accident Management
            </p>
            <h1 className="text-3xl font-black text-white tracking-tight leading-none">
              Accident Archive
            </h1>
            <p className="text-slate-500 text-sm mt-2 leading-relaxed max-w-lg">
              Review AI-detected incidents, confirm or dismiss detections, add operator notes, and dispatch emergency services.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live sync · reporting agent
          </div>
        </div>

        {/* ── Pending review banner ── */}
        {!loading && pendingReview.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/20">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-200 leading-tight">
                  {pendingReview.length} detection{pendingReview.length !== 1 ? 's' : ''} awaiting operator review
                </p>
                <p className="text-xs text-amber-400/60 mt-0.5">
                  Confirm or dismiss to clear the queue
                </p>
              </div>
            </div>
            <button
              onClick={() => setStatusFilter('open')}
              className="shrink-0 px-4 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-bold tracking-wide transition-all"
            >
              Show pending
            </button>
          </div>
        )}

        {/* ── Filters ── */}
        {!loading && !error && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search camera, vehicle IDs, reasons…"
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
            >
              <option value="all">All statuses</option>
              <option value="open">Pending Review</option>
              <option value="confirmed">Confirmed</option>
              <option value="false_alarm">False Alarm</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <button
              onClick={() => { setQuery(''); setStatusFilter('all'); setSortOrder('newest'); setPage(1); }}
              className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] text-sm transition-all"
            >
              Reset
            </button>
          </div>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-5 h-5 text-rose-400 animate-spin" />
            <span className="ml-3 text-slate-500 text-sm">Loading incident data…</span>
          </div>
        ) : error ? (
          <div className="text-center text-rose-400 bg-rose-500/8 border border-rose-500/20 rounded-2xl p-6 text-sm">
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {(() => {
              const q = query.trim().toLowerCase();
              const filtered = logs
                .filter((log) => {
                  const s = log.status || 'open';
                  if (statusFilter !== 'all' && s !== statusFilter) return false;
                  if (!q) return true;
                  const hay = `${log.camera_name || ''} ${(log.details?.involved_ids || []).join(' ')} ${(log.details?.reasons || []).join(' ')}`.toLowerCase();
                  return hay.includes(q);
                })
                .sort((a, b) => sortOrder === 'oldest'
                  ? (a.timestamp || 0) - (b.timestamp || 0)
                  : (b.timestamp || 0) - (a.timestamp || 0));

              const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
              const safePage   = Math.min(page, totalPages);
              const pageItems  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

              return (
                <>
                  <div className="md:col-span-2 text-xs text-slate-600 px-1">
                    <span className="text-slate-400">{pageItems.length}</span> of{' '}
                    <span className="text-slate-400">{filtered.length}</span> incidents
                  </div>

                  {pageItems.map((log) => (
                    <AccidentCard
                      key={log.id}
                      log={log}
                      onRequestDelete={(id) => setConfirmDeleteId(id)}
                      onStatus={handleStatus}
                    />
                  ))}

                  {filtered.length === 0 && (
                    <div className="md:col-span-2 text-center text-slate-600 rounded-2xl border border-white/[0.05] bg-white/[0.02] py-12 text-sm">
                      No incidents match your filters.
                    </div>
                  )}

                  {filtered.length > 0 && totalPages > 1 && (
                    <div className="md:col-span-2 flex items-center justify-between pt-1">
                      <button
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="px-4 py-2 rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.04] text-xs disabled:opacity-30 transition-all"
                      >
                        ← Previous
                      </button>
                      <span className="text-xs text-slate-600">
                        Page <span className="text-slate-300">{safePage}</span> / <span className="text-slate-300">{totalPages}</span>
                      </span>
                      <button
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-4 py-2 rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.04] text-xs disabled:opacity-30 transition-all"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            {logs.length === 0 && (
              <div className="md:col-span-2 text-center text-slate-600 rounded-2xl border border-white/[0.05] bg-white/[0.02] py-16 text-sm">
                No accidents recorded yet.
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId != null}
        tone="danger"
        title="Delete this accident log?"
        description="This removes the log and its snapshot from the archive. Cannot be undone."
        confirmText="Delete log"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id != null) handleDelete(id);
        }}
      />
    </div>
  );
};

export default AccidentLogs;
