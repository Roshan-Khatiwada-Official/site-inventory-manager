import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import {
  ASSIGNMENT_STATUS_TO_DB,
  REQUEST_STATUS_TO_DB,
  ROLE_TO_DB,
  SITE_STATUS_TO_DB,
} from './enums.js';
import { hashPassword } from './auth.js';
import { inventoryItemInclude, toAssignment, toInventoryItem, toSite, toSiteRequest, toUser } from './mappers.js';
import type { AppData, Assignment, InventoryItem, Site, SiteRequest, UserAccount } from '../types.js';

type Tx = Prisma.TransactionClient;

/**
 * Read the whole database and serialize it into the exact shape the
 * frontend expects. Used for the initial load and the background poll —
 * both read-only; every write goes through the granular routes in
 * src/routes/ instead (see index.ts), which is where "the data actually
 * changes" now lives.
 */
export async function readAppData(): Promise<AppData> {
  const [users, sites, inventory, assignments, requests] = await Promise.all([
    prisma.user.findMany(),
    prisma.site.findMany(),
    prisma.inventoryItem.findMany({ include: inventoryItemInclude }),
    prisma.assignment.findMany({ include: { sessions: true } }),
    prisma.siteRequest.findMany(),
  ]);

  const nameById = new Map(users.map(u => [u.id, u.name]));

  return {
    users: users.map(toUser),
    sites: sites.map(toSite),
    inventory: inventory.map(i => toInventoryItem(i, nameById)),
    assignments: assignments.map(toAssignment),
    requests: requests.map(toSiteRequest),
  };
}

/**
 * Replace the whole database with exactly what's in `data` — the same
 * full-overwrite contract the old Google Sheets bridge had (the frontend's
 * merge/conflict logic already assumes this), just atomic now instead of
 * "write 5 chunked cells and hope nothing reads it half-done".
 */
export async function writeAppData(data: AppData): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1) Parents first, in dependency order.
    await Promise.all(data.users.map(u => upsertUser(tx, u)));
    await Promise.all(data.sites.map(s => upsertSite(tx, s)));
    await Promise.all(data.inventory.map(i => upsertInventoryItem(tx, i)));
    await Promise.all(data.assignments.map(a => upsertAssignment(tx, a)));
    await Promise.all(data.requests.map(r => upsertRequest(tx, r)));

    // 2) Prune rows that are no longer present, deepest dependents first.
    await tx.siteRequest.deleteMany({ where: { id: { notIn: data.requests.map(r => r.id) } } });
    await tx.assignment.deleteMany({ where: { id: { notIn: data.assignments.map(a => a.id) } } });
    await tx.inventoryItem.deleteMany({ where: { id: { notIn: data.inventory.map(i => i.id) } } });
    await tx.site.deleteMany({ where: { id: { notIn: data.sites.map(s => s.id) } } });
    await tx.user.deleteMany({ where: { id: { notIn: data.users.map(u => u.id) } } });
  }, { timeout: 30_000 });
}

async function upsertUser(tx: Tx, u: UserAccount) {
  // readAppData() always sends password back as '' (see comment there), so
  // every full-sync round-trip carries a blank password for every existing
  // user it didn't touch. A blank incoming password therefore means "leave
  // it alone" — only a non-empty value (the admin actually typed a new one
  // in the Add/Edit Login form) gets hashed and stored.
  let password: string | undefined;
  if (u.password) {
    password = await hashPassword(u.password);
  } else {
    const existing = await tx.user.findUnique({ where: { id: u.id }, select: { password: true } });
    password = existing?.password; // undefined for a genuinely new user with no password set — caught by the DB NOT NULL constraint
  }

  const common = {
    loginId: u.loginId,
    name: u.name,
    role: ROLE_TO_DB[u.role],
    status: u.status,
    phone: u.phone,
    email: u.email,
    address: u.address,
    notes: u.notes,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLogin: u.lastLogin ?? null,
  };
  await tx.user.upsert({
    where: { id: u.id },
    create: { id: u.id, password: password ?? '', ...common },
    update: password !== undefined ? { password, ...common } : common,
  });
}

