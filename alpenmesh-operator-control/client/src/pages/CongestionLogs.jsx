import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { TrafficCone, Clock, MapPin, Gauge, ImageOff, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const REPORTING_BASE = 'http://localhost:8001';

const GradientCard = ({ children }) => (
  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/60 to-slate-950 border border-white/10 backdrop-blur-xl shadow-xl shadow-cyan-500/5">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.06),transparent_20%)] pointer-events-none" />
    <div className="relative z-10">{children}</div>
  </div>
);

const Badge = ({ children, tone = 'sky' }) => {
  const palette = {
    sky: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
    amber: 'bg-amber-500/15 text-amber-100 border-amber-400/30',
    rose: 'bg-rose-500/15 text-rose-100 border-rose-400/30',
    emerald: 'bg-emerald-500/15 text-emerald-100 border-emerald-400/30',
  }[tone];
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${palette}`}>
      {children}
    </span>
  );
};

const formatTime = (ts, human) => {
  if (human) return human;
  if (!ts) return 'Unknown';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
};

const CongestionLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get(`${REPORTING_BASE}/congestion-logs?limit=80`);
        setLogs(res.data || []);
      } catch (err) {
        setError('Could not load congestion archive');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Hero */}
        <GradientCard>
          <div className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-sky-500/20 border border-sky-400/30 shadow-lg shadow-sky-500/20">
                <TrafficCone className="w-6 h-6 text-sky-300" />
              </div>
              <div>
                <p className="text-xs tracking-[0.2em] text-sky-300/70 uppercase">
                  Congestion Archive
                </p>
                <h1 className="text-2xl font-semibold text-white">
                  Lane Pressure & Gridlock Signals
                </h1>
                <p className="text-sm text-slate-400">
                  Live snapshots and lane-level congestion logs captured by the reporting agent.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Streaming from MongoDB</span>
            </div>
          </div>
        </GradientCard>

        {!loading && !error ? (
          <GradientCard>
            <div className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search (camera, lane)…"
                  className="w-full sm:w-80 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                />
                <select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                >
                  <option value="all">All severities</option>
                  <option value="high">High load</option>
                  <option value="elevated">Elevated</option>
                  <option value="calm">Calm</option>
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
              <button
                onClick={() => {
                  setQuery('');
                  setSeverityFilter('all');
                  setSortOrder('newest');
                  setPage(1);
                }}
                className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-xs"
              >
                Clear
              </button>
            </div>
          </GradientCard>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 text-sky-300 animate-spin" />
            <span className="ml-3 text-slate-400">Gathering congestion signals…</span>
          </div>
        ) : error ? (
          <div className="text-center text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {(() => {
              const q = query.trim().toLowerCase();
              const filtered = (logs || [])
                .filter((log) => {
                  const highs = Object.entries(log.congestion_levels || {}).filter(
                    ([, v]) => v === 'High',
                  );
                  const mediums = Object.entries(log.congestion_levels || {}).filter(
                    ([, v]) => v === 'Medium',
                  );
                  const severity = highs.length ? 'high' : mediums.length ? 'elevated' : 'calm';

                  if (severityFilter !== 'all' && severity !== severityFilter) return false;

                  if (!q) return true;
                  const laneText = Object.keys(log.congestion_levels || {}).join(' ');
                  const hay = `${log.camera_name || ''} ${laneText}`.toLowerCase();
                  return hay.includes(q);
                })
                .sort((a, b) => {
                  const ta = a.timestamp || 0;
                  const tb = b.timestamp || 0;
                  return sortOrder === 'oldest' ? ta - tb : tb - ta;
                });

              const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
              const safePage = Math.min(page, totalPages);
              const start = (safePage - 1) * pageSize;
              const pageItems = filtered.slice(start, start + pageSize);

              return (
                <>
                  <div className="md:col-span-2 text-xs text-slate-500 px-1">
                    Showing <span className="text-slate-200">{pageItems.length}</span> of{' '}
                    <span className="text-slate-200">{filtered.length}</span> logs
                  </div>

                  {pageItems.map((log) => {
                    const highs = Object.entries(log.congestion_levels || {}).filter(
                      ([, v]) => v === 'High',
                    );
                    const mediums = Object.entries(log.congestion_levels || {}).filter(
                      ([, v]) => v === 'Medium',
                    );
                    const totalVehicles = log.total_vehicles ?? 0;
                    const imgUrl = log.image_id ? `${REPORTING_BASE}/image/${log.image_id}` : null;

                    return (
                      <GradientCard key={log.id}>
                        <div className="p-4 space-y-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 text-slate-300">
                                <MapPin className="w-4 h-4 text-sky-300" />
                                <span className="font-semibold text-white">
                                  {log.camera_name || 'Unknown node'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                <Clock className="w-3 h-3" />
                                <span>{formatTime(log.timestamp, log.datetime)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {log.camera_name ? (
                                <Link
                                  to={`/camera-map?camera=${encodeURIComponent(log.camera_name)}`}
                                  className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition-colors text-xs"
                                  title="Open camera on map"
                                >
                                  Open on map
                                </Link>
                              ) : null}
                              <Badge
                                tone={highs.length ? 'rose' : mediums.length ? 'amber' : 'emerald'}
                              >
                                {highs.length ? 'High load' : mediums.length ? 'Elevated' : 'Calm'}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-sm">
                            <Gauge className="w-4 h-4 text-sky-300" />
                            <span className="text-slate-300 font-medium">
                              {totalVehicles} vehicles
                            </span>
                            <span className="text-slate-500">across lanes</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(log.congestion_levels || {}).map(([lane, level]) => {
                              const tone =
                                level === 'High'
                                  ? 'rose'
                                  : level === 'Medium'
                                    ? 'amber'
                                    : 'emerald';
                              return (
                                <div
                                  key={lane}
                                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/5"
                                >
                                  <span className="text-xs text-slate-200 font-semibold">
                                    {lane}
                                  </span>
                                  <Badge tone={tone}>{level}</Badge>
                                </div>
                              );
                            })}
                            {Object.keys(log.congestion_levels || {}).length === 0 && (
                              <div className="col-span-2 text-center text-xs text-slate-500 py-3 border border-dashed border-white/10 rounded-xl">
                                No lane detail captured
                              </div>
                            )}
                          </div>

                          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt="Congestion frame"
                                className="w-full h-48 object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-48 flex flex-col items-center justify-center text-slate-600 gap-2">
                                <ImageOff className="w-5 h-5" />
                                <span className="text-xs">No snapshot stored</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </GradientCard>
                    );
                  })}

                  {filtered.length === 0 && (
                    <GradientCard>
                      <div className="p-8 text-center text-slate-400">
                        No logs match your filters.
                      </div>
                    </GradientCard>
                  )}

                  {filtered.length > 0 && totalPages > 1 ? (
                    <div className="md:col-span-2 flex items-center justify-between pt-2">
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

            {logs.length === 0 && (
              <GradientCard>
                <div className="p-8 text-center text-slate-400">
                  No congestion events logged yet.
                </div>
              </GradientCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CongestionLogs;
