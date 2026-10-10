import React, { useMemo, useState, useEffect } from 'react';
import { Clock, MapPin, Package, CheckCircle2, Briefcase, Camera, Plus, X } from 'lucide-react';
import { Assignment, Site, InventoryItem, CollectionSession, InventoryLog } from '../types';
import { todayStr, byNewest } from '../utils/storage';
import { TASKS_BY_CATEGORY } from '../taskMasterlist';

// Logs are stored/displayed in raw GMT+0 everywhere else in the app (admin's
// Inventory History tab, the database) — that stays untouched. But the date
// picker here (`todayStr()`) uses the worker's own device-local calendar date
// (Nepal, UTC+5:45), so a Check Out logged just after UTC midnight is still
// "this morning" locally. Convert at the point of comparison only, so a
// worker picking "today" sees today in their own calendar, not GMT's.
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;
function localDateStr(iso: string): string {
  const d = new Date(new Date(iso).getTime() + NEPAL_OFFSET_MINUTES * 60000);
  return d.toISOString().slice(0, 10);
}

// A camera the worker actually had on loan on some day, derived from the
// Check Out/Check In history log rather than current possession — so a
// camera they've since returned still shows up for the day(s) they used it.
interface LoggedCamera {
  id: string;       // InventoryItem id
  itemId: string;   // human-readable camera code
  name: string;
}

interface MyWorkViewProps {
  assignments: Assignment[];
  sites: Site[];
  myKit: InventoryItem[];
  myLogs: InventoryLog[];
  onSubmitHours: (assignmentId: string, sessions: Omit<CollectionSession, 'id'>[]) => void;
  onFinish: (assignmentId: string, sessions: Omit<CollectionSession, 'id'>[]) => void;
  onReopen: (assignmentId: string) => void;
  onUpdateSession: (assignmentId: string, sessionId: string, updates: Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>) => void;
  onDeleteSession: (assignmentId: string, sessionId: string) => void;
}