async function upsertSite(tx: Tx, s: Site) {
  const common = {
    code: s.code,
    name: s.name,
    category: s.category,
    latitude: s.latitude,
    longitude: s.longitude,
    supervisor: s.supervisor,
    supervisorContact: s.supervisorContact,
    workerCount: s.workerCount,
    note: s.note,
    foundById: s.foundById || null,
    foundByName: s.foundByName,
    reservedById: s.reservedById || null,
    reservedByName: s.reservedByName,
    status: SITE_STATUS_TO_DB[s.status],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
  await tx.site.upsert({ where: { id: s.id }, create: { id: s.id, ...common }, update: common });
}

async function upsertInventoryItem(tx: Tx, i: InventoryItem) {
  const common = {
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    note: i.note,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
  await tx.inventoryItem.upsert({ where: { id: i.id }, create: { id: i.id, ...common }, update: common });

  // Children are small arrays and cheap to fully replace rather than diff.
  await tx.inventoryHolder.deleteMany({ where: { itemId: i.id } });
  await tx.inventoryIssue.deleteMany({ where: { itemId: i.id } });
  await tx.resolvedIssue.deleteMany({ where: { itemId: i.id } });
  await tx.returnRecord.deleteMany({ where: { itemId: i.id } });

  if (i.holders.length) {
    await tx.inventoryHolder.createMany({
      data: i.holders.map(h => ({ itemId: i.id, collectorId: h.collectorId, quantity: h.quantity })),
    });
  }
  if (i.issues.length) {
    await tx.inventoryIssue.createMany({
      data: i.issues.map(x => ({
        id: x.id, itemId: i.id, condition: x.condition, quantity: x.quantity, note: x.note,
        reportedAt: x.reportedAt,
        reportedByCollectorId: x.reportedByCollectorId || null,
        reportedByCollectorName: x.reportedByCollectorName || null,
      })),
    });
  }
  if (i.resolvedIssues.length) {
    await tx.resolvedIssue.createMany({
      data: i.resolvedIssues.map(x => ({
        id: x.id, itemId: i.id, condition: x.condition, quantity: x.quantity, note: x.note,
        reportedAt: x.reportedAt,
        reportedByCollectorId: x.reportedByCollectorId || null,
        reportedByCollectorName: x.reportedByCollectorName || null,
        outcome: x.outcome, resolvedAt: x.resolvedAt, resolvedByName: x.resolvedByName,
      })),
    });
  }
  if (i.returnLog.length) {
    await tx.returnRecord.createMany({
      data: i.returnLog.map(r => ({
        itemId: i.id, date: r.date, ok: r.ok, note: r.note, byName: r.byName,
        fromCollectorId: r.fromCollectorId, fromCollectorName: r.fromCollectorName, quantity: r.quantity,
      })),
    });
  }
}

async function upsertAssignment(tx: Tx, a: Assignment) {
  const common = {
    siteId: a.siteId,
    siteName: a.siteName,
    collectorId: a.collectorId,
    collectorName: a.collectorName,
    assignedById: a.assignedById,
    assignedByName: a.assignedByName,
    status: ASSIGNMENT_STATUS_TO_DB[a.status],
    hoursLogged: a.hoursLogged,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
  await tx.assignment.upsert({ where: { id: a.id }, create: { id: a.id, ...common }, update: common });

  await tx.collectionSession.deleteMany({ where: { assignmentId: a.id } });
  if (a.sessions.length) {
    await tx.collectionSession.createMany({
      data: a.sessions.map(s => ({
        id: s.id, assignmentId: a.id, date: s.date, hours: s.hours,
        actualHours: s.actualHours ?? null,
        verifiedByName: s.verifiedByName ?? null,
        verifiedAt: s.verifiedAt ?? null,
        note: s.note ?? null,
        cameraId: s.cameraId ?? null,
        cameraName: s.cameraName ?? null,
        cameraItemId: s.cameraItemId ?? null,
        task: s.task ?? null,
      })),
    });
  }
}

async function upsertRequest(tx: Tx, r: SiteRequest) {
  const common = {
    siteId: r.siteId,
    siteName: r.siteName,
    collectorId: r.collectorId,
    collectorName: r.collectorName,
    status: REQUEST_STATUS_TO_DB[r.status],
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt ?? null,
    updatedAt: r.updatedAt,
  };
  await tx.siteRequest.upsert({ where: { id: r.id }, create: { id: r.id, ...common }, update: common });
}
