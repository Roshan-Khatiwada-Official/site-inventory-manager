// Mirrors frontend/src/types.ts exactly — this is the wire format both
// sides agree on. Kept as a plain duplicate (not a shared package) to keep
// the two apps independently deployable; if it drifts, the frontend build
// will fail loudly against whatever the API actually returns.

export type UserRole = 'Admin' | 'Site Finder' | 'Data Collector' | 'Field Worker';

export interface UserAccount {
  id: string;
  loginId: string;
  password: string;
  name: string;
  role: UserRole;
  status: 'Active' | 'Suspended';
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
}

export type SiteStatus = 'Pending Approval' | 'Available';

export interface Site {
  id: string;
  code: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  supervisor: string;
  supervisorContact: string;
  workerCount: number;
  note: string;
  foundById: string;
  foundByName: string;
  reservedById: string;
  reservedByName: string;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnRecord {
  date: string;
  ok: boolean;
  note: string;
  byName: string;
  fromCollectorId: string;
  fromCollectorName: string;
  quantity: number;
}

export interface InventoryHolder {
  collectorId: string;
  collectorName: string;
  quantity: number;
}

export interface InventoryIssue {
  id: string;
  condition: 'Flagged' | 'Damaged' | 'Lost';
  quantity: number;
  note: string;
  reportedAt: string;
  reportedByCollectorId?: string;
  reportedByCollectorName?: string;
}

export interface ResolvedIssue extends InventoryIssue {
  outcome: 'Cleared' | 'Damaged' | 'Lost';
  resolvedAt: string;
  resolvedByName: string;
}

export interface InventoryItem {
  id: string;
  itemId: string;
  name: string;
  category: string;
  quantity: number;
  note: string;
  issues: InventoryIssue[];
  resolvedIssues: ResolvedIssue[];
  holders: InventoryHolder[];
  returnLog: ReturnRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionSession {
  id: string;
  date: string;
  hours: number;
  note?: string;
  cameraId?: string;
  cameraName?: string;
  cameraItemId?: string;
  task?: string;
}

export type AssignmentStatus = 'Active' | 'Completed';

export interface Assignment {
  id: string;
  siteId: string;
  siteName: string;
  collectorId: string;
  collectorName: string;
  assignedById: string;
  assignedByName: string;
  status: AssignmentStatus;
  hoursLogged: number;
  sessions: CollectionSession[];
  createdAt: string;
  updatedAt: string;
}

export type RequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface SiteRequest {
  id: string;
  siteId: string;
  siteName: string;
  collectorId: string;
  collectorName: string;
  status: RequestStatus;
  requestedAt: string;
  decidedAt?: string;
  updatedAt: string;
}

export interface AppData {
  sites: Site[];
  inventory: InventoryItem[];
  assignments: Assignment[];
  requests: SiteRequest[];
  users: UserAccount[];
}
