import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { inventoryItemInclude, toInventoryItem, toInventoryLog } from '../lib/mappers.js';
import { nowIso, todayStr, uid } from '../lib/ids.js';
import type { InventoryItem } from '../types.js';

export const inventoryRouter = Router();

async function loadItem(id: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id }, include: inventoryItemInclude });
  if (!item) return null;
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  return toInventoryItem(item, new Map(users.map(u => [u.id, u.name])));
}

function heldQty(item: { holders: { quantity: number }[] }) {
  return item.holders.reduce((s, h) => s + h.quantity, 0);
}
function issueQty(item: { issues: { quantity: number }[] }) {
  return item.issues.reduce((s, x) => s + x.quantity, 0);
}
function availableQty(item: { quantity: number; holders: { quantity: number }[]; issues: { quantity: number }[] }) {
  return Math.max(0, item.quantity - heldQty(item) - issueQty(item));
}

// Create or update an item's own fields (name/category/quantity/note) — not
// its holders/issues, which have their own dedicated actions below.
inventoryRouter.post('/', async (req, res) => {
  try {
    const draft = req.body as InventoryItem;
    if (!draft?.id || !draft.itemId || !draft.name) {
      return res.status(400).json({ ok: false, error: 'Item ID and name are required.' });
    }
    const common = {
      itemId: draft.itemId, name: draft.name, category: draft.category,
      quantity: draft.quantity, note: draft.note, updatedAt: nowIso(),
    };
    await prisma.inventoryItem.upsert({
      where: { id: draft.id },
      create: { id: draft.id, createdAt: todayStr(), ...common },
      update: common,
    });
    const item = await loadItem(draft.id);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('POST /api/inventory failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save the item. Nothing was changed.' });
  }
});

inventoryRouter.post('/batch', async (req, res) => {
  try {
    const items = req.body?.items as InventoryItem[];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'No items to add.' });
    const now = nowIso();
    const today = todayStr();
    await prisma.inventoryItem.createMany({
      data: items.map(i => ({
        id: i.id, itemId: i.itemId, name: i.name, category: i.category,
        quantity: i.quantity, note: i.note, createdAt: today, updatedAt: now,
      })),
    });
    const holderRows = items.flatMap(i => (i.holders || []).map(h => ({ itemId: i.id, collectorId: h.collectorId, quantity: h.quantity })));
    if (holderRows.length) await prisma.inventoryHolder.createMany({ data: holderRows });

    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const nameById = new Map(users.map(u => [u.id, u.name]));
    const created = await prisma.inventoryItem.findMany({ where: { id: { in: items.map(i => i.id) } }, include: inventoryItemInclude });
    res.json({ ok: true, items: created.map(i => toInventoryItem(i, nameById)) });
  } catch (err) {
    console.error('POST /api/inventory/batch failed:', err);
    res.status(500).json({ ok: false, error: 'Could not add the items. Nothing was changed.' });
  }
});

inventoryRouter.delete('/:id', async (req, res) => {
  try {
    const isAdmin = req.query.isAdmin === 'true';
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id }, include: { holders: true } });
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found.' });
    if (!isAdmin && heldQty(item) > 0) {
      return res.status(409).json({ ok: false, error: 'That item is held by a collector — check it in first.' });
    }
    await prisma.inventoryItem.delete({ where: { id: item.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/inventory/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete the item.' });
  }
});

// Give some (not necessarily all) of an item's remaining stock to a collector.
inventoryRouter.post('/:id/assign', async (req, res) => {
  try {
    const { collectorId, quantity, byName } = req.body as { collectorId: string; quantity: number; byName?: string };
    if (!collectorId || !(quantity > 0)) return res.status(400).json({ ok: false, error: 'A collector and a positive quantity are required.' });

    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id }, include: inventoryItemInclude });
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found.' });
    const available = availableQty(item);
    if (quantity > available) return res.status(409).json({ ok: false, error: `Only ${available} of "${item.name}" left in stock.` });

    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const collectorName = users.find(u => u.id === collectorId)?.name || '';

    await prisma.$transaction(async (tx) => {
      const existing = item.holders.find(h => h.collectorId === collectorId);
      if (existing) {
        await tx.inventoryHolder.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } });
      } else {
        await tx.inventoryHolder.create({ data: { itemId: item.id, collectorId, quantity } });
      }
      await tx.inventoryLog.create({
        data: {
          itemId: item.id, itemName: item.name, itemCode: item.itemId, activity: 'Check Out',
          personId: collectorId, personName: collectorName, quantity, ok: null, note: '',
          at: nowIso(), createdBy: byName || 'Admin',
        },
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { updatedAt: nowIso() } });
    });
    res.json({ ok: true, item: await loadItem(item.id) });
  } catch (err) {
    console.error('POST /api/inventory/:id/assign failed:', err);
    res.status(500).json({ ok: false, error: 'Could not assign the item. Nothing was changed.' });
  }
});

