import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Assignment, InventoryItem, Site } from '../types';
import { todayStr } from '../utils/storage';
import {
  ReportScope, flattenSessions, filterByScope, buildCategoryTree,
  buildCollectorTotals, buildCollectorDaily, sessionsToCsv, downloadCsv,
} from '../utils/collectionReport';

interface CollectionReportViewProps {
  assignments: Assignment[];
  sites: Site[];
  inventory: InventoryItem[];
}

const SCOPES: { id: ReportScope; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'all', label: 'Overall' },
];

type ReportView = 'category' | 'hours';
const VIEWS: { id: ReportView; label: string }[] = [
  { id: 'category', label: 'Category' },
  { id: 'hours', label: 'Shoot Log' },
];

export const CollectionReportView: React.FC<CollectionReportViewProps> = ({ assignments, sites, inventory }) => {
  const [view, setView] = useState<ReportView>('category');
  const [scope, setScope] = useState<ReportScope>('day');
  const [refDate, setRefDate] = useState(todayStr());
  const [collectorFilter, setCollectorFilter] = useState('');
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openSites, setOpenSites] = useState<Set<string>>(new Set());

  const allRows = useMemo(() => flattenSessions(assignments, sites, inventory), [assignments, sites, inventory]);
  const collectors = useMemo(() => {
    const m = new Map<string, string>();
    allRows.forEach(r => m.set(r.collectorId, r.collectorName));
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);
  const scopedRows = useMemo(
    () => (collectorFilter ? allRows.filter(r => r.collectorId === collectorFilter) : allRows),
    [allRows, collectorFilter]
  );
  const rows = useMemo(() => filterByScope(scopedRows, scope, refDate), [scopedRows, scope, refDate]);

  const tree = useMemo(() => buildCategoryTree(rows), [rows]);
  const collectorTotals = useMemo(() => buildCollectorTotals(rows), [rows]);
  const collectorDaily = useMemo(() => buildCollectorDaily(rows), [rows]);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  const toggleCat = (c: string) => setOpenCats(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const toggleSite = (id: string) => setOpenSites(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const scopeLabel = scope === 'day' ? refDate : scope === 'week' ? `week of ${refDate}` : scope === 'month' ? refDate.slice(0, 7) : 'all time';

  const collectorSuffix = collectorFilter ? `-${collectors.find(c => c.id === collectorFilter)?.name.replace(/\s+/g, '_')}` : '';
  const exportCsv = () => downloadCsv(`shoot-report-${scope}-${refDate}${collectorSuffix}.csv`, sessionsToCsv(rows));

  const th = 'px-3 py-2 font-semibold';
  const td = 'px-3 py-2';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Shoot Report</h2>
          <p className="text-xs text-slate-500">
            <strong>Category</strong>: Category (the Site Type set when the site was added) → Site → Task, with hours.{' '}
            <strong>Shoot Log</strong>: one row per camera/task entry, for your CSV. Hours are exactly what each worker logged, dated by when they logged it.
          </p>
        </div>
        <button onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg shadow-sm">
          <Download className="w-4 h-4" /> Export CSV ({scopeLabel})
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {SCOPES.map(s => (
            <button key={s.id} onClick={() => setScope(s.id)}
              className={`px-3 py-1 rounded text-xs font-medium ${scope === s.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              {s.label}
            </button>
          ))}
        </div>
        {scope === 'day' && (
          <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs" />
        )}
        {scope === 'week' && (
          <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)}
            title="Pick any date in the week you want to see"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs" />
        )}
        {scope === 'month' && (
          <input type="month" value={refDate.slice(0, 7)} onChange={e => setRefDate(`${e.target.value}-01`)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs" />
        )}
        <select value={collectorFilter} onChange={e => setCollectorFilter(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
          <option value="">All field workers</option>
          {collectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-xs text-slate-400">
          Showing: {scopeLabel} · {rows.length} logged entr{rows.length === 1 ? 'y' : 'ies'} · {totalHours.toFixed(1)}h
        </span>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-4 py-1.5 rounded text-xs font-semibold ${view === v.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'category' && (
      <>
      {/* Category -> Site -> Task tree */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">By category, site &amp; task</div>
        {tree.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-400">No hours logged in this range yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {tree.map(cat => (
              <div key={cat.category}>
                <button onClick={() => toggleCat(cat.category)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 text-left">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                    {openCats.has(cat.category) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {cat.category}
                  </span>
                  <span className="font-bold text-slate-900">{cat.hours.toFixed(1)}h</span>
                </button>
                {openCats.has(cat.category) && (
                  <div className="pl-6 pb-2">
                    {cat.sites.map(site => (
                      <div key={site.siteId}>
                        <button onClick={() => toggleSite(site.siteId)}
                          className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50 text-left">
                          <span className="flex items-center gap-1.5 text-slate-700">
                            {openSites.has(site.siteId) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {site.siteName}
                          </span>
                          <span className="font-semibold text-slate-800">{site.hours.toFixed(1)}h</span>
                        </button>
                        {openSites.has(site.siteId) && (
                          <div className="pl-6">
                            {site.tasks.map(t => (
                              <div key={t.task} className="flex items-center justify-between px-4 py-1.5 text-slate-500">
                                <span>{t.task}</span>
                                <span>{t.hours.toFixed(1)}h</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {view === 'hours' && (
      <>
      {/* Shoot log: cam code, task, hour, type, site — one row per logged entry */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">Shoot log — cam code, task, hour, type &amp; site for every entry</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className={th}>Date</th><th className={th}>Data Collector</th><th className={th}>Cam Code</th>
                <th className={th}>Task Name</th><th className={th}>Hours</th><th className={th}>Type</th><th className={th}>Site</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No entries.</td></tr>}
              {[...rows].sort((a, b) => b.date.localeCompare(a.date)).map(r => (
                <tr key={r.sessionId} className="hover:bg-slate-50">
                  <td className={`${td} text-slate-500`}>{r.date}</td>
                  <td className={`${td} font-medium text-slate-900`}>{r.collectorName}</td>
                  <td className={`${td} font-mono text-slate-600`} title={r.cameraName}>{r.cameraCode}</td>
                  <td className={`${td} text-slate-600`}>{r.task}</td>
                  <td className={`${td} font-semibold text-slate-800`}>{r.hours.toFixed(2)}h</td>
                  <td className={`${td} text-slate-600`}>{r.siteCategory}</td>
                  <td className={`${td} text-slate-600`}>{r.siteName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per collector totals */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">By data collector — totals</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr><th className={th}>Data Collector</th><th className={th}>Hours</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {collectorTotals.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>}
              {collectorTotals.map(c => (
                <tr key={c.collectorId}>
                  <td className={`${td} font-medium text-slate-900`}>{c.collectorName}</td>
                  <td className={`${td} font-semibold text-slate-800`}>{c.hours.toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily per collector */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">By data collector — daily</div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left sticky top-0">
              <tr><th className={th}>Date</th><th className={th}>Data Collector</th><th className={th}>Hours</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {collectorDaily.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>}
              {collectorDaily.map((d, i) => (
                <tr key={i}>
                  <td className={`${td} text-slate-500`}>{d.date}</td>
                  <td className={`${td} font-medium text-slate-900`}>{d.collectorName}</td>
                  <td className={`${td} font-semibold text-slate-800`}>{d.hours.toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
