import { useState, useEffect, useRef, useMemo } from 'react';
import { loadStoredData, saveStoredData, getActiveSessionUserId, setActiveSessionUserId } from './utils/storage';
import {
  Site,
  InventoryItem,
  Assignment,
  SiteRequest,
  UserAccount,
  CollectionSession,
  CAN_FIND_SITES,
  CAN_COLLECT,
} from './types';
import { heldQuantity } from './utils/inventory';
import * as api from './services/api';
import { ApiError } from './services/api';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { SitesView } from './components/SitesView';
import { InventoryView } from './components/InventoryView';
import { AssignmentsView } from './components/AssignmentsView';
import { RequestsView } from './components/RequestsView';
import { ReportsView } from './components/ReportsView';
import { CollectionReportView } from './components/CollectionReportView';
import { AvailableSitesView } from './components/AvailableSitesView';
import { MyWorkView } from './components/MyWorkView';
import { UsersView } from './components/UsersView';
import { ProfileModal } from './components/ProfileModal';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ConfirmDialog, ConfirmState } from './components/ConfirmDialog';

const nowIso = () => new Date().toISOString();

export default function App() {
  // ---- data (server is the single source of truth — no local merge logic) ----
  const [sites, setSites] = useState<Site[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requests, setRequests] = useState<SiteRequest[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => loadStoredData('active_tab', ''));

  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3600);
  };
  // Every mutation goes through this: run the request, toast the outcome,
  // and only touch local state if it actually succeeded — no optimistic
  // local edit that then has to be reconciled or rolled back.
  const runAction = async <T,>(fn: () => Promise<T>, onSuccess: (result: T) => void, successMessage?: string | ((r: T) => string)) => {
    try {
      const result = await fn();
      onSuccess(result);
      if (successMessage) showToast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      return result;
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.', 'error');
      return null;
    }
  };

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const askConfirm = (message: string, onConfirm: () => void, opts?: Partial<ConfirmState>) => {
    setConfirmState({ message, onConfirm, danger: true, confirmLabel: 'Delete', ...opts });
  };

  useEffect(() => { if (activeTab) saveStoredData('active_tab', activeTab); }, [activeTab]);
  useEffect(() => {
    if (!currentUser) return;
    const valid = roleTabIds(currentUser.role);
    if (!valid.includes(activeTab)) setActiveTab(valid[0]);
  }, [currentUser, activeTab]);

  // ---- load + near-real-time refresh ----
  const busyRef = useRef(false); // an action is in flight — skip the poll so it can't clobber it
  const loadAll = async (opts?: { silent?: boolean }) => {
    try {
      const { data } = await api.getAllData();
      setSites(data.sites);
      setInventory(data.inventory);
      setAssignments(data.assignments);
      setRequests(data.requests);
      setUsers(data.users);
      setCurrentUser(prev => (prev ? data.users.find(u => u.id === prev.id) || null : null));
      setInitialLoadError(null);
      return true;
    } catch (err) {
      if (!opts?.silent) setInitialLoadError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAll();
      if (!cancelled) setInitialLoadDone(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the logged-in session once the user list has actually loaded.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !users.length) return;
    const activeId = getActiveSessionUserId();
    if (activeId) {
      const match = users.find(u => u.id === activeId);
      if (match && match.status !== 'Suspended') setCurrentUser(match);
    }
    restoredRef.current = true;
  }, [users]);

  useEffect(() => {
    const poll = () => { if (!document.hidden && !busyRef.current) loadAll({ silent: true }); };
    const timer = window.setInterval(poll, 6000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  const withBusy = async <T,>(fn: () => Promise<T>): Promise<T> => {
    busyRef.current = true;
    try { return await fn(); } finally { busyRef.current = false; }
  };

  // ---- auth ----
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const handleVerifyLogin = async (loginId: string, password: string) => {
    try {
      const { user } = await api.login(loginId, password);
      return { ok: true as const, user };
    } catch (err) {
      return { ok: false as const, error: err instanceof ApiError ? err.message : 'Could not reach the server.' };
    }
  };

  const handleLogin = (u: UserAccount) => {
    setActiveSessionUserId(u.id);
    setCurrentUser(u);
    const valid = roleTabIds(u.role);
    if (!valid.includes(activeTab)) setActiveTab(valid[0]);
    showToast(`Signed in as ${u.name} (${u.role})`);
  };

  const handleLogout = () => {
    setActiveSessionUserId(null);
    setCurrentUser(null);
    setIsProfileOpen(false);
  };

  // ---- site handlers ----
  const saveSite = (draft: Site) => withBusy(() => runAction(
    () => api.saveSite({ ...draft, updatedAt: nowIso() }),
    ({ site, assignment }) => {
      setSites(prev => (prev.some(x => x.id === site.id) ? prev.map(x => (x.id === site.id ? site : x)) : [...prev, site]));
      if (assignment) setAssignments(prev => [...prev, assignment]);
    },
    ({ site, assignment }) => assignment ? `Added "${site.name}" to your My Work.` : site.status === 'Pending Approval' ? `Submitted "${site.name}" for admin approval.` : `Saved site: ${site.name}`
  ));

  const approveSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site || site.status !== 'Pending Approval') return;
    const message = site.reservedById
      ? `Approve "${site.name}"? It goes straight into ${site.reservedByName}'s My Work, and other collectors can still request it too.`
      : `Approve "${site.name}"? It becomes available for shoot to all data collectors.`;
    askConfirm(message, () => withBusy(() => runAction(
      () => api.approveSite(id),
      ({ site: updated, assignment }) => {
        setSites(prev => prev.map(s => (s.id === id ? updated : s)));
        if (assignment) setAssignments(prev => [...prev, assignment]);
      },
      ({ assignment }) => assignment ? `Approved "${site.name}" — added to ${site.reservedByName}'s My Work.` : `Approved "${site.name}" — now available for shoot.`
    )), { title: 'Approve site', confirmLabel: 'Approve', danger: false });
  };

  const rejectSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site || site.status !== 'Pending Approval') return;
    askConfirm(`Cancel approval for "${site.name}"? It will be removed and its finder will need to re-add it if this was a mistake.`, () => withBusy(() => runAction(
      () => api.rejectSite(id),
      () => setSites(prev => prev.filter(s => s.id !== id)),
      `Rejected "${site.name}" — not added.`
    )), { title: 'Cancel approval', confirmLabel: 'Cancel approval' });
  };

  const deleteSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site) return;
    const isAdmin = currentUser?.role === 'Admin';
    const relatedAssignments = assignments.filter(a => a.siteId === id).length;
    const relatedRequests = requests.filter(r => r.siteId === id).length;
    const extra = relatedAssignments || relatedRequests
      ? ` This also removes ${relatedAssignments} assignment${relatedAssignments === 1 ? '' : 's'} (out of anyone's My Work) and ${relatedRequests} request${relatedRequests === 1 ? '' : 's'} tied to it.`
      : '';
    askConfirm(`Delete "${site.name}"? This can't be undone.${extra}`, () => withBusy(() => runAction(
      () => api.deleteSite(id, !!isAdmin),
      () => {
        setSites(prev => prev.filter(s => s.id !== id));
        setAssignments(prev => prev.filter(a => a.siteId !== id));
        setRequests(prev => prev.filter(r => r.siteId !== id));
      },
      'Site deleted everywhere it was used.'
    )));
  };

  // ---- inventory handlers ----
  const saveInventoryItem = (draft: InventoryItem) => withBusy(() => runAction(
    () => api.saveInventoryItem(draft),
    ({ item }) => setInventory(prev => (prev.some(i => i.id === item.id) ? prev.map(i => (i.id === item.id ? item : i)) : [...prev, item])),
    ({ item }) => `Saved item: ${item.name}`
  ));

  const addInventoryBatch = (items: InventoryItem[]) => withBusy(() => runAction(
    () => api.addInventoryBatch(items),
    ({ items: created }) => setInventory(prev => [...prev, ...created]),
    () => `Added ${items.length} item${items.length === 1 ? '' : 's'}.`
  ));

  const deleteInventoryItem = (id: string) => {
    const item = inventory.find(i => i.id === id);
    if (!item) return;
    const isAdmin = currentUser?.role === 'Admin';
    if (!isAdmin && heldQuantity(item) > 0) {
      showToast('That item is held by a collector — check it in first.', 'error');
      return;
    }
    askConfirm(`Delete "${item.name}"? This can't be undone.`, () => withBusy(() => runAction(
      () => api.deleteInventoryItem(id, !!isAdmin),
      () => setInventory(prev => prev.filter(i => i.id !== id)),
      'Inventory item deleted.'
    )));
  };

  const setCollectorKit = (collectorId: string, picks: { itemId: string; quantity: number }[]) => withBusy(() => runAction(
    () => api.setCollectorKit(collectorId, picks),
    ({ inventory: updated }) => setInventory(updated),
    () => `Updated ${users.find(u => u.id === collectorId)?.name || 'collector'}'s equipment.`
  ));

  const assignInventoryQuantity = (itemId: string, collectorId: string, quantity: number) => withBusy(() => runAction(
    () => api.assignInventoryQuantity(itemId, collectorId, quantity),
    ({ item }) => setInventory(prev => prev.map(i => (i.id === item.id ? item : i))),
    ({ item }) => `Assigned ${quantity} × "${item.name}" to ${users.find(u => u.id === collectorId)?.name || 'collector'}.`
  ));

  const returnInventoryItem = (itemId: string, collectorId: string, quantity: number, ok: boolean, note: string) => withBusy(() => runAction(
    () => api.returnInventoryItem(itemId, collectorId, quantity, ok, note, currentUser?.name || 'Admin'),
    ({ item }) => setInventory(prev => prev.map(i => (i.id === item.id ? item : i))),
    ({ item }) => ok ? `Checked in ${quantity} × "${item.name}".` : `Checked in ${quantity} × "${item.name}" — flagged.`
  ));

  const reportItemIssue = (itemId: string, condition: InventoryItem['issues'][number]['condition'], quantity: number, note: string, sourceCollectorId: string | null) => withBusy(() => runAction(
    () => api.reportItemIssue(itemId, condition, quantity, note, sourceCollectorId),
    ({ item }) => setInventory(prev => prev.map(i => (i.id === item.id ? item : i))),
    ({ item }) => `Reported ${quantity} × "${item.name}" ${condition.toLowerCase()}.`
  ));

  const resolveItemIssue = (itemId: string, issueId: string, action: { type: 'clear' } | { type: 'reclassify'; condition: 'Damaged' | 'Lost'; note: string }) => withBusy(() => runAction(
    () => api.resolveItemIssue(itemId, issueId, action, currentUser?.name || 'Admin'),
    ({ item }) => setInventory(prev => prev.map(i => (i.id === item.id ? item : i))),
    action.type === 'clear' ? 'Cleared — back in stock.' : `Marked ${action.condition.toLowerCase()}.`
  ));

  // ---- assignment handlers ----
  const saveAssignment = (draft: Assignment) => withBusy(() => runAction(
    () => api.saveAssignment(draft, currentUser?.id || '', currentUser?.name || ''),
    ({ assignment }) => setAssignments(prev => (prev.some(a => a.id === assignment.id) ? prev.map(a => (a.id === assignment.id ? assignment : a)) : [...prev, assignment])),
    ({ assignment }) => `Assigned ${assignment.collectorName} to ${assignment.siteName}.`
  ));

  const deleteAssignment = (id: string) => {
    const removed = assignments.find(a => a.id === id);
    if (!removed) return;
    askConfirm(`Delete the assignment for ${removed.collectorName} at ${removed.siteName}? This can't be undone.`, () => withBusy(() => runAction(
      () => api.deleteAssignment(id),
      () => setAssignments(prev => prev.filter(a => a.id !== id)),
      'Assignment deleted.'
    )));
  };

  const replaceAssignment = (a: Assignment) => setAssignments(prev => prev.map(x => (x.id === a.id ? a : x)));

  const submitHours = (assignmentId: string, rows: Omit<CollectionSession, 'id'>[]) => withBusy(() => runAction(
    () => api.submitHours(assignmentId, rows),
    ({ assignment }) => replaceAssignment(assignment),
    () => `Submitted ${rows.reduce((s, x) => s + (Number(x.hours) || 0), 0).toFixed(2)}h.`
  ));

  const finishAssignment = (assignmentId: string, rows: Omit<CollectionSession, 'id'>[]) => withBusy(() => runAction(
    () => api.finishAssignment(assignmentId, rows),
    ({ assignment }) => replaceAssignment(assignment),
    () => rows.length ? `Submitted ${rows.reduce((s, x) => s + (Number(x.hours) || 0), 0).toFixed(2)}h — site marked done.` : 'Site marked done.'
  ));

  const reopenAssignment = (assignmentId: string) => withBusy(() => runAction(
    () => api.reopenAssignment(assignmentId),
    ({ assignment }) => replaceAssignment(assignment),
    'Assignment re-opened.'
  ));

  const updateSessionEntry = (assignmentId: string, sessionId: string, updates: Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>) => withBusy(() => runAction(
    () => api.updateSessionEntry(assignmentId, sessionId, updates),
    ({ assignment }) => replaceAssignment(assignment),
    'Entry updated.'
  ));

  const deleteSessionEntry = (assignmentId: string, sessionId: string) => {
    askConfirm("Delete this hours entry? This can't be undone.", () => withBusy(() => runAction(
      () => api.deleteSessionEntry(assignmentId, sessionId),
      ({ assignment }) => replaceAssignment(assignment),
      'Entry deleted.'
    )));
  };

  const verifySessionHours = (assignmentId: string, sessionId: string, actualHours: number) => withBusy(() => runAction(
    () => api.verifySessionHours(assignmentId, sessionId, actualHours, currentUser?.name || 'Admin'),
    ({ assignment }) => replaceAssignment(assignment)
  ));

  // ---- request handlers ----
  const createRequest = (siteId: string) => {
    if (!currentUser) return;
    withBusy(() => runAction(
      () => api.createRequest(siteId, currentUser.id),
      ({ request }) => setRequests(prev => [...prev, request]),
      ({ request }) => `Requested "${request.siteName}".`
    ));
  };

  const cancelRequest = (requestId: string) => {
    if (!currentUser) return;
    withBusy(() => runAction(
      () => api.cancelRequest(requestId, currentUser.id),
      () => setRequests(prev => prev.filter(r => r.id !== requestId)),
      'Request cancelled.'
    ));
  };

  const decideRequest = (requestId: string, approve: boolean) => withBusy(() => runAction(
    () => api.decideRequest(requestId, approve, currentUser?.id || '', currentUser?.name || ''),
    ({ request, assignment }) => {
      setRequests(prev => prev.map(r => (r.id === requestId ? request : r)));
      if (assignment) setAssignments(prev => [...prev, assignment]);
    },
    approve ? 'Request approved — assignment created.' : 'Request rejected.'
  ));

  // ---- user handlers ----
  const saveUser = (draft: UserAccount) => withBusy(() => runAction(
    () => api.saveUser(draft),
    ({ user }) => {
      setUsers(prev => (prev.some(x => x.id === user.id) ? prev.map(x => (x.id === user.id ? user : x)) : [...prev, user]));
      if (currentUser?.id === user.id) setCurrentUser(user);
    },
    ({ user }) => `Saved ${user.name}.`
  ));

  const deleteUser = (id: string) => {
    if (id === currentUser?.id) { showToast("You can't delete your own account.", 'error'); return; }
    const target = users.find(u => u.id === id);
    if (!target) return;
    askConfirm(`Delete the login "${target.name}"? This can't be undone.`, () => withBusy(() => runAction(
      () => api.deleteUser(id),
      () => {
        setUsers(prev => prev.filter(u => u.id !== id));
        setInventory(prev => prev.map(i => (
          i.holders.some(h => h.collectorId === id) ? { ...i, holders: i.holders.filter(h => h.collectorId !== id) } : i
        )));
      },
      'Login deleted.'
    )));
  };

  // ---- scoped data ----
  const mySites = useMemo(() => (currentUser ? sites.filter(s => s.foundById === currentUser.id) : []), [sites, currentUser]);
  const myAssignments = useMemo(() => (currentUser ? assignments.filter(a => a.collectorId === currentUser.id) : []), [assignments, currentUser]);
  const myRequests = useMemo(() => (currentUser ? requests.filter(r => r.collectorId === currentUser.id) : []), [requests, currentUser]);
  const availableSites = useMemo(() => sites.filter(s => s.status === 'Available'), [sites]);
  const dataCollectors = useMemo(() => users.filter(u => CAN_COLLECT.includes(u.role) && u.status === 'Active'), [users]);
  const pendingRequestCount = requests.filter(r => r.status === 'Pending').length;
  const canFind = currentUser ? CAN_FIND_SITES.includes(currentUser.role) : false;
  const canCollect = currentUser ? CAN_COLLECT.includes(currentUser.role) : false;
  const itemsOutCount = useMemo(() => inventory.filter(i => i.holders.length > 0).length, [inventory]);
  const myKit = useMemo(() => (currentUser ? inventory.filter(i => i.holders.some(h => h.collectorId === currentUser.id)) : []), [inventory, currentUser]);

  const toastEl = toast && (
    <div className={`fixed bottom-5 right-5 z-[60] text-white px-4 py-3 rounded-xl shadow-lg border flex items-center gap-3 text-xs ${
      toast.kind === 'error' ? 'bg-rose-700 border-rose-600' : 'bg-slate-900 border-slate-700'
    }`}>
      <span className={`w-2 h-2 rounded-full ${toast.kind === 'error' ? 'bg-rose-300' : 'bg-emerald-400'}`} />
      <span>{toast.text}</span>
    </div>
  );

  if (!initialLoadDone) {
    return <LoadingOverlay show label="Loading your data…" />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center">
        {initialLoadError && (
          <div className="max-w-sm mx-auto mb-4 px-4 py-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs text-center">
            {initialLoadError} — you can still try logging in once the server is reachable.
          </div>
        )}
        <LoginScreen onVerifyLogin={handleVerifyLogin} onLoginSuccess={handleLogin} />
        {toastEl}
      </div>
    );
  }

  const role = currentUser.role;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans md:flex">
      <Sidebar
        currentUser={currentUser}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        onOpenProfile={() => setIsProfileOpen(true)}
        pendingRequestCount={pendingRequestCount}
        outCount={itemsOutCount}
      />

      <main className="flex-1 min-w-0 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        {role === 'Admin' && activeTab === 'sites' && (
          <SitesView
            mode="admin"
            sites={sites}
            users={users}
            assignments={assignments}
            onSave={saveSite}
            onDelete={deleteSite}
            onApprove={approveSite}
            onReject={rejectSite}
            currentUser={currentUser}
          />
        )}
        {role === 'Admin' && activeTab === 'inventory' && (
          <InventoryView
            inventory={inventory}
            dataCollectors={dataCollectors}
            onSave={saveInventoryItem}
            onAddBatch={addInventoryBatch}
            onDelete={deleteInventoryItem}
            onReportIssue={reportItemIssue}
            onResolveIssue={resolveItemIssue}
            onAssign={assignInventoryQuantity}
            onReturn={returnInventoryItem}
          />
        )}
        {role === 'Admin' && activeTab === 'assignments' && (
          <AssignmentsView
            assignments={assignments}
            sites={sites}
            inventory={inventory}
            dataCollectors={dataCollectors}
            onSave={saveAssignment}
            onDelete={deleteAssignment}
          />
        )}
        {role === 'Admin' && activeTab === 'requests' && (
          <RequestsView requests={requests} onDecide={decideRequest} />
        )}
        {role === 'Admin' && activeTab === 'reports' && (
          <ReportsView sites={sites} assignments={assignments} users={users} />
        )}
        {role === 'Admin' && activeTab === 'shootreport' && (
          <CollectionReportView assignments={assignments} sites={sites} inventory={inventory} onVerify={verifySessionHours} />
        )}
        {role === 'Admin' && activeTab === 'users' && (
          <UsersView
            users={users}
            currentUser={currentUser}
            inventory={inventory}
            onSave={saveUser}
            onDelete={deleteUser}
            onSetKit={setCollectorKit}
          />
        )}

        {canFind && activeTab === 'mysites' && (
          <SitesView
            mode="finder"
            sites={mySites}
            users={users}
            assignments={assignments}
            onSave={saveSite}
            onDelete={deleteSite}
            currentUser={currentUser}
            canReserve={canCollect}
          />
        )}

        {canCollect && activeTab === 'available' && (
          <AvailableSitesView
            sites={availableSites}
            myRequests={myRequests}
            assignments={assignments}
            currentUserId={currentUser.id}
            onRequest={createRequest}
            onCancelRequest={cancelRequest}
          />
        )}
        {canCollect && activeTab === 'mywork' && (
          <MyWorkView
            assignments={myAssignments}
            sites={sites}
            myKit={myKit}
            onSubmitHours={submitHours}
            onFinish={finishAssignment}
            onReopen={reopenAssignment}
            onUpdateSession={updateSessionEntry}
            onDeleteSession={deleteSessionEntry}
          />
        )}
      </main>

      {isProfileOpen && (
        <ProfileModal
          user={currentUser}
          onClose={() => setIsProfileOpen(false)}
          onSave={(u: UserAccount) => { saveUser(u); setIsProfileOpen(false); }}
        />
      )}

      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
      {toastEl}
    </div>
  );
}

function roleTabIds(role: UserAccount['role']): string[] {
  if (role === 'Admin') return ['sites', 'inventory', 'assignments', 'requests', 'reports', 'shootreport', 'users'];
  if (role === 'Site Finder') return ['mysites'];
  if (role === 'Field Worker') return ['mysites', 'available', 'mywork'];
  return ['available', 'mywork'];
}