// Check some or all of one collector's held quantity back in. A problem
// check-in pulls those units into a Flagged issue instead of tainting the
// whole item — the rest stays fine.
inventoryRouter.post('/:id/return', async (req, res) => {
  try {
    const { collectorId, quantity, ok, note, byName } = req.body as {
      collectorId: string; quantity: number; ok: boolean; note: string; byName: string;
    };
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id }, include: inventoryItemInclude });
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found.' });
    const holder = item.holders.find(h => h.collectorId === collectorId);
    if (!holder) return res.status(409).json({ ok: false, error: 'That collector no longer holds this item.' });
    const qty = Math.min(quantity, holder.quantity);
    if (qty <= 0) return res.status(400).json({ ok: false, error: 'Quantity must be positive.' });

    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const collectorName = users.find(u => u.id === collectorId)?.name || '';

    await prisma.$transaction(async (tx) => {
      if (qty >= holder.quantity) await tx.inventoryHolder.delete({ where: { id: holder.id } });
      else await tx.inventoryHolder.update({ where: { id: holder.id }, data: { quantity: holder.quantity - qty } });

      const at = nowIso();
      await tx.returnRecord.create({
        data: {
          itemId: item.id, date: at, ok, note: ok ? '' : (note || '').trim(),
          byName: byName || 'Admin', fromCollectorId: collectorId, fromCollectorName: collectorName, quantity: qty,
        },
      });
      await tx.inventoryLog.create({
        data: {
          itemId: item.id, itemName: item.name, itemCode: item.itemId, activity: 'Check In',
          personId: collectorId, personName: collectorName, quantity: qty, ok, note: ok ? '' : (note || '').trim(),
          at, createdBy: byName || 'Admin',
        },
      });
      if (!ok) {
        await tx.inventoryIssue.create({
          data: {
            id: uid('iss'), itemId: item.id, condition: 'Flagged', quantity: qty, note: (note || '').trim(),
            reportedAt: nowIso(), reportedByCollectorId: collectorId, reportedByCollectorName: collectorName,
          },
        });
      }
      await tx.inventoryItem.update({ where: { id: item.id }, data: { updatedAt: nowIso() } });
    });
    res.json({ ok: true, item: await loadItem(item.id) });
  } catch (err) {
    console.error('POST /api/inventory/:id/return failed:', err);
    res.status(500).json({ ok: false, error: 'Could not check in the item. Nothing was changed.' });
  }
});

// Full check-in/check-out history across every item, newest first — backs
// the Inventory "History" tab and its CSV export.
inventoryRouter.get('/logs', async (_req, res) => {
  try {
    const logs = await prisma.inventoryLog.findMany({ orderBy: { at: 'desc' } });
    res.json({ ok: true, logs: logs.map(toInventoryLog) });
  } catch (err) {
    console.error('GET /api/inventory/logs failed:', err);
    res.status(500).json({ ok: false, error: 'Could not load the history.' });
  }
});

// An admin correcting a log entry after the fact (wrong time, wrong person,
// typo in the note, etc.) — this only edits the log row itself, it does not
// replay/undo the stock movement that already happened.
inventoryRouter.patch('/logs/:id', async (req, res) => {
  try {
    const { at, activity, personName, quantity, ok, note, editedBy } = req.body as {
      at?: string; activity?: 'Check In' | 'Check Out'; personName?: string; quantity?: number; ok?: boolean | null; note?: string; editedBy?: string;
    };
    const existing = await prisma.inventoryLog.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: 'Log entry not found.' });
    const log = await prisma.inventoryLog.update({
      where: { id: req.params.id },
      data: {
        ...(at !== undefined ? { at } : {}),
        ...(activity !== undefined ? { activity } : {}),
        ...(personName !== undefined ? { personName } : {}),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(ok !== undefined ? { ok } : {}),
        ...(note !== undefined ? { note } : {}),
        editedAt: nowIso(), editedBy: editedBy || 'Admin',
      },
    });
    res.json({ ok: true, log: toInventoryLog(log) });
  } catch (err) {
    console.error('PATCH /api/inventory/logs/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not update the log entry.' });
  }
});