export const MyWorkView: React.FC<MyWorkViewProps> = ({ assignments, sites, myKit, myLogs, onSubmitHours, onFinish, onReopen, onUpdateSession, onDeleteSession }) => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">My Work</h2>
        <p className="text-xs text-slate-500">Enter the hours of data you collected, then finish the site.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-slate-400" /> My equipment
        </div>
        {myKit.length === 0 ? (
          <p className="text-xs text-slate-400">No equipment assigned to you yet — ask the admin.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {myKit.map(i => (
              <span key={i.id} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-[11px] text-slate-600">
                <Package className="w-3 h-3" /> {i.name} <span className="font-mono text-slate-400">· {i.itemId}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">You use this same kit at every site. Return it to the admin only when you're done for good.</p>
      </div>

      {assignments.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 flex flex-col items-center gap-2">
          <Briefcase className="w-6 h-6" /> Nothing assigned yet. Request a site under “Available Sites”.
        </div>
      )}

      <div className="space-y-3">
        {[...assignments].sort(byNewest).map(a => (
          <AssignmentCard
            key={a.id}
            a={a}
            site={sites.find(s => s.id === a.siteId)}
            myLogs={myLogs}
            onSubmitHours={onSubmitHours}
            onFinish={onFinish}
            onReopen={onReopen}
            onUpdateSession={onUpdateSession}
            onDeleteSession={onDeleteSession}
          />
        ))}
      </div>
    </div>
  );
};

interface TaskRow {
  task: string;
  hours: string;
}

const AssignmentCard: React.FC<{
  a: Assignment;
  site?: Site;
  myLogs: InventoryLog[];
  onSubmitHours: (id: string, sessions: Omit<CollectionSession, 'id'>[]) => void;
  onFinish: (id: string, sessions: Omit<CollectionSession, 'id'>[]) => void;
  onReopen: (id: string) => void;
  onUpdateSession: (assignmentId: string, sessionId: string, updates: Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>) => void;
  onDeleteSession: (assignmentId: string, sessionId: string) => void;
}> = ({ a, site, myLogs, onSubmitHours, onFinish, onReopen, onUpdateSession, onDeleteSession }) => {
  const [date, setDate] = useState(todayStr());
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[]>([]);
  const [rowsByCamera, setRowsByCamera] = useState<Record<string, TaskRow[]>>({});
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ date: string; hours: string; task: string; cameraId: string }>({ date: '', hours: '', task: '', cameraId: '' });

  // Build one loan interval per Check Out → (next) Check In pair, per camera,
  // from this worker's own history log. A camera with no matching Check In
  // yet is still "out" — its interval stays open through today. This is what
  // lets a worker pick, say, yesterday's date and still see a camera they've
  // since checked back in, while today shows nothing if nothing was taken out today.
  const loanIntervals = useMemo(() => {
    const byItem = new Map<string, InventoryLog[]>();
    myLogs.forEach(l => {
      const arr = byItem.get(l.itemId) || [];
      arr.push(l);
      byItem.set(l.itemId, arr);
    });
    const intervals: { itemId: string; itemCode: string; name: string; start: string; end: string | null }[] = [];
    byItem.forEach((logs, itemId) => {
      const sorted = [...logs].sort((x, y) => x.at.localeCompare(y.at));
      let open: { itemId: string; itemCode: string; name: string; start: string; end: string | null } | null = null;
      sorted.forEach(l => {
        if (l.activity === 'Check Out') {
          open = { itemId, itemCode: l.itemCode, name: l.itemName, start: localDateStr(l.at), end: null };
        } else if (l.activity === 'Check In' && open) {
          open.end = localDateStr(l.at);
          intervals.push(open);
          open = null;
        }
      });
      if (open) intervals.push(open);
    });
    return intervals;
  }, [myLogs]);

  const camerasUsedOn = (d: string): LoggedCamera[] => {
    const seen = new Map<string, LoggedCamera>();
    loanIntervals.forEach(iv => {
      if (d >= iv.start && (iv.end === null || d <= iv.end)) {
        seen.set(iv.itemId, { id: iv.itemId, itemId: iv.itemCode, name: iv.name });
      }
    });
    return Array.from(seen.values());
  };
  const findLoggedCamera = (id: string): LoggedCamera | undefined => {
    const iv = loanIntervals.find(x => x.itemId === id);
    return iv ? { id: iv.itemId, itemId: iv.itemCode, name: iv.name } : undefined;
  };

  const camerasForDate = useMemo(() => camerasUsedOn(date), [loanIntervals, date]);

  // The camera list depends on the date — if the worker changes it, clear a
  // half-filled selection rather than leaving stale picks that no longer apply.
  useEffect(() => {
    setSelectedCameraIds([]);
    setRowsByCamera({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const startEdit = (s: CollectionSession) => {
    setEditingSessionId(s.id);
    setEditDraft({ date: s.date, hours: String(s.hours), task: s.task || '', cameraId: s.cameraId || '' });
  };
  const cancelEdit = () => setEditingSessionId(null);
  const saveEdit = (assignmentId: string) => {
    if (!editingSessionId) return;
    const h = parseFloat(editDraft.hours);
    if (!h || h <= 0) { window.alert('Enter valid hours.'); return; }
    const cam = findLoggedCamera(editDraft.cameraId);
    onUpdateSession(assignmentId, editingSessionId, {
      date: editDraft.date, hours: h, task: editDraft.task.trim() || undefined,
      cameraId: cam?.id, cameraName: cam?.name, cameraItemId: cam?.itemId,
    });
    setEditingSessionId(null);
  };
  // Only the tasks belonging to this site's own field/category — not the whole masterlist.
  const siteTasks = site ? TASKS_BY_CATEGORY[site.category] || [] : [];

  const toggleCamera = (cam: LoggedCamera) => {
    setSelectedCameraIds(prev => {
      if (prev.includes(cam.id)) {
        setRowsByCamera(r => { const next = { ...r }; delete next[cam.id]; return next; });
        return prev.filter(id => id !== cam.id);
      }
      setRowsByCamera(r => ({ ...r, [cam.id]: [{ task: '', hours: '' }] }));
      return [...prev, cam.id];
    });
  };

  const addRow = (camId: string) => {
    setRowsByCamera(r => ({ ...r, [camId]: [...(r[camId] || []), { task: '', hours: '' }] }));
  };
  const removeRow = (camId: string, idx: number) => {
    setRowsByCamera(r => ({ ...r, [camId]: r[camId].filter((_, i) => i !== idx) }));
  };
  const updateRow = (camId: string, idx: number, field: keyof TaskRow, value: string) => {
    setRowsByCamera(r => ({
      ...r,
      [camId]: r[camId].map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    }));
  };

  const totalHours = Object.values(rowsByCamera)
    .flat()
    .reduce((sum, row) => sum + (parseFloat(row.hours) || 0), 0);

  const buildSessions = (): Omit<CollectionSession, 'id'>[] => {
    const sessions: Omit<CollectionSession, 'id'>[] = [];
    selectedCameraIds.forEach(camId => {
      const cam = findLoggedCamera(camId);
      (rowsByCamera[camId] || []).forEach(row => {
        const h = parseFloat(row.hours);
        if (h && h > 0) {
          sessions.push({ date, hours: h, task: row.task.trim() || undefined, cameraId: camId, cameraName: cam?.name, cameraItemId: cam?.itemId });
        }
      });
    });
    return sessions;
  };

  const submitHoursOnly = (e: React.MouseEvent) => {
    e.preventDefault();
    const sessions = buildSessions();
    if (sessions.length === 0) { window.alert('Enter at least one task and hours before submitting.'); return; }
    onSubmitHours(a.id, sessions);
    setSelectedCameraIds([]); setRowsByCamera({});
  };

  const finishSite = (e: React.MouseEvent) => {
    e.preventDefault();
    const sessions = buildSessions();
    if (sessions.length === 0 && !window.confirm('Finish this site with no extra hours entered?')) return;
    onFinish(a.id, sessions);
    setSelectedCameraIds([]); setRowsByCamera({});
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold text-slate-900">{a.siteName}</div>
          {site && (site.latitude || site.longitude) && (
            <a className="text-xs inline-flex items-center gap-1 text-blue-600 hover:underline"
              href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`} target="_blank" rel="noreferrer">
              <MapPin className="w-3 h-3" /> {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
            </a>
          )}
          {site?.supervisor && <div className="text-xs text-slate-500">Supervisor: {site.supervisor} {site.supervisorContact && `· ${site.supervisorContact}`}</div>}
        </div>
        <div className="text-right">
          <div className="inline-flex items-center gap-1 text-sm font-bold text-slate-800">
            <Clock className="w-4 h-4 text-blue-500" /> {a.hoursLogged.toFixed(1)}h
          </div>
          <div className="mt-1">
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
              a.status === 'Active' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>{a.status}</span>
          </div>
        </div>
      </div>

      {a.sessions.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 space-y-1">
          {a.sessions.map((s) => {
            if (editingSessionId === s.id) {
              return (
                <div key={s.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-slate-500 mb-0.5">Date</label>
                    <input type="date" value={editDraft.date} onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))}
                      className="px-1.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-0.5">Camera</label>
                    <select value={editDraft.cameraId} onChange={e => setEditDraft(d => ({ ...d, cameraId: e.target.value }))}
                      className="px-1.5 py-1 border border-slate-300 rounded bg-white">
                      <option value="">—</option>
                      {(() => {
                        const options = camerasUsedOn(editDraft.date);
                        const current = findLoggedCamera(editDraft.cameraId);
                        if (current && !options.some(o => o.id === current.id)) options.push(current);
                        return options.map(cam => <option key={cam.id} value={cam.id}>{cam.itemId}</option>);
                      })()}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-slate-500 mb-0.5">Task</label>
                    <select value={editDraft.task} onChange={e => setEditDraft(d => ({ ...d, task: e.target.value }))}
                      className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white">
                      <option value="">— none —</option>
                      {siteTasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-0.5">Hours</label>
                    <input type="number" step="0.25" min="0" value={editDraft.hours} onChange={e => setEditDraft(d => ({ ...d, hours: e.target.value }))}
                      className="w-20 px-1.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                  <button type="button" onClick={() => saveEdit(a.id)}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded">Save</button>
                  <button type="button" onClick={cancelEdit}
                    className="px-2.5 py-1 text-slate-500 hover:text-slate-800">Cancel</button>
                </div>
              );
            }
            return (
              <div key={s.id} className="flex justify-between items-center gap-2">
                <span>
                  {s.date}
                  {s.cameraItemId ? ` — ${s.cameraItemId}` : (s.cameraName ? ` — ${s.cameraName}` : '')}
                  {s.task ? ` · ${s.task}` : ''}
                  {!s.cameraName && s.note ? ` — ${s.note}` : ''}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-medium text-slate-700">{s.hours}h</span>
                  <button type="button" onClick={() => startEdit(s)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">Edit</button>
                  <button type="button" onClick={() => onDeleteSession(a.id, s.id)}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700">Delete</button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {a.status === 'Active' ? (
        <form onSubmit={e => e.preventDefault()} className="mt-3 border-t border-slate-100 pt-3 space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-2 py-1.5 border border-slate-300 rounded-lg" />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Camera(s) used</label>
            {camerasForDate.length === 0 ? (
              <p className="text-slate-400">
                {date === todayStr()
                  ? "No camera checked out to you today yet — ask the admin, or pick a different date."
                  : "No camera was checked out to you on this date."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {camerasForDate.map(cam => (
                  <button key={cam.id} type="button" onClick={() => toggleCamera(cam)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                      selectedCameraIds.includes(cam.id)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400'
                    }`}>
                    <Camera className="w-3 h-3" /> {cam.itemId}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCameraIds.map(camId => {
            const cam = findLoggedCamera(camId);
            const rows = rowsByCamera[camId] || [];
            return (
              <div key={camId} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="font-semibold text-slate-700 flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-blue-500" /> {cam?.itemId}</div>
                {rows.map((row, idx) => (
                  <div key={idx} className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-slate-500 mb-1">Task done</label>
                      <select value={row.task} onChange={e => updateRow(camId, idx, 'task', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white">
                        <option value="">— choose a task —</option>
                        {siteTasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                      {siteTasks.length === 0 && (
                        <p className="mt-1 text-[10px] text-amber-600">No tasks listed yet for "{site?.category || 'this site\'s'}" — ask the admin.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">Hours captured</label>
                      <input type="number" step="0.25" min="0" value={row.hours} onChange={e => updateRow(camId, idx, 'hours', e.target.value)}
                        placeholder="e.g. 2" className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg bg-white" />
                    </div>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => removeRow(camId, idx)} title="Remove this row"
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg mb-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => addRow(camId)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                  <Plus className="w-3.5 h-3.5" /> Add another task for this camera
                </button>
              </div>
            );
          })}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="text-slate-600">
              Total for this entry: <span className="font-bold text-slate-900">{totalHours.toFixed(2)}h</span> <span className="text-[10px] text-slate-400">(added up automatically)</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={submitHoursOnly}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg">
                <Plus className="w-4 h-4" /> Submit hours
              </button>
              <button type="button" onClick={finishSite}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg">
                <CheckCircle2 className="w-4 h-4" /> Mark site completed
              </button>
            </div>
          </div>
        </form>
      ) : (
        <button onClick={() => onReopen(a.id)} className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 hover:text-slate-800 underline block">
          Re-open this site (add more hours)
        </button>
      )}
    </div>
  );
};
