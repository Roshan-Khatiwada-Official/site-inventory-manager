import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Package, PackageCheck, Search, AlertTriangle, ListPlus, UserPlus, Undo2, CheckCircle2, Wrench, PackageX, ShieldAlert, RotateCcw } from 'lucide-react';
import { InventoryItem, InventoryIssue, UserAccount } from '../types';
import { todayStr, byNewest } from '../utils/storage';
import { heldQuantity, availableQuantity, issueQuantity } from '../utils/inventory';
import { CheckInModal } from './CheckInModal';

type IssueCondition = InventoryIssue['condition'];

const CONDITION_STYLE: Record<IssueCondition, { label: string; badge: string; icon: React.ElementType }> = {
  Flagged: { label: 'Flagged', badge: 'bg-amber-50 text-amber-700 border border-amber-200', icon: AlertTriangle },
  Damaged: { label: 'Damaged', badge: 'bg-rose-50 text-rose-700 border border-rose-200', icon: Wrench },
  Lost: { label: 'Lost', badge: 'bg-slate-100 text-slate-600 border border-slate-300', icon: PackageX },
};
const ISSUE_CONDITIONS: IssueCondition[] = ['Flagged', 'Damaged', 'Lost'];

const TONE_STYLE: Record<'slate' | 'emerald' | 'amber' | 'rose', string> = {
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  amber: 'bg-amber-100 text-amber-600',
  rose: 'bg-rose-100 text-rose-600',
};

