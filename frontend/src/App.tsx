import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  loadStoredData,
  saveStoredData,
  getActiveSessionUserId,
  setActiveSessionUserId,
  todayStr,
} from './utils/storage';
import {
  INITIAL_SITES,
  INITIAL_INVENTORY,
  INITIAL_ASSIGNMENTS,
  INITIAL_REQUESTS,
  INITIAL_USERS,
} from './mockData';
import {
  Site,
  InventoryItem,
  InventoryIssue,
  ResolvedIssue,
  Assignment,
  SiteRequest,
  UserAccount,
  CollectionSession,
  ReturnRecord,
  CAN_FIND_SITES,
  CAN_COLLECT,
} from './types';
import { heldQuantity, availableQuantity, sanitizeInventoryItem } from './utils/inventory';
import {
  BridgeConfig,
  AppData,
  getStoredBridgeConfig,
  bridgePull,
  bridgePush,
  login as bridgeLogin,
  DEFAULT_BRIDGE_CONFIG,
} from './services/apiBridge';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
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

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

const nowIso = () => new Date().toISOString();

/**
 * Three-way merges, using `base` (the last data we know was in the sheet) to
 * tell a genuine delete apart from "someone else added this and I don't know
 * about it yet". A plain union-by-id (no base) can never represent a delete —
 * removing something locally would just have it merged back in from the sheet
 * on the very next sync.
 */

/**
 * 3-way merge (used for both pushing and polling): anything we've changed
 * since `base` — added, edited, or deleted — wins; anything we haven't
 * touched takes the sheet's current value.
 *
 * This has to compare local against base BY VALUE, not just by id: an edit
 * to an existing record has the same id in base/remote/local, so an id-only
 * check can't tell "we edited this" from "we haven't touched this since the
 * last sync" — and treating an edit as untouched is exactly what let a poll
 * that raced a slow/failed push silently discard the edit and restore the
 * old value (the "small refresh and my change is gone" bug).
 */
// `base` is null until this session has a confirmed, successfully-synced
// snapshot to diff against (the initial pull can fail — flaky network,
// device just woken up — leaving it null indefinitely on that device, while
// the poll/push loop keeps running against whatever stale copy was cached in
// localStorage). Without a real base, every local row looks "added" (there's
// nothing in baseMap to compare it to), so the old code below treated the
// device's entire stale local copy as newly-made edits and overwrote every
// unrelated row on the shared sheet with it — silently wiping out anything
// added or changed by anyone else since that device's cache was last good.
// With no reliable base, remote must be trusted outright instead.
function threeWayMerge<T extends { id: string }>(remote: T[], local: T[], base: T[] | null): T[] {
  if (base === null) return remote;
  const baseMap = new Map(base.map(x => [x.id, x]));
  const localMap = new Map(local.map(x => [x.id, x]));
  const result = new Map<string, T>(remote.map(x => [x.id, x]));
  baseMap.forEach((_, id) => { if (!localMap.has(id)) result.delete(id); }); // deleted locally
  localMap.forEach((x, id) => {
    const baseItem = baseMap.get(id);
    if (!baseItem || JSON.stringify(baseItem) !== JSON.stringify(x)) result.set(id, x); // added/edited locally
  });
  return [...result.values()];
}

