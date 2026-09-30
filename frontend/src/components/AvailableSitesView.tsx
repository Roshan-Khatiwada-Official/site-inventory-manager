import React, { useState, useMemo } from 'react';
import { MapPin, Send, Search, Building2, Clock, Lock, X } from 'lucide-react';
import { Site, SiteRequest, Assignment } from '../types';
import { byNewest } from '../utils/storage';
interface AvailableSitesViewProps {
  sites: Site[];
  myRequests: SiteRequest[];
  assignments: Assignment[];
  currentUserId: string;
  onRequest: (siteId: string) => void;
  onCancelRequest: (requestId: string) => void;
}

export const AvailableSitesView: React.FC<AvailableSitesViewProps> = ({ sites, myRequests, assignments, currentUserId, onRequest, onCancelRequest }) => {
  const [q, setQ] = useState('');
  const hoursBySite = useMemo(() => {
    const m = new Map<string, number>();
    assignments.forEach(a => { m.set(a.siteId, (m.get(a.siteId) || 0) + (Number(a.hoursLogged) || 0)); });
    return m;
  }, [assignments]);
  // A site already in the collector's My Work (Active or Completed) is
  // never re-requestable from here — see `alreadyAssigned` below, which
  // takes priority when rendering. This only decides what an Approved
  // request's own badge should say otherwise.
  const latestRequestFor = (siteId: string) => {
    const candidates = [...myRequests].filter(x => x.siteId === siteId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const latest = candidates[0];
    if (latest?.status === 'Approved') {
      const hasAssignment = assignments.some(a => a.siteId === siteId && a.collectorId === currentUserId);
      if (!hasAssignment) return undefined;
    }
    return latest;
  };
  const list = sites.filter(s => {
    const t = q.toLowerCase();
    return s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t) || s.foundByName.toLowerCase().includes(t) || s.category.toLowerCase().includes(t);
  }).sort(byNewest);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Available Sites</h2>
        <p className="text-xs text-slate-500">Sites added by Site Finders. Request as many as you want — an admin approves each one, then it's yours to work.</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search sites…"
          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {list.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 flex flex-col items-center gap-2">
          <Building2 className="w-6 h-6" /> No available sites right now.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map(s => {
          const req = latestRequestFor(s.id);
          const st = req?.status;
          // Any assignment (Active or Completed) means this site is already
          // in the collector's My Work — covers both the self-claim case
          // (no request record to catch above) and re-requesting a site
          // they've already finished, either of which used to be able to
          // produce a second, empty entry once approved.
          const alreadyAssigned = assignments.some(a => a.siteId === s.id && a.collectorId === currentUserId);
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
              <div>
                <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  {s.name}
                  {s.reservedById === currentUserId && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 font-medium"><Lock className="w-2.5 h-2.5" />yours</span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-slate-400">{s.code}</div>
                {s.category && <div className="text-[11px] text-blue-600 font-medium mt-0.5">{s.category}</div>}
                {s.reservedById && s.reservedById !== currentUserId && (
                  <div className="text-[10px] text-slate-400 mt-0.5">{s.reservedByName} is also collecting here — you can still request it.</div>
                )}
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                {(s.latitude || s.longitude) ? (
                  <a className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                    href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer">
                    <MapPin className="w-3 h-3" /> {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                  </a>
                ) : null}
                {s.supervisor && <div>Supervisor: {s.supervisor} {s.supervisorContact && `· ${s.supervisorContact}`}</div>}
                <div>Workers: {s.workerCount}</div>
                <div>Found by: {s.foundByName || '—'}</div>
                <div className="inline-flex items-center gap-1 font-medium text-slate-700">
                  <Clock className="w-3 h-3 text-blue-500" />
                  {(hoursBySite.get(s.id) || 0).toFixed(1)}h collected here
                </div>
                {s.note && <div className="text-slate-400">{s.note}</div>}
              </div>
              <div className="mt-auto pt-2">
                {alreadyAssigned ? (
                  <span className="text-xs font-medium text-emerald-600">Already assigned — see “My Work”</span>
                ) : st === 'Pending' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-amber-600">Request pending…</span>
                    <button onClick={() => onCancelRequest(req!.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                ) : st === 'Approved' ? (
                  <span className="text-xs font-medium text-emerald-600">Approved — see “My Work”</span>
                ) : (
                  <button onClick={() => onRequest(s.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">
                    <Send className="w-3.5 h-3.5" /> {st === 'Rejected' ? 'Request again' : 'Request this site'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
