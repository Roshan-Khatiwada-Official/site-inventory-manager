import React, { useMemo, useState } from 'react';
import { Users, Building2, Clock, Search as SearchIcon, CalendarRange } from 'lucide-react';
import { Assignment, Site, UserAccount, CAN_COLLECT } from '../types';

interface ReportsViewProps {
  sites: Site[];
  assignments: Assignment[];
  users: UserAccount[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ sites, assignments, users }) => {
  const [collectorFilter, setCollectorFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const dataCollectors = users.filter(u => CAN_COLLECT.includes(u.role));
  const siteFinders = users.filter(u => u.role === 'Site Finder');
  const siteById = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites]);
  const hasDateFilter = !!(fromDate || toDate);

  // Selecting a field worker below scopes every section on this page — the
  // detail log, the per-site/per-collector summaries, and the totals — to
  // just their work, not only the top table. Hours everywhere are exactly
  // what the worker entered per session — no separate "verified" figure.
  const scopedAssignments = useMemo(
    () => (collectorFilter ? assignments.filter(a => a.collectorId === collectorFilter) : assignments),
    [assignments, collectorFilter]
  );

  // Hours are logged per session with their own date, so a date-range filter
  // has to look at each session, not the assignment as a whole (one
  // assignment can span sessions on many different dates).
  const hoursInRange = (a: Assignment) =>
    a.sessions
      .filter(s => (!fromDate || s.date >= fromDate) && (!toDate || s.date <= toDate))
      .reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
  const sessionsInRangeCount = (a: Assignment) =>
    a.sessions.filter(s => (!fromDate || s.date >= fromDate) && (!toDate || s.date <= toDate)).length;

  const rows = useMemo(() => {
    return scopedAssignments
      .map(a => {
        const site = siteById.get(a.siteId);
        return {
          id: a.id,
          collectorName: a.collectorName,
          collectorId: a.collectorId,
          siteName: a.siteName || site?.name || '(missing)',
          siteId: a.siteId,
          foundByName: site?.foundByName || '—',
          hours: hoursInRange(a),
          sessions: sessionsInRangeCount(a),
          status: a.status,
        };
      })
      .filter(r => !hasDateFilter || r.sessions > 0)
      .filter(r => !siteFilter || r.siteId === siteFilter)
      .filter(r => {
        const t = q.toLowerCase();
        return !t || r.collectorName.toLowerCase().includes(t) || r.siteName.toLowerCase().includes(t) || r.foundByName.toLowerCase().includes(t);
      })
      .sort((a, b) => b.hours - a.hours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedAssignments, siteById, siteFilter, q, fromDate, toDate]);

  const perSite = useMemo(() => {
    const m = new Map<string, { siteName: string; foundByName: string; hours: number; collectors: Set<string> }>();
    scopedAssignments.forEach(a => {
      const hours = hoursInRange(a);
      if (hasDateFilter && hours <= 0) return;
      const site = siteById.get(a.siteId);
      const key = a.siteId;
      if (!m.has(key)) m.set(key, { siteName: a.siteName || site?.name || '(missing)', foundByName: site?.foundByName || '—', hours: 0, collectors: new Set() });
      const e = m.get(key)!;
      e.hours += hours;
      if (a.collectorName) e.collectors.add(a.collectorName);
    });
    return [...m.values()].sort((a, b) => b.hours - a.hours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedAssignments, siteById, fromDate, toDate]);

  const perCollector = useMemo(() => {
    const m = new Map<string, { name: string; hours: number; sites: Set<string> }>();
    scopedAssignments.forEach(a => {
      const hours = hoursInRange(a);
      if (hasDateFilter && hours <= 0) return;
      if (!m.has(a.collectorId)) m.set(a.collectorId, { name: a.collectorName, hours: 0, sites: new Set() });
      const e = m.get(a.collectorId)!;
      e.hours += hours;
      e.sites.add(a.siteId);
    });
    return [...m.values()].sort((a, b) => b.hours - a.hours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedAssignments, fromDate, toDate]);

  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  const stat = (icon: React.ReactNode, label: string, value: string | number) => (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-[11px] font-medium uppercase tracking-wide">{icon}{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );

  const th = 'px-4 py-2.5 font-semibold';
  const td = 'px-4 py-2.5';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Reports</h2>
        <p className="text-xs text-slate-500">Collection hours by field worker and site, and which Site Finder found each site. Hours shown are exactly what each worker logged.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat(<Users className="w-3.5 h-3.5" />, 'Field Workers', dataCollectors.length)}
        {stat(<Building2 className="w-3.5 h-3.5" />, 'Sites', sites.length)}
        {stat(<Clock className="w-3.5 h-3.5" />, hasDateFilter ? 'Hours in range' : 'Total Hours', totalHours.toFixed(1))}
        {stat(<Users className="w-3.5 h-3.5" />, 'Site Finders', siteFinders.length)}
      </div>

      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
            className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={collectorFilter} onChange={e => setCollectorFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
          <option value="">All field workers</option>
          {dataCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
          <option value="">All sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg bg-white">
          <CalendarRange className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[11px] text-slate-500 font-medium">From</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="text-xs focus:outline-none" />
        </label>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg bg-white">
          <CalendarRange className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[11px] text-slate-500 font-medium">To</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="text-xs focus:outline-none" />
        </label>
        {(collectorFilter || siteFilter || q || hasDateFilter) && (
          <button onClick={() => { setCollectorFilter(''); setSiteFilter(''); setQ(''); setFromDate(''); setToDate(''); }}
            className="text-xs text-blue-600 hover:underline">Clear filters</button>
        )}
      </div>

      {/* detail table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">Collection log — who collected where, for how long</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr><th className={th}>Field Worker</th><th className={th}>Site</th><th className={th}>Found by</th><th className={th}>Hours</th><th className={th}>Sessions</th><th className={th}>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No data.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className={`${td} font-medium text-slate-900`}>{r.collectorName}</td>
                  <td className={`${td} text-slate-600`}>{r.siteName}</td>
                  <td className={`${td} text-slate-600`}>{r.foundByName}</td>
                  <td className={`${td} font-semibold text-slate-800`}>{r.hours.toFixed(1)}h</td>
                  <td className={`${td} text-slate-600`}>{r.sessions}</td>
                  <td className={`${td} text-slate-500`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* per site */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">Total hours per site (+ who found it)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className={th}>Site</th><th className={th}>Found by</th><th className={th}>Collectors</th><th className={th}>Total hours</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {perSite.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>}
                {perSite.map((s, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className={`${td} font-medium text-slate-900`}>{s.siteName}</td>
                    <td className={`${td} text-slate-600`}>{s.foundByName}</td>
                    <td className={`${td} text-slate-600`}>{[...s.collectors].join(', ') || '—'}</td>
                    <td className={`${td} font-semibold text-slate-800`}>{s.hours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* per collector */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">Total hours per field worker</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className={th}>Field Worker</th><th className={th}>Sites</th><th className={th}>Total hours</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {perCollector.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>}
                {perCollector.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className={`${td} font-medium text-slate-900`}>{c.name}</td>
                    <td className={`${td} text-slate-600`}>{c.sites.size}</td>
                    <td className={`${td} font-semibold text-slate-800`}>{c.hours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