export default function App() {
  // ---- data ----
  const [sites, setSites] = useState<Site[]>(() => loadStoredData('sites', INITIAL_SITES));
  const [inventory, setInventory] = useState<InventoryItem[]>(
    () => loadStoredData<any[]>('inventory', INITIAL_INVENTORY).map(sanitizeInventoryItem)
  );
  const [assignments, setAssignments] = useState<Assignment[]>(() => loadStoredData('assignments', INITIAL_ASSIGNMENTS));
  const [requests, setRequests] = useState<SiteRequest[]>(() => loadStoredData('requests', INITIAL_REQUESTS));
  const [users, setUsers] = useState<UserAccount[]>(() => loadStoredData('users', INITIAL_USERS));

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    const loaded = loadStoredData<UserAccount[]>('users', INITIAL_USERS);
    const activeId = getActiveSessionUserId();
    if (!activeId) return null;
    const match = loaded.find(u => u.id === activeId);
    return match && match.status !== 'Suspended' ? match : null;
  });

  const [activeTab, setActiveTab] = useState<string>(() => loadStoredData('active_tab', ''));
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const askConfirm = (message: string, onConfirm: () => void, opts?: Partial<ConfirmState>) => {
    setConfirmState({ message, onConfirm, danger: true, confirmLabel: 'Delete', ...opts });
  };

  // Remember the open tab across refreshes; keep it valid for the current role.
  useEffect(() => { if (activeTab) saveStoredData('active_tab', activeTab); }, [activeTab]);
  useEffect(() => {
    if (!currentUser) return;
    const valid = roleTabIds(currentUser.role);
    if (!valid.includes(activeTab)) setActiveTab(valid[0]);
  }, [currentUser, activeTab]);

  // ---- persistence to localStorage ----
  useEffect(() => { saveStoredData('sites', sites); }, [sites]);
  useEffect(() => { saveStoredData('inventory', inventory); }, [inventory]);
  useEffect(() => { saveStoredData('assignments', assignments); }, [assignments]);
  useEffect(() => { saveStoredData('requests', requests); }, [requests]);
  useEffect(() => { saveStoredData('users', users); }, [users]);

  // ---- server sync ----
  const [bridgeConfig] = useState<BridgeConfig | null>(() => getStoredBridgeConfig());
  const [isSyncing, setIsSyncing] = useState(false);
  const [blockingLoad, setBlockingLoad] = useState<string | null>(null); // label while a big blocking load runs
  const [initialSyncDone, setInitialSyncDone] = useState(() => !getStoredBridgeConfig()?.webAppUrl);
  const hydratingRef = useRef(false);
  const bridgeReadyRef = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushPendingRef = useRef(false);
  const busyRef = useRef(false);            // a pull/push request is in flight
  const snapshotRef = useRef('');           // JSON of the last data known to match the sheet
  const lastSyncedRef = useRef<AppData | null>(null); // last data confirmed in the sheet (merge base)
  const schedulePushIfDirtyRef = useRef<(() => void) | null>(null); // set once the effect below defines it

  // Always-fresh mirrors of state, so a merge running after a debounce/await
  // sees edits made in the meantime instead of a stale closure.
  const sitesRef = useRef(sites);
  const inventoryRef = useRef(inventory);
  const assignmentsRef = useRef(assignments);
  const requestsRef = useRef(requests);
  const usersRef = useRef(users);
  useEffect(() => { sitesRef.current = sites; }, [sites]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { assignmentsRef.current = assignments; }, [assignments]);
  useEffect(() => { requestsRef.current = requests; }, [requests]);
  useEffect(() => { usersRef.current = users; }, [users]);

  const POLL_MS = 6000;

  const snapshotOf = (d: { sites: any; inventory: any; assignments: any; requests: any; users: any }) =>
    JSON.stringify([d.sites, d.inventory, d.assignments, d.requests, d.users]);

  const applyServerData = (d: AppData) => {
    hydratingRef.current = true;
    setSites(d.sites);
    setInventory(d.inventory);
    setAssignments(d.assignments);
    setRequests(d.requests);
    if (d.users.length) {
      setUsers(d.users);
      setCurrentUser(prev => (prev ? d.users.find(u => u.id === prev.id) || null : null));
    }
    snapshotRef.current = snapshotOf(d);
    lastSyncedRef.current = d;
    setTimeout(() => { hydratingRef.current = false; schedulePushIfDirtyRef.current?.(); }, 0);
  };

  // Initial load
  useEffect(() => {
    if (!bridgeConfig?.webAppUrl) { bridgeReadyRef.current = true; return; }
    let cancelled = false;
    setIsSyncing(true);
    setBlockingLoad('Loading your data…');
    busyRef.current = true;
    bridgePull(bridgeConfig)
      .then(d => { if (!cancelled) applyServerData(d); })
      .catch(err => {
        console.error('Initial sheet pull failed:', err);
        showToast('Could not reach the server — using local copy.');
      })
      .finally(() => {
        if (cancelled) return;
        busyRef.current = false;
        setIsSyncing(false);
        setBlockingLoad(null);
        setInitialSyncDone(true);
        bridgeReadyRef.current = true;
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced push on local change. Before writing we pull the sheet and merge,
  // so two people editing at the same time don't overwrite each other's rows.
  //
  // This also runs (via schedulePushIfDirtyRef) right after any hydration window
  // closes elsewhere (initial load, poll, or this push's own state-adopt step),
  // and again once any sync cycle finishes — so an edit made while one was
  // already running is never silently dropped, just picked up by the next one.
  //
  // Only one sync cycle (push or poll) is ever allowed to run at a time
  // (guarded by busyRef, checked synchronously with no `await` before it's
  // set). `clearTimeout` on a re-schedule can only cancel a timer that hasn't
  // fired yet — it can't stop one that's already mid-flight. Without this
  // guard, a slow, older push (whose pull happened before a newer edit was
  // even made) could finish AFTER a faster, newer push, and silently
  // overwrite the sheet with its stale snapshot — dropping whatever the
  // newer push had just saved. That race is what made a freshly-added site
  // or request seem to vanish a couple of seconds after being saved.
  const schedulePushIfDirty = () => {
    if (!bridgeConfig?.webAppUrl || bridgeConfig.autoSyncEnabled === false) return;

    const current = snapshotOf({
      sites: sitesRef.current, inventory: inventoryRef.current, assignments: assignmentsRef.current,
      requests: requestsRef.current, users: usersRef.current,
    });
    if (current === snapshotRef.current) return; // nothing actually changed

    // Mark it pending even if we can't schedule the timer yet below — the
    // periodic safety-net retry, and every hydration-window close, calls
    // this again shortly, so a change made mid-hydration is never left
    // untracked (which used to mean it only ever reached localStorage and
    // got quietly wiped by the sheet's older data on the next page load).
    pushPendingRef.current = true;
    if (!bridgeReadyRef.current || hydratingRef.current) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      if (busyRef.current) return; // a sync cycle is already running; it will retry this on completion

      try {
        setIsSyncing(true);
        setBlockingLoad('Saving…');
        busyRef.current = true;

        let remote: AppData | null = null;
        try { remote = await bridgePull(bridgeConfig); } catch { /* offline — push local as-is */ }

        const base = lastSyncedRef.current;
        const localNow: AppData = {
          sites: sitesRef.current,
          inventory: inventoryRef.current,
          assignments: assignmentsRef.current,
          requests: requestsRef.current,
          users: usersRef.current,
        };
        const merged: AppData = remote
          ? {
              sites: threeWayMerge(remote.sites, localNow.sites, base ? base.sites : null),
              inventory: threeWayMerge(remote.inventory, localNow.inventory, base ? base.inventory : null),
              assignments: threeWayMerge(remote.assignments, localNow.assignments, base ? base.assignments : null),
              requests: threeWayMerge(remote.requests, localNow.requests, base ? base.requests : null),
              users: threeWayMerge(remote.users, localNow.users, base ? base.users : null),
            }
          : localNow;

        await bridgePush(bridgeConfig, merged);
        snapshotRef.current = snapshotOf(merged);
        lastSyncedRef.current = merged;

        // adopt the merged result so other people's concurrent additions appear here
        hydratingRef.current = true;
        setSites(merged.sites);
        setInventory(merged.inventory);
        setAssignments(merged.assignments);
        setRequests(merged.requests);
        setUsers(merged.users);
        setCurrentUser(prev => (prev ? merged.users.find(u => u.id === prev.id) || prev : prev));
        setTimeout(() => { hydratingRef.current = false; }, 0);
      } catch (err) {
        console.error('Auto-sync failed:', err);
        showToast('Auto-sync failed — will retry on next change.');
      } finally {
        busyRef.current = false;
        pushPendingRef.current = false;
        setIsSyncing(false);
        setBlockingLoad(null);
        // Something may have changed (or been deferred above) while this ran — recheck.
        setTimeout(() => schedulePushIfDirtyRef.current?.(), 0);
      }
    }, 900);
  };
  schedulePushIfDirtyRef.current = schedulePushIfDirty;

  useEffect(() => {
    schedulePushIfDirty();
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, inventory, assignments, requests, users]);

  // Near-real-time: poll the server so changes from other people show up
  // here. Applied silently (no blocking overlay) — the merge itself is fast
  // and happens in the background, so it shouldn't interrupt whatever the
  // user is doing (typing, scrolling, mid-click) the way a full-screen
  // "Updating…" overlay every few seconds used to.
  useEffect(() => {
    if (!bridgeConfig?.webAppUrl) return;

    const poll = async () => {
      if (document.hidden) return;
      if (pushPendingRef.current || busyRef.current || hydratingRef.current) return;
      try {
        busyRef.current = true;
        const d = await bridgePull(bridgeConfig);
        if (pushPendingRef.current) return; // a local edit landed while fetching
        const incoming = snapshotOf(d);
        if (incoming === snapshotRef.current) return;
        // The server is trusted here (so other people's deletes reach us
        // too); only truly-new, not-yet-synced local rows are preserved.
        const base = lastSyncedRef.current;
        const merged: AppData = {
          sites: threeWayMerge(d.sites, sitesRef.current, base ? base.sites : null),
          inventory: threeWayMerge(d.inventory, inventoryRef.current, base ? base.inventory : null),
          assignments: threeWayMerge(d.assignments, assignmentsRef.current, base ? base.assignments : null),
          requests: threeWayMerge(d.requests, requestsRef.current, base ? base.requests : null),
          users: d.users.length ? threeWayMerge(d.users, usersRef.current, base ? base.users : null) : usersRef.current,
        };
        hydratingRef.current = true;
        setSites(merged.sites);
        setInventory(merged.inventory);
        setAssignments(merged.assignments);
        setRequests(merged.requests);
        setUsers(merged.users);
        setCurrentUser(prev => (prev ? merged.users.find(u => u.id === prev.id) || prev : prev));
        // Base = what the server actually has right now (not the merged
        // local view, which may still contain not-yet-synced local additions).
        snapshotRef.current = incoming;
        lastSyncedRef.current = d;
        setTimeout(() => { hydratingRef.current = false; schedulePushIfDirtyRef.current?.(); }, 350);
      } catch {
        /* transient — try again next tick */
      } finally {
        busyRef.current = false;
      }
    };

    const timer = window.setInterval(poll, POLL_MS);
    // Safety net: independent of poll/push completion callbacks, so a change
    // marked pending while hydrating (see schedulePushIfDirty) is never
    // stuck waiting on a callback chain that, for whatever reason, didn't
    // fire — it's retried here within a few seconds no matter what.
    const retryTimer = window.setInterval(() => schedulePushIfDirtyRef.current?.(), 4000);
    // Refresh the moment the user comes back to the tab — no need to also
    // poll on every tap/click, which was firing a network request on
    // essentially every interaction in the app.
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConfig]);

  // ---- auth ----
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const handleLogin = (u: UserAccount) => {
    setActiveSessionUserId(u.id);
    const stamped = { ...u, lastLogin: new Date().toISOString() };
    setCurrentUser(stamped);
    setUsers(prev => prev.map(x => (x.id === u.id ? stamped : x)));
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
  const saveSite = (draft: Site) => {
    const s: Site = { ...draft, updatedAt: nowIso() };

    // "I will collect this myself" was just ticked on an open site -> put it
    // straight into that person's My Work instead of making them request it.
    // Checked against ANY existing assignment for this site+collector, not
    // just an Active one — a Completed one already covers this site too, so
    // re-ticking it shouldn't add a second, empty entry.
    const selfAssigning =
      s.reservedById &&
      s.status === 'Available' &&
      !assignments.some(a => a.siteId === s.id && a.collectorId === s.reservedById);

    if (selfAssigning) {
      const newAsg: Assignment = {
        id: uid('asg'),
        siteId: s.id,
        siteName: s.name,
        collectorId: s.reservedById,
        collectorName: s.reservedByName,
        assignedById: s.reservedById,
        assignedByName: s.reservedByName,
        status: 'Active',
        hoursLogged: 0,
        sessions: [],
        createdAt: todayStr(),
        updatedAt: nowIso(),
      };
      setAssignments(prev => [...prev, newAsg]);
    }

    setSites(prev => (prev.some(x => x.id === s.id) ? prev.map(x => (x.id === s.id ? s : x)) : [...prev, s]));
    showToast(selfAssigning ? `Added "${s.name}" to your My Work.` : s.status === 'Pending Approval' ? `Submitted "${s.name}" for admin approval.` : `Saved site: ${s.name}`);
  };
  // Admin approves a newly-added site: it becomes Available for shoot, or — if
  // the finder had already claimed it for themselves — goes straight to their My Work.
  const approveSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site || site.status !== 'Pending Approval') return;

    const message = site.reservedById
      ? `Approve "${site.name}"? It goes straight into ${site.reservedByName}'s My Work, and other collectors can still request it too.`
      : `Approve "${site.name}"? It becomes available for shoot to all data collectors.`;

    askConfirm(message, () => {
      setSites(prev => prev.map(s => (s.id === id ? { ...s, status: 'Available', updatedAt: nowIso() } : s)));
      if (site.reservedById) {
        const newAsg: Assignment = {
          id: uid('asg'),
          siteId: site.id,
          siteName: site.name,
          collectorId: site.reservedById,
          collectorName: site.reservedByName,
          assignedById: site.reservedById,
          assignedByName: site.reservedByName,
          status: 'Active',
          hoursLogged: 0,
          sessions: [],
          createdAt: todayStr(),
          updatedAt: nowIso(),
        };
        setAssignments(prev => [...prev, newAsg]);
        showToast(`Approved "${site.name}" — added to ${site.reservedByName}'s My Work.`);
      } else {
        showToast(`Approved "${site.name}" — now available for shoot.`);
      }
    }, { title: 'Approve site', confirmLabel: 'Approve', danger: false });
  };
  // Admin declines a pending site — it never went live, so simply removes it
  // rather than leaving it stuck in limbo.
  const rejectSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site || site.status !== 'Pending Approval') return;
    askConfirm(`Cancel approval for "${site.name}"? It will be removed and its finder will need to re-add it if this was a mistake.`, () => {
      setSites(prev => prev.filter(s => s.id !== id));
      showToast(`Rejected "${site.name}" — not added.`);
    }, { title: 'Cancel approval', confirmLabel: 'Cancel approval' });
  };
  const deleteSite = (id: string) => {
    const site = sites.find(s => s.id === id);
    if (!site) return;
    const isAdmin = currentUser?.role === 'Admin';
    if (!isAdmin) {
      if (assignments.some(a => a.siteId === id)) {
        showToast('This site has assignments — it can’t be deleted.');
        return;
      }
      if (requests.some(r => r.siteId === id && r.status === 'Pending')) {
        showToast('This site has a pending request — decide on it first.');
        return;
      }
    }
    const relatedAssignments = assignments.filter(a => a.siteId === id).length;
    const relatedRequests = requests.filter(r => r.siteId === id).length;
    const extra = relatedAssignments || relatedRequests
      ? ` This also removes ${relatedAssignments} assignment${relatedAssignments === 1 ? '' : 's'} (out of anyone's My Work) and ${relatedRequests} request${relatedRequests === 1 ? '' : 's'} tied to it.`
      : '';

    askConfirm(`Delete "${site.name}"? This can't be undone.${extra}`, () => {
      setSites(prev => prev.filter(s => s.id !== id));
      // Cascade: nothing referencing this site should linger anywhere —
      // it should look deleted from every screen, including collectors' My Work.
      setAssignments(prev => prev.filter(a => a.siteId !== id));
      setRequests(prev => prev.filter(r => r.siteId !== id));
      showToast('Site deleted everywhere it was used.');
    });
  };

  // ---- inventory handlers ----
  const saveInventoryItem = (draft: InventoryItem) => {
    const it: InventoryItem = { ...draft, updatedAt: nowIso() };
    setInventory(prev => (prev.some(i => i.id === it.id) ? prev.map(i => (i.id === it.id ? it : i)) : [...prev, it]));
    showToast(`Saved item: ${it.name}`);
  };
  const addInventoryBatch = (items: InventoryItem[]) => {
    const stamped = items.map(i => ({ ...i, updatedAt: nowIso() }));
    setInventory(prev => [...prev, ...stamped]);
    showToast(`Added ${items.length} item${items.length === 1 ? '' : 's'}.`);
  };

  const deleteInventoryItem = (id: string) => {
    const item = inventory.find(i => i.id === id);
    if (!item) return;
    if (currentUser?.role !== 'Admin' && heldQuantity(item) > 0) {
      showToast('That item is held by a collector — check it in first.');
      return;
    }
    askConfirm(`Delete "${item.name}"? This can't be undone.`, () => {
      setInventory(prev => prev.filter(i => i.id !== id));
      showToast('Inventory item deleted.');
    });
  };

  // Set exactly which items (and how many of each) a data collector holds
  // (Logins → Equipment). Items they hold now but not in `picks` go back to
  // stock; picked items are set to the requested quantity, capped by what's
  // actually available.
  const setCollectorKit = (collectorId: string, picks: { itemId: string; quantity: number }[]) => {
    const collector = users.find(u => u.id === collectorId);
    setInventory(prev => prev.map(i => {
      const pick = picks.find(p => p.itemId === i.id);
      const existing = i.holders.find(h => h.collectorId === collectorId);
      if (pick) {
        const cap = availableQuantity(i) + (existing?.quantity || 0);
        const qty = Math.max(1, Math.min(pick.quantity, cap));
        const holders = existing
          ? i.holders.map(h => (h.collectorId === collectorId ? { ...h, quantity: qty } : h))
          : [...i.holders, { collectorId, collectorName: collector?.name || '', quantity: qty }];
        return { ...i, holders, updatedAt: nowIso() };
      }
      if (existing) {
        return { ...i, holders: i.holders.filter(h => h.collectorId !== collectorId), updatedAt: nowIso() };
      }
      return i;
    }));
    showToast(`Updated ${collector?.name || 'collector'}'s equipment.`);
  };

  // Give some (not necessarily all) of an item's remaining stock to a collector.
  // Adds to their existing holding of this item if they already have some.
  const assignInventoryQuantity = (itemId: string, collectorId: string, quantity: number) => {
    const collector = users.find(u => u.id === collectorId);
    const item = inventory.find(i => i.id === itemId);
    if (!item || !collector || quantity <= 0) return;
    if (quantity > availableQuantity(item)) {
      showToast(`Only ${availableQuantity(item)} of "${item.name}" left in stock.`);
      return;
    }
    setInventory(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const existing = i.holders.find(h => h.collectorId === collectorId);
      const holders = existing
        ? i.holders.map(h => (h.collectorId === collectorId ? { ...h, quantity: h.quantity + quantity } : h))
        : [...i.holders, { collectorId, collectorName: collector.name, quantity }];
      return { ...i, holders, updatedAt: nowIso() };
    }));
    showToast(`Assigned ${quantity} × "${item.name}" to ${collector.name}.`);
  };

  // ---- assignment handlers ----
  const denormAssignment = (a: Assignment): Assignment => {
    const site = sites.find(s => s.id === a.siteId);
    const collector = users.find(u => u.id === a.collectorId);
    return {
      ...a,
      siteName: site?.name || a.siteName || '(missing site)',
      collectorName: collector?.name || a.collectorName || '(missing collector)',
      assignedById: currentUser?.id || a.assignedById,
      assignedByName: currentUser?.name || a.assignedByName,
    };
  };

  // Sites never lock to one collector — many people may work the same site at
  // once, and assignments don't change a site's approval status.
  const saveAssignment = (draft: Assignment) => {
    const full = { ...denormAssignment(draft), updatedAt: nowIso() };
    setAssignments(prev => (prev.some(a => a.id === full.id) ? prev.map(a => (a.id === full.id ? full : a)) : [...prev, full]));
    showToast(`Assigned ${full.collectorName} to ${full.siteName}.`);
  };

  const deleteAssignment = (id: string) => {
    const removed = assignments.find(a => a.id === id);
    if (!removed) return;
    askConfirm(`Delete the assignment for ${removed.collectorName} at ${removed.siteName}? This can't be undone.`, () => {
      setAssignments(prev => prev.filter(a => a.id !== id));
      showToast('Assignment deleted.');
    });
  };

  // Data collector: log hours (per camera / per task) against a site they're still working — stays Active.
  const submitHours = (assignmentId: string, newRows: Omit<CollectionSession, 'id'>[]) => {
    const newSessions: CollectionSession[] = newRows.map(row => ({ ...row, id: uid('ses') }));
    setAssignments(prev => prev.map(a => {
      if (a.id !== assignmentId) return a;
      const sessions = [...a.sessions, ...newSessions];
      return {
        ...a,
        sessions,
        hoursLogged: sessions.reduce((s, x) => s + (Number(x.hours) || 0), 0),
        updatedAt: nowIso(),
      };
    }));
    const addedHours = newSessions.reduce((s, x) => s + (Number(x.hours) || 0), 0);
    showToast(`Submitted ${addedHours.toFixed(2)}h.`);
  };

  // Data collector: optionally log any remaining hours, then mark the site done.
  const finishAssignment = (assignmentId: string, newRows: Omit<CollectionSession, 'id'>[]) => {
    const newSessions: CollectionSession[] = newRows.map(row => ({ ...row, id: uid('ses') }));
    setAssignments(prev => prev.map(a => {
      if (a.id !== assignmentId) return a;
      const sessions = newSessions.length ? [...a.sessions, ...newSessions] : a.sessions;
      return {
        ...a,
        sessions,
        hoursLogged: sessions.reduce((s, x) => s + (Number(x.hours) || 0), 0),
        status: 'Completed',
        updatedAt: nowIso(),
      };
    }));
    const addedHours = newSessions.reduce((s, x) => s + (Number(x.hours) || 0), 0);
    showToast(newSessions.length ? `Submitted ${addedHours.toFixed(2)}h — site marked done.` : 'Site marked done.');
  };

  const reopenAssignment = (assignmentId: string) => {
    setAssignments(prev => prev.map(a => (a.id === assignmentId ? { ...a, status: 'Active', updatedAt: nowIso() } : a)));
    showToast('Assignment re-opened.');
  };

  // Data collector: fix a mistake in a session they logged themselves. Locked once admin has verified it.
  const updateSessionEntry = (assignmentId: string, sessionId: string, updates: Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>) => {
    setAssignments(prev => prev.map(a => {
      if (a.id !== assignmentId) return a;
      const sessions = a.sessions.map(s => (s.id === sessionId && s.actualHours == null ? { ...s, ...updates } : s));
      return { ...a, sessions, hoursLogged: sessions.reduce((s, x) => s + (Number(x.hours) || 0), 0), updatedAt: nowIso() };
    }));
    showToast('Entry updated.');
  };

  const deleteSessionEntry = (assignmentId: string, sessionId: string) => {
    askConfirm('Delete this hours entry? This can\'t be undone.', () => {
      setAssignments(prev => prev.map(a => {
        if (a.id !== assignmentId) return a;
        const target = a.sessions.find(s => s.id === sessionId);
        if (!target || target.actualHours != null) return a;
        const sessions = a.sessions.filter(s => s.id !== sessionId);
        return { ...a, sessions, hoursLogged: sessions.reduce((s, x) => s + (Number(x.hours) || 0), 0), updatedAt: nowIso() };
      }));
      showToast('Entry deleted.');
    });
  };

  // Admin verifies the actual hours collected for one logged entry, alongside
  // what the collector originally entered. The entry's date never changes —
  // verification can happen any day after it was logged.
  const verifySessionHours = (assignmentId: string, sessionId: string, actualHours: number) => {
    setAssignments(prev => prev.map(a => {
      if (a.id !== assignmentId) return a;
      return {
        ...a,
        sessions: a.sessions.map(s => (s.id === sessionId
          ? { ...s, actualHours, verifiedByName: currentUser?.name || 'Admin', verifiedAt: nowIso() }
          : s)),
        updatedAt: nowIso(),
      };
    }));
  };

  // Check some or all of one collector's held quantity of an item back in.
  // A problem check-in pulls those units into a Flagged issue (pending
  // review) rather than tainting the whole item — the rest stays fine.
  const returnInventoryItem = (itemId: string, collectorId: string, quantity: number, ok: boolean, note: string) => {
    setInventory(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const holder = i.holders.find(h => h.collectorId === collectorId);
      if (!holder) return i;
      const qty = Math.min(quantity, holder.quantity);
      if (qty <= 0) return i;
      const record: ReturnRecord = {
        date: todayStr(),
        ok,
        note: ok ? '' : note.trim(),
        byName: currentUser?.name || 'Admin',
        fromCollectorId: collectorId,
        fromCollectorName: holder.collectorName,
        quantity: qty,
      };
      const holders = qty >= holder.quantity
        ? i.holders.filter(h => h.collectorId !== collectorId)
        : i.holders.map(h => (h.collectorId === collectorId ? { ...h, quantity: h.quantity - qty } : h));
      const issues = ok ? i.issues : [
        ...i.issues,
        {
          id: `iss-${Date.now()}`,
          condition: 'Flagged' as const,
          quantity: qty,
          note: note.trim(),
          reportedAt: nowIso(),
          reportedByCollectorId: collectorId,
          reportedByCollectorName: holder.collectorName,
        },
      ];
      return {
        ...i,
        holders,
        issues,
        returnLog: [record, ...i.returnLog].slice(0, 50),
        updatedAt: nowIso(),
      };
    }));
    const nm = inventory.find(i => i.id === itemId)?.name || 'item';
    showToast(ok ? `Checked in ${quantity} × "${nm}".` : `Checked in ${quantity} × "${nm}" — flagged.`);
  };

  // Pull some units out of circulation into a Flagged/Damaged/Lost bucket —
  // either from free stock, or straight out of what a specific collector
  // holds (their unit is lost/damaged while still checked out to them).
  const reportItemIssue = (
    itemId: string,
    condition: InventoryIssue['condition'],
    quantity: number,
    note: string,
    sourceCollectorId: string | null
  ) => {
    if (quantity <= 0) return;
    setInventory(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      let holders = i.holders;
      let reportedByCollectorName: string | undefined;
      if (sourceCollectorId) {
        const holder = i.holders.find(h => h.collectorId === sourceCollectorId);
        if (!holder || quantity > holder.quantity) return i;
        reportedByCollectorName = holder.collectorName;
        holders = quantity >= holder.quantity
          ? i.holders.filter(h => h.collectorId !== sourceCollectorId)
          : i.holders.map(h => (h.collectorId === sourceCollectorId ? { ...h, quantity: h.quantity - quantity } : h));
      } else if (quantity > availableQuantity(i)) {
        return i;
      }
      const issue: InventoryIssue = {
        id: `iss-${Date.now()}`,
        condition,
        quantity,
        note: note.trim(),
        reportedAt: nowIso(),
        reportedByCollectorId: sourceCollectorId || undefined,
        reportedByCollectorName,
      };
      return { ...i, holders, issues: [...i.issues, issue], updatedAt: nowIso() };
    }));
    const nm = inventory.find(i => i.id === itemId)?.name || 'item';
    showToast(`Reported ${quantity} × "${nm}" ${condition.toLowerCase()}.`);
  };

  // Resolve a reported issue: return its units to stock, or reclassify a
  // pending Flagged issue into a confirmed Damaged/Lost outcome. Either way,
  // the original report is kept in resolvedIssues (who reported it, who
  // resolved it, when, and how) rather than just disappearing — so it stays
  // clear who's accountable if the same item shows a problem again later.
  const resolveItemIssue = (
    itemId: string,
    issueId: string,
    action: { type: 'clear' } | { type: 'reclassify'; condition: 'Damaged' | 'Lost'; note: string }
  ) => {
    setInventory(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const issue = i.issues.find(x => x.id === issueId);
      if (!issue) return i;
      const issues = i.issues.filter(x => x.id !== issueId);
      const resolvedIssues: ResolvedIssue[] = [
        {
          ...issue,
          outcome: (action.type === 'clear' ? 'Cleared' : action.condition) as ResolvedIssue['outcome'],
          resolvedAt: nowIso(),
          resolvedByName: currentUser?.name || 'Admin',
        },
        ...i.resolvedIssues,
      ].slice(0, 100);
      if (action.type === 'reclassify') {
        issues.push({ ...issue, id: `iss-${Date.now()}`, condition: action.condition, note: action.note.trim() || issue.note, reportedAt: nowIso() });
      }
      return { ...i, issues, resolvedIssues, updatedAt: nowIso() };
    }));
    showToast(action.type === 'clear' ? 'Cleared — back in stock.' : `Marked ${action.condition.toLowerCase()}.`);
  };

  // ---- request handlers ----
  // Collectors may hold several sites at once — just no duplicate pending
  // request for the same site, and no requesting a site that's already in
  // their My Work (Active OR Completed — this used to slip through both
  // when someone ticked "I'll collect this myself" and separately requested
  // the same site, and when someone re-requested a site they'd already
  // finished, producing a duplicate, still-empty assignment on approval).
  const createRequest = (siteId: string) => {
    if (!currentUser) return;
    const site = sites.find(s => s.id === siteId);
    if (!site) return;
    if (assignments.some(a => a.siteId === siteId && a.collectorId === currentUser.id)) {
      showToast('This site is already in your My Work.');
      return;
    }
    if (requests.some(r => r.siteId === siteId && r.collectorId === currentUser.id && r.status === 'Pending')) {
      showToast('You already have a pending request for this site.');
      return;
    }
    const req: SiteRequest = {
      id: uid('req'),
      siteId,
      siteName: site.name,
      collectorId: currentUser.id,
      collectorName: currentUser.name,
      status: 'Pending',
      requestedAt: nowIso(),
      updatedAt: nowIso(),
    };
    setRequests(prev => [...prev, req]);
    showToast(`Requested "${site.name}".`);
  };

  // A collector can withdraw their own pending request.
  const cancelRequest = (requestId: string) => {
    const req = requests.find(r => r.id === requestId);
    if (!req || req.status !== 'Pending' || req.collectorId !== currentUser?.id) return;
    setRequests(prev => prev.filter(r => r.id !== requestId));
    showToast('Request cancelled.');
  };

  const decideRequest = (requestId: string, approve: boolean) => {
    const req = requests.find(r => r.id === requestId);
    if (!req) return;
    setRequests(prev => prev.map(r => (r.id === requestId
      ? { ...r, status: approve ? 'Approved' : 'Rejected', decidedAt: nowIso(), updatedAt: nowIso() }
      : r)));
    if (approve) {
      const already = assignments.some(a => a.siteId === req.siteId && a.collectorId === req.collectorId);
      if (!already) {
        saveAssignment({
          id: uid('asg'),
          siteId: req.siteId,
          siteName: req.siteName,
          collectorId: req.collectorId,
          collectorName: req.collectorName,
          assignedById: currentUser?.id || '',
          assignedByName: currentUser?.name || '',
          status: 'Active',
          hoursLogged: 0,
          sessions: [],
          createdAt: todayStr(),
          updatedAt: nowIso(),
        });
      }
    }
    showToast(approve ? 'Request approved — assignment created.' : 'Request rejected.');
  };

  // ---- user handlers ----
  const saveUser = (draft: UserAccount) => {
    const u: UserAccount = { ...draft, updatedAt: nowIso() };
    setUsers(prev => (prev.some(x => x.id === u.id) ? prev.map(x => (x.id === u.id ? u : x)) : [...prev, u]));
    if (currentUser?.id === u.id) setCurrentUser(u);
    showToast(`Saved ${u.name}.`);
  };
  const deleteUser = (id: string) => {
    if (id === currentUser?.id) { showToast("You can't delete your own account."); return; }
    const target = users.find(u => u.id === id);
    if (!target) return;
    askConfirm(`Delete the login "${target.name}"? This can't be undone.`, () => {
      // Return any equipment they held to stock so nothing is left dangling.
      setInventory(prev => prev.map(i => (
        i.holders.some(h => h.collectorId === id)
          ? { ...i, holders: i.holders.filter(h => h.collectorId !== id), updatedAt: nowIso() }
          : i
      )));
      setUsers(prev => prev.filter(u => u.id !== id));
      showToast('Login deleted.');
    });
  };

  // ---- scoped data ----
  const mySites = useMemo(
    () => (currentUser ? sites.filter(s => s.foundById === currentUser.id) : []),
    [sites, currentUser]
  );
  const myAssignments = useMemo(
    () => (currentUser ? assignments.filter(a => a.collectorId === currentUser.id) : []),
    [assignments, currentUser]
  );
  const myRequests = useMemo(
    () => (currentUser ? requests.filter(r => r.collectorId === currentUser.id) : []),
    [requests, currentUser]
  );
  // Any approved site is open to request — a self-claim by another finder
  // doesn't block it; multiple collectors may work the same site at once.
  const availableSites = useMemo(
    () => sites.filter(s => s.status === 'Available'),
    [sites]
  );
  const dataCollectors = useMemo(
    () => users.filter(u => CAN_COLLECT.includes(u.role) && u.status === 'Active'),
    [users]
  );
  const pendingRequestCount = requests.filter(r => r.status === 'Pending').length;
  const canFind = currentUser ? CAN_FIND_SITES.includes(currentUser.role) : false;
  const canCollect = currentUser ? CAN_COLLECT.includes(currentUser.role) : false;

  // Items currently held by a collector (fixed kit, kept across all their sites).
  const itemsOutCount = useMemo(() => inventory.filter(i => i.holders.length > 0).length, [inventory]);
  const myKit = useMemo(
    () => (currentUser ? inventory.filter(i => i.holders.some(h => h.collectorId === currentUser.id)) : []),
    [inventory, currentUser]
  );
  // ---- render gates ----
  const toastEl = toast && (
    <div className="fixed bottom-5 right-5 z-[60] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center gap-3 text-xs">
      <span className="w-2 h-2 rounded-full bg-emerald-400" />
      <span>{toast}</span>
    </div>
  );

  if (!currentUser && !initialSyncDone) {
    return <LoadingOverlay show label="Loading your data…" />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center">
        <LoginScreen
          onVerifyLogin={(loginId, password) => bridgeLogin(bridgeConfig || DEFAULT_BRIDGE_CONFIG, users, loginId, password)}
          onLoginSuccess={handleLogin}
        />
        {toastEl}
      </div>
    );
  }

  const role = currentUser.role;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      <Header
        currentUser={currentUser}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        onOpenProfile={() => setIsProfileOpen(true)}
        isSyncing={isSyncing}
        pendingRequestCount={pendingRequestCount}
        outCount={itemsOutCount}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">
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
      <LoadingOverlay show={blockingLoad !== null} label={blockingLoad || undefined} />
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