// Pull units out of circulation into a Flagged/Damaged/Lost bucket — from
// free stock, or straight out of a specific holder's hands.
inventoryRouter.post('/:id/issues', async (req, res) => {
  try {
    const { condition, quantity, note, sourceCollectorId } = req.body as {
      condition: 'Flagged' | 'Damaged' | 'Lost'; quantity: number; note: string; sourceCollectorId: string | null;
    };
    if (!(quantity > 0)) return res.status(400).json({ ok: false, error: 'Quantity must be positive.' });
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id }, include: inventoryItemInclude });
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found.' });

    let reportedByCollectorName: string | undefined;
    await prisma.$transaction(async (tx) => {
      if (sourceCollectorId) {
        const holder = item.holders.find(h => h.collectorId === sourceCollectorId);
        if (!holder || quantity > holder.quantity) throw new Error('BAD_SOURCE');
        const users = await tx.user.findMany({ select: { id: true, name: true } });
        reportedByCollectorName = users.find(u => u.id === sourceCollectorId)?.name;
        if (quantity >= holder.quantity) await tx.inventoryHolder.delete({ where: { id: holder.id } });
        else await tx.inventoryHolder.update({ where: { id: holder.id }, data: { quantity: holder.quantity - quantity } });
      } else if (quantity > availableQty(item)) {
        throw new Error('OVER_AVAILABLE');
      }
      await tx.inventoryIssue.create({
        data: {
          id: uid('iss'), itemId: item.id, condition, quantity, note: (note || '').trim(),
          reportedAt: nowIso(), reportedByCollectorId: sourceCollectorId || null, reportedByCollectorName: reportedByCollectorName || null,
        },
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { updatedAt: nowIso() } });
    });
    res.json({ ok: true, item: await loadItem(item.id) });
  } catch (err: any) {
    if (err?.message === 'BAD_SOURCE') return res.status(409).json({ ok: false, error: 'That collector no longer holds enough of this item.' });
    if (err?.message === 'OVER_AVAILABLE') return res.status(409).json({ ok: false, error: 'Not enough in stock to report.' });
    console.error('POST /api/inventory/:id/issues failed:', err);
    res.status(500).json({ ok: false, error: 'Could not report the issue. Nothing was changed.' });
  }
});

// Resolve a reported issue: clear it back to stock, or reclassify a pending
// Flagged issue into a confirmed Damaged/Lost outcome. Either way, the
// original report moves into resolvedIssues rather than disappearing.
inventoryRouter.post('/:id/issues/:issueId/resolve', async (req, res) => {
  try {
    const { action, condition, note, resolvedByName } = req.body as {
      action: 'clear' | 'reclassify'; condition?: 'Damaged' | 'Lost'; note?: string; resolvedByName: string;
    };
    const issue = await prisma.inventoryIssue.findUnique({ where: { id: req.params.issueId } });
    if (!issue || issue.itemId !== req.params.id) return res.status(404).json({ ok: false, error: 'Issue not found.' });

    await prisma.$transaction(async (tx) => {
      await tx.inventoryIssue.delete({ where: { id: issue.id } });
      await tx.resolvedIssue.create({
        data: {
          id: uid('res'), itemId: issue.itemId, condition: issue.condition, quantity: issue.quantity,
          note: issue.note, reportedAt: issue.reportedAt,
          reportedByCollectorId: issue.reportedByCollectorId, reportedByCollectorName: issue.reportedByCollectorName,
          outcome: action === 'clear' ? 'Cleared' : condition!,
          resolvedAt: nowIso(), resolvedByName: resolvedByName || 'Admin',
        },
      });
      if (action === 'reclassify') {
        await tx.inventoryIssue.create({
          data: {
            id: uid('iss'), itemId: issue.itemId, condition: condition!, quantity: issue.quantity,
            note: (note || '').trim() || issue.note, reportedAt: nowIso(),
            reportedByCollectorId: issue.reportedByCollectorId, reportedByCollectorName: issue.reportedByCollectorName,
          },
        });
      }
      await tx.inventoryItem.update({ where: { id: issue.itemId }, data: { updatedAt: nowIso() } });
    });
    res.json({ ok: true, item: await loadItem(issue.itemId) });
  } catch (err) {
    console.error('POST /api/inventory/:id/issues/:issueId/resolve failed:', err);
    res.status(500).json({ ok: false, error: 'Could not resolve the issue. Nothing was changed.' });
  }
});
