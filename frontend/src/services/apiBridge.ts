import { Site, InventoryItem, Assignment, SiteRequest, UserAccount, CollectionSession } from '../types';
import { sanitizeInventoryItem } from '../utils/inventory';

/**
 * Client for the backend/ API (Node + Express + Prisma + PostgreSQL).
 * Full-read/full-write contract — App.tsx's own merge/conflict logic decides
 * what to do with what this returns; this file is just the transport.
 */

export interface BridgeConfig {
  webAppUrl: string;
  token: string;
  lastSyncedAt?: string;
  autoSyncEnabled?: boolean;
}

export interface AppData {
  sites: Site[];
  inventory: InventoryItem[];
  assignments: Assignment[];
  requests: SiteRequest[];
  users: UserAccount[];
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000';
const API_TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) || '';

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  webAppUrl: API_URL,
  token: API_TOKEN,
  autoSyncEnabled: true,
};

export function getStoredBridgeConfig(): BridgeConfig | null {
  return { ...DEFAULT_BRIDGE_CONFIG };
}

function arr<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

const VALID_ROLES = ['Admin', 'Site Finder', 'Data Collector', 'Field Worker'];

// The API already returns Prisma-shaped, type-correct data, but this stays
// as cheap defensive normalization — same reasoning as the old bridge: never
// trust a network response blindly, and inventory rows in particular go
// through sanitizeInventoryItem so any future schema drift degrades
// gracefully instead of crashing the whole app.
function normalize(raw: any): AppData {
  const d = raw || {};
  return {
    sites: arr<any>(d.sites).filter((s: any) => s && s.id).map((s: any): Site => ({
      id: String(s.id),
      code: s.code || '',
      name: s.name || '',
      category: s.category || '',
      latitude: Number(s.latitude) || 0,
      longitude: Number(s.longitude) || 0,
      supervisor: s.supervisor || '',
      supervisorContact: s.supervisorContact || '',
      workerCount: Number(s.workerCount) || 0,
      note: s.note || '',
      foundById: s.foundById || '',
      foundByName: s.foundByName || '',
      reservedById: s.reservedById || '',
      reservedByName: s.reservedByName || '',
      status: s.status === 'Pending Approval' ? 'Pending Approval' : 'Available',
      createdAt: s.createdAt || '',
      updatedAt: s.updatedAt || s.createdAt || '',
    })),
    inventory: arr<any>(d.inventory).filter((i: any) => i && i.id).map(sanitizeInventoryItem),
    assignments: arr<any>(d.assignments).filter((a: any) => a && a.id).map((a: any): Assignment => ({
      id: String(a.id),
      siteId: a.siteId || '',
      siteName: a.siteName || '',
      collectorId: a.collectorId || '',
      collectorName: a.collectorName || '',
      assignedById: a.assignedById || '',
      assignedByName: a.assignedByName || '',
      status: a.status === 'Completed' ? 'Completed' : 'Active',
      hoursLogged: Number(a.hoursLogged) || 0,
      sessions: arr<any>(a.sessions).map((s: any, idx: number): CollectionSession => ({
        id: s.id || `ses-legacy-${a.id}-${idx}`,
        date: s.date || '',
        hours: Number(s.hours) || 0,
        actualHours: s.actualHours != null && s.actualHours !== '' ? Number(s.actualHours) : undefined,
        verifiedByName: s.verifiedByName || undefined,
        verifiedAt: s.verifiedAt || undefined,
        note: s.note || undefined,
        cameraId: s.cameraId || undefined,
        cameraName: s.cameraName || undefined,
        cameraItemId: s.cameraItemId || undefined,
        task: s.task || undefined,
      })),
      createdAt: a.createdAt || '',
      updatedAt: a.updatedAt || a.createdAt || '',
    })),
    requests: arr<any>(d.requests).filter((r: any) => r && r.id).map((r: any): SiteRequest => ({
      id: String(r.id),
      siteId: r.siteId || '',
      siteName: r.siteName || '',
      collectorId: r.collectorId || '',
      collectorName: r.collectorName || '',
      status: r.status === 'Approved' ? 'Approved' : r.status === 'Rejected' ? 'Rejected' : 'Pending',
      requestedAt: r.requestedAt || '',
      decidedAt: r.decidedAt || undefined,
      updatedAt: r.updatedAt || r.decidedAt || r.requestedAt || '',
    })),
    users: arr<any>(d.users)
      .filter((u: any) => u && u.id && u.loginId)
      .map((u: any): UserAccount => ({
        id: String(u.id),
        loginId: String(u.loginId),
        password: u.password == null ? '' : String(u.password),
        name: u.name || String(u.loginId),
        role: VALID_ROLES.includes(u.role) ? u.role : 'Data Collector',
        status: u.status === 'Suspended' ? 'Suspended' : 'Active',
        phone: u.phone || '',
        email: u.email || '',
        address: u.address || '',
        notes: u.notes || '',
        createdAt: u.createdAt || '',
        updatedAt: u.updatedAt || u.createdAt || '',
        lastLogin: u.lastLogin || undefined,
      })),
  };
}

function headers(config: BridgeConfig): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (config.token) h['x-api-token'] = config.token;
  return h;
}

/** Read the full dataset from the backend. */
export async function bridgePull(config: BridgeConfig): Promise<AppData> {
  const res = await fetch(`${config.webAppUrl}/api/data`, { method: 'GET', headers: headers(config) });
  if (!res.ok) throw new Error(`API read failed (HTTP ${res.status}). Is the backend running?`);

  const json = await res.json().catch(() => {
    throw new Error('API returned an invalid response.');
  });
  if (!json.ok) throw new Error(json.error || 'API rejected the read request.');

  return normalize(json.data);
}

/** Overwrite the full dataset in the backend. */
export async function bridgePush(config: BridgeConfig, data: AppData): Promise<string> {
  const res = await fetch(`${config.webAppUrl}/api/data`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`API write failed (HTTP ${res.status}).`);

  const json = await res.json().catch(() => {
    throw new Error('API returned an invalid response during write.');
  });
  if (!json.ok) throw new Error(json.error || 'API rejected the write request.');

  return json.savedAt || new Date().toISOString();
}

export async function bridgeTestConnection(config: BridgeConfig): Promise<AppData> {
  return bridgePull(config);
}

/**
 * Checks a login attempt against the backend — the password never leaves
 * this call to anywhere else in the app, unlike the old model of pulling
 * every user (with their password) just to compare it client-side.
 */
export async function login(config: BridgeConfig, _users: UserAccount[], loginId: string, password: string): Promise<{ ok: true; user: UserAccount } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${config.webAppUrl}/api/auth/login`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ loginId, password }),
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'API returned an invalid response.' }));
    if (!json.ok) return { ok: false, error: json.error || 'Login failed.' };
    return { ok: true, user: json.user as UserAccount };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}
