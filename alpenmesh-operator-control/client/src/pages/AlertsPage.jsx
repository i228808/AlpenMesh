import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BellRing, Clock, MapPin, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Link } from 'react-router-dom';

const REPORTING_BASE = 'http://localhost:8001';

const Shell = ({ children }) => (
  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-white/10 shadow-xl shadow-sky-500/10">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(14,165,233,0.08),transparent_24%),radial-gradient(circle_at_80%_0%,rgba(236,72,153,0.06),transparent_20%)] pointer-events-none" />
    <div className="relative z-10">{children}</div>
  </div>
);

const formatTime = (ts) => {
  if (!ts) return 'Unknown';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
};

const AlertsPage = () => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${REPORTING_BASE}/alerts?limit=120`);
      setAlerts(res.data || []);
    } catch (err) {
      setError('Unable to load alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${REPORTING_BASE}/alerts/${id}`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast.success('Alert deleted');
    } catch (err) {
      toast.error('Failed to delete alert');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <Shell>
          <div className="p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-sky-500/20 border border-sky-400/30 shadow-lg shadow-sky-500/20">
                <BellRing className="w-6 h-6 text-sky-200" />
              </div>
              <div>
                <p className="text-xs tracking-[0.2em] text-sky-200/80 uppercase">Alerts Feed</p>
                <h1 className="text-2xl font-semibold text-white">Live Signals & Notices</h1>
                <p className="text-sm text-slate-400">
                  Alerts are retained for 24 hours, then pruned automatically.
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search alerts (camera, message, type)…"
                  className="w-full sm:w-80 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                />
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                >
                  <option value="all">All types</option>
                  <option value="accident">Accident</option>
                  <option value="congestion">Congestion</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setQuery('');
                    setTypeFilter('all');
                    setSortOrder('newest');
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-xs"
                >
                  Clear
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    fetchAlerts();
                  }}
                  className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-xs"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </Shell>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-sky-300 animate-spin" />
            <span className="ml-3 text-slate-400">Loading alerts…</span>
          </div>
        ) : error ? (
          <div className="text-center text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
            {error}
          </div>
        ) : (
          <div className="space-y-3">
            {(() => {
              const q = query.trim().toLowerCase();
              const filtered = (alerts || [])
                .filter((a) => {
                  if (typeFilter !== 'all' && a.type !== typeFilter) return false;
                  if (!q) return true;
                  const hay =
                    `${a.message || ''} ${a.type || ''} ${a.camera_name || ''}`.toLowerCase();
                  return hay.includes(q);
                })
                .sort((a, b) => {
                  const ta = a.created_at || 0;
                  const tb = b.created_at || 0;
                  return sortOrder === 'oldest' ? ta - tb : tb - ta;
                });

              const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
              const safePage = Math.min(page, totalPages);
              const start = (safePage - 1) * pageSize;
              const pageItems = filtered.slice(start, start + pageSize);

              return (
                <>
                  <div className="text-xs text-slate-500 px-1">
                    Showing <span className="text-slate-200">{pageItems.length}</span> of{' '}
                    <span className="text-slate-200">{filtered.length}</span> alerts
                  </div>

                  {pageItems.map((a) => (
                    <Shell key={a.id}>
                      <div className="p-4 flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-slate-200">
                            <BellRing className="w-4 h-4 text-sky-300" />
                            <span className="font-semibold text-white">{a.message || a.type}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(a.created_at)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {a.camera_name || 'Unknown node'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {a.camera_name ? (
                            <Link
                              to={`/camera-map?camera=${encodeURIComponent(a.camera_name)}`}
                              className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition-colors text-xs"
                              title="Open camera on map"
                            >
                              Open on map
                            </Link>
                          ) : null}
                          <button
                            onClick={() => setConfirmDeleteId(a.id)}
                            className="p-2 rounded-lg border border-white/10 text-rose-200 hover:bg-white/5 transition-colors"
                            title="Delete alert"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </Shell>
                  ))}

                  {filtered.length === 0 && (
                    <Shell>
                      <div className="p-6 text-center text-slate-400">
                        No alerts match your filters.
                      </div>
                    </Shell>
                  )}

                  {filtered.length > 0 && totalPages > 1 ? (
                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-xs disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        Prev
                      </button>
                      <div className="text-xs text-slate-500">
                        Page <span className="text-slate-200">{safePage}</span> /{' '}
                        <span className="text-slate-200">{totalPages}</span>
                      </div>
                      <button
                        type="button"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-xs disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              );
            })()}

            {alerts.length === 0 && (
              <Shell>
                <div className="p-6 text-center text-slate-400">
                  No alerts in the last 24 hours.
                </div>
              </Shell>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId != null}
        tone="danger"
        title="Delete this alert?"
        description="This removes the alert from the feed. This action cannot be undone."
        confirmText="Delete alert"
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

export default AlertsPage;