const StatCard: React.FC<{
  label: string; value: number; sub?: string; icon: React.ElementType; tone: 'slate' | 'emerald' | 'amber' | 'rose'; muted?: boolean;
}> = ({ label, value, sub, icon: Icon, tone, muted }) => (
  <div className={`bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 ${muted ? 'opacity-60' : ''}`}>
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TONE_STYLE[tone]}`}>
      <Icon className="w-4.5 h-4.5" />
    </div>
    <div className="min-w-0">
      <div className="text-lg font-bold text-slate-900 leading-none">{value}</div>
      <div className="text-[11px] text-slate-500 mt-1 truncate">{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  </div>
);

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return iso || '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface CheckInTarget {
  item: InventoryItem;
  collectorId: string;
  collectorName: string;
  quantity: number;
}

interface InventoryViewProps {
  inventory: InventoryItem[];
  dataCollectors: UserAccount[];
  onSave: (item: InventoryItem) => void;
  onAddBatch: (items: InventoryItem[]) => void;
  onDelete: (id: string) => void;
  onReportIssue: (itemId: string, condition: IssueCondition, quantity: number, note: string, sourceCollectorId: string | null) => void;
  onResolveIssue: (itemId: string, issueId: string, action: { type: 'clear' } | { type: 'reclassify'; condition: 'Damaged' | 'Lost'; note: string }) => void;
  onAssign: (itemId: string, collectorId: string, quantity: number) => void;
  onReturn: (itemId: string, collectorId: string, quantity: number, ok: boolean, note: string) => void;
}

type StatusFilter = '' | 'In stock' | 'Assigned' | IssueCondition;

export const InventoryView: React.FC<InventoryViewProps> = ({
  inventory, dataCollectors, onSave, onAddBatch, onDelete, onReportIssue, onResolveIssue, onAssign, onReturn,
}) => {
  const [open, setOpen] = useState(false);
  const [seqOpen, setSeqOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [assigning, setAssigning] = useState<InventoryItem | null>(null);
  const [checkingIn, setCheckingIn] = useState<CheckInTarget | null>(null);
  const [managingIssues, setManagingIssues] = useState<InventoryItem | null>(null);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [workerFilter, setWorkerFilter] = useState('');

  const categories = useMemo(
    () => Array.from(new Set(inventory.map(i => i.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [inventory]
  );

  const filtered = inventory.filter(i => {
    const t = q.toLowerCase();
    const matchesQ = i.name.toLowerCase().includes(t) || i.itemId.toLowerCase().includes(t) || i.category.toLowerCase().includes(t);
    const matchesCategory = !categoryFilter || i.category === categoryFilter;
    const matchesStatus = !statusFilter
      || (statusFilter === 'Assigned' ? heldQuantity(i) > 0
        : statusFilter === 'In stock' ? availableQuantity(i) > 0
          : issueQuantity(i, statusFilter) > 0);
    const matchesWorker = !workerFilter || i.holders.some(h => h.collectorId === workerFilter);
    return matchesQ && matchesCategory && matchesStatus && matchesWorker;
  }).sort(byNewest);

  // One feed of check-ins and issue resolutions, so it's clear both who
  // returned/flagged an item and, separately, who later cleared or
  // reclassified it — instead of a clear silently erasing that history.
  const recentActivity = useMemo(() => {
    type Row = { key: string; sortKey: string; dateLabel: string; node: React.ReactNode };
    const rows: Row[] = [];
    inventory.forEach(i => {
      i.returnLog.forEach((r, idx) => {
        if (workerFilter && r.fromCollectorId !== workerFilter) return;
        rows.push({
          key: `ret-${i.id}-${idx}`,
          sortKey: r.date,
          dateLabel: r.date,
          node: (
            <div className="flex items-center gap-2">
              {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
              <span className="font-medium text-slate-800">{r.quantity} × {i.name}</span>
              {r.fromCollectorName && <span className="text-slate-400">from {r.fromCollectorName}</span>}
              {!r.ok && r.note && <span className="text-rose-600">— {r.note}</span>}
            </div>
          ),
        });
      });
      i.resolvedIssues.forEach(x => {
        if (workerFilter && x.reportedByCollectorId !== workerFilter) return;
        const style = CONDITION_STYLE[x.condition];
        const cleared = x.outcome === 'Cleared';
        rows.push({
          key: `res-${i.id}-${x.id}`,
          sortKey: x.resolvedAt,
          dateLabel: formatDateTime(x.resolvedAt),
          node: (
            <div className="flex items-center gap-2 flex-wrap">
              {cleared ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <style.icon className="w-3.5 h-3.5 text-rose-500" />}
              <span className="font-medium text-slate-800">
                {cleared ? 'Cleared' : `Marked ${x.outcome}`}: {x.quantity} × {i.name}
              </span>
              {x.reportedByCollectorName && <span className="text-slate-400">— originally flagged by {x.reportedByCollectorName}</span>}
              <span className="text-slate-400">by {x.resolvedByName}</span>
            </div>
          ),
        });
      });
    });
    return rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 20);
  }, [inventory, workerFilter]);

  const workerCounts = useMemo(() => {
    const map = new Map<string, number>();
    inventory.forEach(i => i.holders.forEach(h => map.set(h.collectorId, (map.get(h.collectorId) || 0) + h.quantity)));
    return map;
  }, [inventory]);

  // A dashboard-style overview so the admin can see the health of the whole
  // fleet at a glance, before scanning individual rows in the table.
  const totals = useMemo(() => {
    let totalUnits = 0, inStock = 0, assigned = 0;
    const byIssue: Record<IssueCondition, number> = { Flagged: 0, Damaged: 0, Lost: 0 };
    inventory.forEach(i => {
      totalUnits += i.quantity;
      inStock += availableQuantity(i);
      assigned += heldQuantity(i);
      ISSUE_CONDITIONS.forEach(c => { byIssue[c] += issueQuantity(i, c); });
    });
    return { totalItems: inventory.length, totalUnits, inStock, assigned, byIssue };
  }, [inventory]);

  const hasIssues = totals.byIssue.Flagged + totals.byIssue.Damaged + totals.byIssue.Lost > 0;
  const hasFilters = !!(categoryFilter || statusFilter || workerFilter || q);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Inventory</h2>
          <p className="text-xs text-slate-500 mt-0.5">Stock can be split across several people, and part of it can be flagged, damaged or lost without affecting the rest.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSeqOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm">
            <ListPlus className="w-4 h-4" /> Add Sequential
          </button>
          <button onClick={() => { setEditing(null); setOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Stat overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Items" value={totals.totalItems} sub={`${totals.totalUnits} units`} icon={Package} tone="slate" />
        <StatCard label="In stock" value={totals.inStock} icon={PackageCheck} tone="emerald" />
        <StatCard label="Assigned" value={totals.assigned} icon={UserPlus} tone="amber" />
        <StatCard label="Flagged" value={totals.byIssue.Flagged} icon={AlertTriangle} tone="amber" muted={totals.byIssue.Flagged === 0} />
        <StatCard label="Damaged" value={totals.byIssue.Damaged} icon={Wrench} tone="rose" muted={totals.byIssue.Damaged === 0} />
        <StatCard label="Lost" value={totals.byIssue.Lost} icon={PackageX} tone="slate" muted={totals.byIssue.Lost === 0} />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, item ID or category…"
            className="w-full pl-9 pr-4 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All statuses</option>
            <option value="In stock">In stock</option>
            <option value="Assigned">Assigned</option>
            <option value="Flagged">Flagged</option>
            <option value="Damaged">Damaged</option>
            <option value="Lost">Lost</option>
          </select>
          <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All field workers</option>
            {dataCollectors.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({workerCounts.get(c.id) || 0})</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={() => { setCategoryFilter(''); setStatusFilter(''); setWorkerFilter(''); setQ(''); }}
              className="text-xs text-blue-600 hover:underline ml-1">Clear filters</button>
          )}
          <span className="ml-auto text-[11px] text-slate-400">{filtered.length} of {inventory.length} items</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Qty</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  {hasFilters ? 'No items match your filters.' : 'No inventory items yet.'}
                </td></tr>
              )}
              {filtered.map(i => {
                const held = heldQuantity(i);
                const available = availableQuantity(i);
                return (
                  <tr key={i.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{i.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">{i.itemId}</div>
                          {i.note && <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{i.note}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {i.category ? (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">{i.category}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{i.quantity || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {available > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {available} in stock
                          </span>
                        )}
                        {held > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            {held} assigned
                          </span>
                        )}
                        {ISSUE_CONDITIONS.map(cond => {
                          const qty = issueQuantity(i, cond);
                          if (qty <= 0) return null;
                          const style = CONDITION_STYLE[cond];
                          return (
                            <button key={cond} onClick={() => setManagingIssues(i)} title={`${style.label} — review or resolve`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.badge}`}>
                              <style.icon className="w-3 h-3" /> {qty} {style.label.toLowerCase()}
                            </button>
                          );
                        })}
                      </div>
                      {i.holders.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                          {i.holders.map(h => (
                            <span key={h.collectorId} className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-full pl-2 pr-1 py-0.5">
                              {h.collectorName || '—'}: {h.quantity}
                              <button
                                onClick={() => setCheckingIn({ item: i, collectorId: h.collectorId, collectorName: h.collectorName, quantity: h.quantity })}
                                className="p-0.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-full" title={`Check in from ${h.collectorName}`}>
                                <Undo2 className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setManagingIssues(i)}
                        className={`p-1.5 rounded-lg hover:bg-slate-100 ${i.issues.length > 0 ? 'text-amber-600 hover:text-amber-700' : 'text-slate-400 hover:text-blue-600'}`}
                        title={i.issues.length > 0 ? 'Review reported issues' : 'Report damaged / lost / a problem'}>
                        <ShieldAlert className="w-3.5 h-3.5" />
                      </button>
                      {available > 0 && dataCollectors.length > 0 && (
                        <button onClick={() => setAssigning(i)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg" title="Assign to a field worker">
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => { setEditing(i); setOpen(true); }} title="Edit" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDelete(i.id)} disabled={held > 0}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg disabled:opacity-30"
                        title={held > 0 ? 'Item is with a collector' : 'Delete'}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {hasIssues && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Some items need attention — filter by status above to review them.
        </p>
      )}

      {recentActivity.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">Recent check-ins</div>
          <div className="divide-y divide-slate-100">
            {recentActivity.map(row => (
              <div key={row.key} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                {row.node}
                <span className="text-slate-400 shrink-0">{row.dateLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <InventoryModal
          item={editing}
          dataCollectors={dataCollectors}
          onClose={() => setOpen(false)}
          onSave={(it) => { onSave(it); setOpen(false); }}
        />
      )}
      {seqOpen && (
        <SequentialModal
          dataCollectors={dataCollectors}
          onClose={() => setSeqOpen(false)}
          onAdd={(items) => { onAddBatch(items); setSeqOpen(false); }}
        />
      )}
      {assigning && (
        <AssignModal
          item={assigning}
          dataCollectors={dataCollectors}
          onClose={() => setAssigning(null)}
          onAssign={(collectorId, qty) => { onAssign(assigning.id, collectorId, qty); setAssigning(null); }}
        />
      )}
      {checkingIn && (
        <CheckInModal
          itemName={checkingIn.item.name}
          itemCode={checkingIn.item.itemId}
          collectorName={checkingIn.collectorName}
          heldQuantity={checkingIn.quantity}
          onClose={() => setCheckingIn(null)}
          onConfirm={(qty, ok, note) => { onReturn(checkingIn.item.id, checkingIn.collectorId, qty, ok, note); setCheckingIn(null); }}
        />
      )}
      {managingIssues && (
        <IssuesModal
          item={managingIssues}
          onClose={() => setManagingIssues(null)}
          onReport={(condition, qty, note, sourceCollectorId) => onReportIssue(managingIssues.id, condition, qty, note, sourceCollectorId)}
          onResolve={(issueId, action) => onResolveIssue(managingIssues.id, issueId, action)}
        />
      )}
    </div>
  );
};

/**
 * Report units as Flagged/Damaged/Lost (pulled from free stock or straight
 * out of a specific holder), and resolve issues already reported — clear
 * them back to stock, or turn a pending Flagged issue into a confirmed
 * Damaged/Lost outcome. Everything scoped to this one item; the rest of its
 * stock is untouched.
 */
const IssuesModal: React.FC<{
  item: InventoryItem;
  onClose: () => void;
  onReport: (condition: IssueCondition, quantity: number, note: string, sourceCollectorId: string | null) => void;
  onResolve: (issueId: string, action: { type: 'clear' } | { type: 'reclassify'; condition: 'Damaged' | 'Lost'; note: string }) => void;
}> = ({ item, onClose, onReport, onResolve }) => {
  const available = availableQuantity(item);
  const sources = [
    ...(available > 0 ? [{ key: 'stock', label: `From stock (${available} available)`, max: available }] : []),
    ...item.holders.map(h => ({ key: h.collectorId, label: `From ${h.collectorName} (${h.quantity})`, max: h.quantity })),
  ];

  const [condition, setCondition] = useState<IssueCondition>('Flagged');
  const [source, setSource] = useState(sources[0]?.key || '');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = sources.find(s => s.key === source);

  const submitReport = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selected) { setError('Nothing available to report.'); return; }
    if (quantity <= 0 || quantity > selected.max) { setError(`Quantity must be between 1 and ${selected.max}.`); return; }
    if (!note.trim()) { setError('Add a short note on what happened.'); return; }
    onReport(condition, quantity, note, selected.key === 'stock' ? null : selected.key);
    setNote(''); setQuantity(1);
  };

  const field = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><ShieldAlert className="w-4 h-4" /></div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Flagged / Damaged / Lost</h3>
              <p className="text-[11px] text-slate-500">{item.name} · {item.itemId} · {item.quantity} total</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 text-xs text-slate-700">
          {item.issues.length > 0 && (
            <div>
              <label className="font-semibold mb-1.5 block">Reported ({item.issues.length})</label>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {item.issues.map(issue => {
                  const style = CONDITION_STYLE[issue.condition];
                  return (
                    <div key={issue.id} className="px-3 py-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.badge}`}>
                          <style.icon className="w-3 h-3" /> {issue.quantity} {style.label.toLowerCase()}
                        </span>
                        {issue.note && <p className="mt-1 text-slate-500">{issue.note}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {issue.condition === 'Flagged' && (
                          <>
                            <button type="button" onClick={() => onResolve(issue.id, { type: 'reclassify', condition: 'Damaged', note: issue.note })}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded" title="Confirm damaged">
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => onResolve(issue.id, { type: 'reclassify', condition: 'Lost', note: issue.note })}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" title="Confirm lost">
                              <PackageX className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => onResolve(issue.id, { type: 'clear' })}
                          className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded" title="Clear — back to stock">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={submitReport} className="space-y-3 pt-1 border-t border-slate-100">
            <label className="font-semibold block pt-3">Report new</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1 text-[11px] text-slate-500">Type</label>
                <select value={condition} onChange={e => setCondition(e.target.value as IssueCondition)} className={`${field} bg-white`}>
                  {ISSUE_CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_STYLE[c].label}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1 text-[11px] text-slate-500">Quantity</label>
                <input type="number" min={1} max={selected?.max || 1} value={quantity}
                  onChange={e => setQuantity(parseInt(e.target.value) || 0)} className={field} disabled={!selected} />
              </div>
            </div>
            {sources.length > 0 ? (
              <div>
                <label className="block font-semibold mb-1 text-[11px] text-slate-500">Source</label>
                <select value={source} onChange={e => setSource(e.target.value)} className={`${field} bg-white`}>
                  {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            ) : (
              <p className="text-slate-400">Nothing left to report — the whole item is already accounted for.</p>
            )}
            <div>
              <label className="block font-semibold mb-1 text-[11px] text-slate-500">Note *</label>
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened?" className={field} />
            </div>

            {error && <p className="text-rose-600 text-[11px] font-medium">{error}</p>}

            <button type="submit" disabled={!selected}
              className="w-full px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white rounded-lg shadow-sm">
              Report
            </button>
          </form>
        </div>

        <div className="shrink-0 px-6 pt-3 pb-4 bg-white border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">Close</button>
        </div>
      </div>
    </div>
  );
};

/** Give some (not necessarily all) of an item's remaining stock to one field worker. */
const AssignModal: React.FC<{
  item: InventoryItem;
  dataCollectors: UserAccount[];
  onClose: () => void;
  onAssign: (collectorId: string, quantity: number) => void;
}> = ({ item, dataCollectors, onClose, onAssign }) => {
  const available = availableQuantity(item);
  const [collectorId, setCollectorId] = useState('');
  const [quantity, setQuantity] = useState<number>(Math.min(1, available));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!collectorId) { setError('Choose a field worker.'); return; }
    if (quantity <= 0) { setError('Quantity must be at least 1.'); return; }
    if (quantity > available) { setError(`Only ${available} left in stock.`); return; }
    onAssign(collectorId, quantity);
  };

  const field = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-sm h-full sm:h-auto border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center"><UserPlus className="w-4 h-4" /></div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Assign Stock</h3>
              <p className="text-[11px] text-slate-500">{item.name} · {available} available</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs text-slate-700">
          <div>
            <label className="block font-semibold mb-1">Field worker *</label>
            <select required autoFocus value={collectorId} onChange={e => setCollectorId(e.target.value)} className={`${field} bg-white`}>
              <option value="">Choose…</option>
              {dataCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Quantity *</label>
            <input type="number" min={1} max={available} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 0)} className={field} />
            <p className="mt-1 text-[10px] text-slate-400">Up to {available} — the rest stays in stock, or can go to someone else.</p>
          </div>

          {error && <p className="text-rose-600 text-[11px] font-medium">{error}</p>}

          <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-4 bg-white border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">Cancel</button>
            <button type="submit" className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm">Assign</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const InventoryModal: React.FC<{
  item: InventoryItem | null;
  dataCollectors: UserAccount[];
  onClose: () => void;
  onSave: (item: InventoryItem) => void;
}> = ({ item, dataCollectors, onClose, onSave }) => {
  const [itemId, setItemId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [note, setNote] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const held = item ? item.holders.reduce((s, h) => s + h.quantity, 0) : 0;
  const reported = item ? item.issues.reduce((s, x) => s + x.quantity, 0) : 0;
  const floor = held + reported;

  useEffect(() => {
    if (item) {
      setItemId(item.itemId); setName(item.name); setCategory(item.category);
      setQuantity(item.quantity); setNote(item.note);
    }
  }, [item]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!itemId.trim()) { setError('Item ID is required.'); return; }
    if (!name.trim()) { setError('Name is required.'); return; }
    const qty = Number(quantity) || 0;
    if (item && qty < floor) { setError(`Quantity can't be less than the ${floor} already assigned out or reported.`); return; }
    const collector = !item ? dataCollectors.find(c => c.id === assignTo) : null;
    onSave({
      id: item ? item.id : `inv-${Date.now()}`,
      itemId: itemId.trim(),
      name: name.trim(),
      category: category.trim(),
      quantity: qty,
      note: note.trim(),
      issues: item ? item.issues : [],
      resolvedIssues: item ? item.resolvedIssues : [],
      holders: item ? item.holders : (collector ? [{ collectorId: collector.id, collectorName: collector.name, quantity: qty }] : []),
      returnLog: item ? item.returnLog : [],
      createdAt: item ? item.createdAt : todayStr(),
      updatedAt: item ? item.updatedAt : todayStr(),
    });
  };

  const field = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-md h-full sm:h-auto sm:max-h-[90vh] border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center"><Package className="w-4 h-4" /></div>
            <h3 className="font-bold text-slate-900 text-base">{item ? 'Edit Item' : 'Add Inventory Item'}</h3>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs text-slate-700">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Item ID *</label>
              <input required autoFocus value={itemId} onChange={e => setItemId(e.target.value)} placeholder="e.g. GPS-01" className={`${field} font-mono`} />
            </div>
            <div>
              <label className="block font-semibold mb-1">Quantity</label>
              <input type="number" min={floor} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 0)} className={field} />
              {floor > 0 && <p className="mt-1 text-[10px] text-slate-400">{floor} already assigned out or reported — can't drop below that.</p>}
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Name *</label>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GNSS Receiver" className={field} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="optional" className={field} />
          </div>
          {!item && (
            <div>
              <label className="block font-semibold mb-1">Assign to (optional)</label>
              <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className={`${field} bg-white`}>
                <option value="">— unassigned, in stock —</option>
                {dataCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-slate-400">Sends the whole quantity to one person now. To split it across several people, add it unassigned and use the Assign button per person instead.</p>
            </div>
          )}
          {item && (item.holders.length > 0 || item.issues.length > 0) && (
            <div>
              <label className="block font-semibold mb-1">Currently out</label>
              {item.holders.length > 0 && (
                <p className="text-[11px] text-slate-500">Assigned — {item.holders.map(h => `${h.collectorName || '—'}: ${h.quantity}`).join(' · ')}</p>
              )}
              {item.issues.length > 0 && (
                <p className="text-[11px] text-slate-500 mt-0.5">Reported — {item.issues.map(x => `${x.quantity} ${x.condition.toLowerCase()}`).join(' · ')}</p>
              )}
              <p className="mt-1 text-[10px] text-slate-400">Manage these from the Inventory list's Assign and Flagged/Damaged/Lost buttons.</p>
            </div>
          )}
          <div>
            <label className="block font-semibold mb-1">Note</label>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="optional" className={field} />
          </div>

          {error && <p className="text-rose-600 text-[11px] font-medium">{error}</p>}

          <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-4 bg-white border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">Cancel</button>
            <button type="submit" className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm">{item ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

/** Bulk-create a run of sequentially numbered items, e.g. NP_001 … NP_010. */
const SequentialModal: React.FC<{
  dataCollectors: UserAccount[];
  onClose: () => void;
  onAdd: (items: InventoryItem[]) => void;
}> = ({ dataCollectors, onClose, onAdd }) => {
  const [prefix, setPrefix] = useState('NP_');
  const [start, setStart] = useState('001');
  const [end, setEnd] = useState('010');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantityEach, setQuantityEach] = useState<number>(1);
  const [note, setNote] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const digits = Math.max(start.replace(/\D/g, '').length, end.replace(/\D/g, '').length, 1);
  const startNum = parseInt(start, 10);
  const endNum = parseInt(end, 10);
  const count = Number.isFinite(startNum) && Number.isFinite(endNum) ? endNum - startNum + 1 : 0;

  const ids = useMemo(() => {
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || startNum > endNum) return [];
    const out: string[] = [];
    for (let n = startNum; n <= endNum && out.length < 500; n++) {
      out.push(`${prefix}${String(n).padStart(digits, '0')}`);
    }
    return out;
  }, [prefix, startNum, endNum, digits]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!ids.length) { setError('Start must be less than or equal to End.'); return; }
    if (count > 500) { setError('That is more than 500 items at once — narrow the range.'); return; }
    const collector = dataCollectors.find(c => c.id === assignTo);
    const now = todayStr();
    const items: InventoryItem[] = ids.map((itemId, idx) => ({
      id: `inv-${Date.now()}-${idx}`,
      itemId,
      name: name.trim(),
      category: category.trim(),
      quantity: Number(quantityEach) || 0,
      note: note.trim(),
      issues: [],
      resolvedIssues: [],
      holders: collector ? [{ collectorId: collector.id, collectorName: collector.name, quantity: Number(quantityEach) || 0 }] : [],
      returnLog: [],
      createdAt: now,
      updatedAt: now,
    }));
    onAdd(items);
  };

  const field = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-md h-full sm:h-auto sm:max-h-[90vh] border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center"><ListPlus className="w-4 h-4" /></div>
            <h3 className="font-bold text-slate-900 text-base">Add Sequential Items</h3>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs text-slate-700">
          <p className="text-slate-500">Creates one item per number, e.g. <code className="bg-slate-100 px-1 py-0.5 rounded">NP_001 … NP_010</code>.</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold mb-1">Prefix</label>
              <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="NP_" className={`${field} font-mono`} />
            </div>
            <div>
              <label className="block font-semibold mb-1">Start</label>
              <input value={start} onChange={e => setStart(e.target.value)} placeholder="001" className={`${field} font-mono`} />
            </div>
            <div>
              <label className="block font-semibold mb-1">End</label>
              <input value={end} onChange={e => setEnd(e.target.value)} placeholder="010" className={`${field} font-mono`} />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            {ids.length > 0
              ? <>Will create <strong className="text-slate-800">{ids.length}</strong> items: <span className="font-mono">{ids[0]}</span> … <span className="font-mono">{ids[ids.length - 1]}</span></>
              : 'Enter a valid Start and End.'}
          </p>

          <div>
            <label className="block font-semibold mb-1">Name *</label>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Network Probe" className={field} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Category</label>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="optional" className={field} />
            </div>
            <div>
              <label className="block font-semibold mb-1">Quantity (each)</label>
              <input type="number" min="0" value={quantityEach} onChange={e => setQuantityEach(parseInt(e.target.value) || 0)} className={field} />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Assign all to (optional)</label>
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className={`${field} bg-white`}>
              <option value="">— unassigned, in stock —</option>
              {dataCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Note</label>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="optional, applied to every item" className={field} />
          </div>

          {error && <p className="text-rose-600 text-[11px] font-medium">{error}</p>}

          <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-4 bg-white border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">Cancel</button>
            <button type="submit" className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm">
              Create {ids.length || ''} items
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
