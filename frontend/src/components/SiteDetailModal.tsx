import React, { useMemo } from 'react';
import { X, Building2, Clock, Users, UserCheck } from 'lucide-react';
import { Assignment, Site } from '../types';

interface SiteDetailModalProps {
  isOpen: boolean;
  site: Site | null;
  assignments: Assignment[];
  onClose: () => void;
}

export const SiteDetailModal: React.FC<SiteDetailModalProps> = ({ isOpen, site, assignments, onClose }) => {
  const siteAssignments = useMemo(
    () => (site ? assignments.filter(a => a.siteId === site.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [assignments, site]
  );

  const perCollector = useMemo(() => {
    const m = new Map<string, { name: string; hours: number; visits: number; active: boolean; lastDate: string }>();
    siteAssignments.forEach(a => {
      if (!m.has(a.collectorId)) m.set(a.collectorId, { name: a.collectorName, hours: 0, visits: 0, active: false, lastDate: a.createdAt });
      const e = m.get(a.collectorId)!;
      e.hours += a.hoursLogged;
      e.visits += 1;
      if (a.status === 'Active') e.active = true;
      if (a.createdAt > e.lastDate) e.lastDate = a.createdAt;
    });
    return [...m.values()].sort((a, b) => b.hours - a.hours);
  }, [siteAssignments]);

  const active = siteAssignments.filter(a => a.status === 'Active');
  const totalHours = siteAssignments.reduce((s, a) => s + a.hoursLogged, 0);

  const sessions = useMemo(() => {
    const rows: { date: string; collectorName: string; hours: number; note?: string }[] = [];
    siteAssignments.forEach(a => a.sessions.forEach(s => rows.push({ ...s, collectorName: a.collectorName })));
    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  }, [siteAssignments]);

  if (!isOpen || !site) return null;

  const th = 'px-3 py-2 font-semibold';
  const td = 'px-3 py-2';

  const stat = (icon: React.ReactNode, label: string, value: string | number) => (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-medium uppercase tracking-wide">{icon}{label}</div>
      <div className="text-lg font-bold text-slate-900 mt-0.5">{value}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">{site.name}</h3>
              <p className="text-[11px] text-slate-400 font-mono">{site.code} {site.category && `· ${site.category}`}</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 text-xs text-slate-700">
          <div className="grid grid-cols-3 gap-3">
            {stat(<Clock className="w-3 h-3" />, 'Total Hours', totalHours.toFixed(1))}
            {stat(<Users className="w-3 h-3" />, 'People Worked Here', perCollector.length)}
            {stat(<UserCheck className="w-3 h-3" />, 'Currently Working', active.length)}
          </div>

          <div>
            <h4 className="font-bold text-slate-800 mb-2">Currently working here</h4>
            {active.length === 0 ? (
              <p className="text-slate-400">Nobody is actively collecting here right now.</p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 text-slate-500 text-left">
                    <tr><th className={th}>Collector</th><th className={th}>Hours so far (entered / actual)</th><th className={th}>Since</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {active.map(a => (
                      <tr key={a.id}>
                        <td className={`${td} font-medium text-slate-900`}>{a.collectorName}</td>
                        <td className={`${td} font-semibold text-emerald-700`}>{a.hoursLogged.toFixed(1)}h</td>
                        <td className={`${td} text-slate-500`}>{a.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold text-slate-800 mb-2">Hours by collector (all visits combined)</h4>
            {perCollector.length === 0 ? (
              <p className="text-slate-400">No one has collected here yet.</p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 text-slate-500 text-left">
                    <tr><th className={th}>Collector</th><th className={th}>Visits</th><th className={th}>Total hours (entered / actual)</th><th className={th}>Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perCollector.map(c => (
                      <tr key={c.name}>
                        <td className={`${td} font-medium text-slate-900`}>{c.name}</td>
                        <td className={`${td} text-slate-600`}>{c.visits}</td>
                        <td className={`${td} font-semibold text-slate-800`}>{c.hours.toFixed(1)}h</td>
                        <td className={td}>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            c.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>{c.active ? 'Active' : 'Done for now'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {sessions.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-800 mb-2">Recent collection sessions</h4>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 text-slate-500 text-left">
                    <tr><th className={th}>Date</th><th className={th}>Collector</th><th className={th}>Hours (entered / actual)</th><th className={th}>Note</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map((s, i) => (
                      <tr key={i}>
                        <td className={`${td} text-slate-500`}>{s.date}</td>
                        <td className={`${td} font-medium text-slate-900`}>{s.collectorName}</td>
                        <td className={`${td} font-semibold text-slate-800`}>
                          {Number(s.hours).toFixed(1)}h
                        </td>
                        <td className={`${td} text-slate-500`}>{s.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
