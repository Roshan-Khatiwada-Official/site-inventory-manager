// Per-row serializers shared between the bulk /api/data read and the
// granular per-action routes, so both return the exact same shape.
import type {
  User as DbUser,
  Site as DbSite,
  InventoryItem as DbInventoryItem,
  InventoryHolder as DbInventoryHolder,
  InventoryIssue as DbInventoryIssue,
  ResolvedIssue as DbResolvedIssue,
  ReturnRecord as DbReturnRecord,
  InventoryLog as DbInventoryLog,
  Assignment as DbAssignment,
  CollectionSession as DbCollectionSession,
  SiteRequest as DbSiteRequest,
} from '@prisma/client';
import {
  ASSIGNMENT_STATUS_FROM_DB,
  REQUEST_STATUS_FROM_DB,
  ROLE_FROM_DB,
  SITE_STATUS_FROM_DB,
} from './enums.js';
import type {
  Assignment,
  CollectionSession,
  InventoryHolder,
  InventoryIssue,
  InventoryItem,
  InventoryLog,
  ResolvedIssue,
  ReturnRecord,
  Site,
  SiteRequest,
  UserAccount,
} from '../types.js';

export function toUser(u: DbUser): UserAccount {
  return {
    id: u.id,
    loginId: u.loginId,
    password: '', // never sent — see the longer comment in sync.ts
    name: u.name,
    role: ROLE_FROM_DB[u.role],
    status: u.status,
    phone: u.phone,
    email: u.email,
    address: u.address,
    notes: u.notes,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLogin: u.lastLogin ?? undefined,
  };
}

export function toSite(s: DbSite): Site {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    latitude: s.latitude,
    longitude: s.longitude,
    supervisor: s.supervisor,
    supervisorContact: s.supervisorContact,
    workerCount: s.workerCount,
    note: s.note,
    foundById: s.foundById ?? '',
    foundByName: s.foundByName,
    reservedById: s.reservedById ?? '',
    reservedByName: s.reservedByName,
    status: SITE_STATUS_FROM_DB[s.status],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

type InventoryItemWithChildren = DbInventoryItem & {
  holders: DbInventoryHolder[];
  issues: DbInventoryIssue[];
  resolvedIssues: DbResolvedIssue[];
  returnLog: DbReturnRecord[];
};

export function toInventoryItem(i: InventoryItemWithChildren, nameById: Map<string, string>): InventoryItem {
  const holder = (h: DbInventoryHolder): InventoryHolder => ({
    collectorId: h.collectorId,
    collectorName: nameById.get(h.collectorId) || '',
    quantity: h.quantity,
  });
  const issue = (x: DbInventoryIssue): InventoryIssue => ({
    id: x.id,
    condition: x.condition,
    quantity: x.quantity,
    note: x.note,
    reportedAt: x.reportedAt,
    reportedByCollectorId: x.reportedByCollectorId ?? undefined,
    reportedByCollectorName: x.reportedByCollectorName ?? undefined,
  });
  const resolved = (x: DbResolvedIssue): ResolvedIssue => ({
    ...issue(x),
    outcome: x.outcome,
    resolvedAt: x.resolvedAt,
    resolvedByName: x.resolvedByName,
  });
  const record = (r: DbReturnRecord): ReturnRecord => ({
    date: r.date,
    ok: r.ok,
    note: r.note,
    byName: r.byName,
    fromCollectorId: r.fromCollectorId,
    fromCollectorName: r.fromCollectorName,
    quantity: r.quantity,
  });
  return {
    id: i.id,
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    note: i.note,
    holders: i.holders.map(holder),
    issues: i.issues.map(issue),
    resolvedIssues: i.resolvedIssues.map(resolved),
    returnLog: i.returnLog.map(record),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export function toInventoryLog(l: DbInventoryLog): InventoryLog {
  return {
    id: l.id,
    itemId: l.itemId,
    itemName: l.itemName,
    itemCode: l.itemCode,
    activity: l.activity as InventoryLog['activity'],
    personId: l.personId,
    personName: l.personName,
    quantity: l.quantity,
    ok: l.ok,
    note: l.note,
    at: l.at,
    createdBy: l.createdBy,
    editedAt: l.editedAt ?? undefined,
    editedBy: l.editedBy ?? undefined,
  };
}

export const inventoryItemInclude = {
  holders: true,
  issues: true,
  resolvedIssues: true,
  returnLog: true,
} as const;

type AssignmentWithSessions = DbAssignment & { sessions: DbCollectionSession[] };

export function toAssignment(a: AssignmentWithSessions): Assignment {
  return {
    id: a.id,
    siteId: a.siteId,
    siteName: a.siteName,
    collectorId: a.collectorId,
    collectorName: a.collectorName,
    assignedById: a.assignedById,
    assignedByName: a.assignedByName,
    status: ASSIGNMENT_STATUS_FROM_DB[a.status],
    hoursLogged: a.hoursLogged,
    sessions: a.sessions.map((s): CollectionSession => ({
      id: s.id,
      date: s.date,
      hours: s.hours,
      note: s.note ?? undefined,
      cameraId: s.cameraId ?? undefined,
      cameraName: s.cameraName ?? undefined,
      cameraItemId: s.cameraItemId ?? undefined,
      task: s.task ?? undefined,
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function toSiteRequest(r: DbSiteRequest): SiteRequest {
  return {
    id: r.id,
    siteId: r.siteId,
    siteName: r.siteName,
    collectorId: r.collectorId,
    collectorName: r.collectorName,
    status: REQUEST_STATUS_FROM_DB[r.status],
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt ?? undefined,
    updatedAt: r.updatedAt,
  };
}
