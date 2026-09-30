// Real per-action HTTP client — one request per user action (save, delete,
// assign, check-in, …), each with its own immediate success/failure
// response. Replaces the old "queue up local edits, periodically push the
// entire dataset, merge on conflict" model, which is what caused every
// data-loss incident this app has had: a debounce timer, a merge step, and
// a stale local cache all had to agree, and when they didn't, someone's
// work vanished silently. A direct request either succeeds or throws —
// nothing to reconcile after the fact.
import type {
  Assignment,
  CollectionSession,
  InventoryIssue,
  InventoryItem,
  Site,
  SiteRequest,
  UserAccount,
} from '../types';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000';
const API_TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) || '';

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(API_TOKEN ? { 'x-api-token': API_TOKEN } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new ApiError(json?.error || `Request failed (HTTP ${res.status}).`);
  }
  return json as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---- bulk read (initial load + background poll) ----
export const getAllData = () =>
  request<{ data: { sites: Site[]; inventory: InventoryItem[]; assignments: Assignment[]; requests: SiteRequest[]; users: UserAccount[] } }>('/api/data');

// ---- auth ----
export const login = (loginId: string, password: string) =>
  post<{ user: UserAccount }>('/api/auth/login', { loginId, password });

// ---- sites ----
export const saveSite = (site: Site) => post<{ site: Site; assignment: Assignment | null }>('/api/sites', site);
export const approveSite = (id: string) => post<{ site: Site; assignment: Assignment | null }>(`/api/sites/${id}/approve`);
export const rejectSite = (id: string) => post<{}>(`/api/sites/${id}/reject`);
export const deleteSite = (id: string, isAdmin: boolean) => del<{}>(`/api/sites/${id}?isAdmin=${isAdmin}`);

// ---- inventory ----
export const saveInventoryItem = (item: InventoryItem) => post<{ item: InventoryItem }>('/api/inventory', item);
export const addInventoryBatch = (items: InventoryItem[]) => post<{ items: InventoryItem[] }>('/api/inventory/batch', { items });
export const deleteInventoryItem = (id: string, isAdmin: boolean) => del<{}>(`/api/inventory/${id}?isAdmin=${isAdmin}`);
export const assignInventoryQuantity = (itemId: string, collectorId: string, quantity: number) =>
  post<{ item: InventoryItem }>(`/api/inventory/${itemId}/assign`, { collectorId, quantity });
export const returnInventoryItem = (itemId: string, collectorId: string, quantity: number, ok: boolean, note: string, byName: string) =>
  post<{ item: InventoryItem }>(`/api/inventory/${itemId}/return`, { collectorId, quantity, ok, note, byName });
export const reportItemIssue = (
  itemId: string, condition: InventoryIssue['condition'], quantity: number, note: string, sourceCollectorId: string | null
) => post<{ item: InventoryItem }>(`/api/inventory/${itemId}/issues`, { condition, quantity, note, sourceCollectorId });
export const resolveItemIssue = (
  itemId: string, issueId: string,
  action: { type: 'clear' } | { type: 'reclassify'; condition: 'Damaged' | 'Lost'; note: string },
  resolvedByName: string
) => post<{ item: InventoryItem }>(`/api/inventory/${itemId}/issues/${issueId}/resolve`, { ...action, resolvedByName });

// ---- assignments ----
export const saveAssignment = (assignment: Assignment, assignedById: string, assignedByName: string) =>
  post<{ assignment: Assignment }>('/api/assignments', { assignment, assignedById, assignedByName });
export const deleteAssignment = (id: string) => del<{}>(`/api/assignments/${id}`);
export const submitHours = (assignmentId: string, sessions: Omit<CollectionSession, 'id'>[]) =>
  post<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/sessions`, { sessions });
export const finishAssignment = (assignmentId: string, sessions: Omit<CollectionSession, 'id'>[]) =>
  post<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/finish`, { sessions });
export const reopenAssignment = (assignmentId: string) => post<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/reopen`);
export const updateSessionEntry = (
  assignmentId: string, sessionId: string,
  updates: Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>
) => patch<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/sessions/${sessionId}`, updates);
export const deleteSessionEntry = (assignmentId: string, sessionId: string) =>
  del<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/sessions/${sessionId}`);
export const verifySessionHours = (assignmentId: string, sessionId: string, actualHours: number, verifiedByName: string) =>
  post<{ assignment: Assignment }>(`/api/assignments/${assignmentId}/sessions/${sessionId}/verify`, { actualHours, verifiedByName });

// ---- requests ----
export const createRequest = (siteId: string, collectorId: string) =>
  post<{ request: SiteRequest }>('/api/requests', { siteId, collectorId });
export const cancelRequest = (id: string, collectorId: string) =>
  request<{}>(`/api/requests/${id}`, { method: 'DELETE', body: JSON.stringify({ collectorId }) });
export const decideRequest = (id: string, approve: boolean, assignedById: string, assignedByName: string) =>
  post<{ request: SiteRequest; assignment: Assignment | null }>(`/api/requests/${id}/decide`, { approve, assignedById, assignedByName });

// ---- users ----
export const saveUser = (user: UserAccount) => post<{ user: UserAccount }>('/api/users', user);
export const deleteUser = (id: string) => del<{}>(`/api/users/${id}`);
export const setCollectorKit = (collectorId: string, picks: { itemId: string; quantity: number }[]) =>
  post<{ inventory: InventoryItem[] }>(`/api/users/${collectorId}/kit`, { picks });
