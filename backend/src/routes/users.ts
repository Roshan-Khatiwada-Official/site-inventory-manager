import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toUser, inventoryItemInclude, toInventoryItem } from '../lib/mappers.js';
import { ROLE_TO_DB } from '../lib/enums.js';
import { hashPassword } from '../lib/auth.js';
import { nowIso, todayStr } from '../lib/ids.js';
import type { UserAccount } from '../types.js';

export const usersRouter = Router();

usersRouter.post('/', async (req, res) => {
  try {
    const draft = req.body as UserAccount;
    if (!draft?.id || !draft.loginId || !draft.name) {
      return res.status(400).json({ ok: false, error: 'Login ID and name are required.' });
    }
    const existing = await prisma.user.findUnique({ where: { id: draft.id } });
    if (!existing && !draft.password) return res.status(400).json({ ok: false, error: 'Password is required for a new login.' });

    const common = {
      loginId: draft.loginId, name: draft.name, role: ROLE_TO_DB[draft.role], status: draft.status,
      phone: draft.phone, email: draft.email, address: draft.address, notes: draft.notes, updatedAt: nowIso(),
    };
    if (draft.password) {
      const password = await hashPassword(draft.password);
      await prisma.user.upsert({
        where: { id: draft.id },
        create: { id: draft.id, password, createdAt: todayStr(), ...common },
        update: { password, ...common },
      });
    } else {
      await prisma.user.update({ where: { id: draft.id }, data: common });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: draft.id } });
    res.json({ ok: true, user: toUser(user) });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ ok: false, error: 'That Login ID is already taken.' });
    console.error('POST /api/users failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save the login. Nothing was changed.' });
  }
});

// Deleting a user cascades their inventory holdings (schema: onDelete
// Cascade) — equivalent to returning their kit to stock — and their
// assignments/requests, same as the app always did.
usersRouter.delete('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ ok: false, error: 'Login not found.' });
    await prisma.user.delete({ where: { id: user.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete the login.' });
  }
});

// Set exactly which items (and how many of each) a collector holds. Items
// they hold now but not in `picks` go back to stock; picked items are set
// to the requested quantity, capped by what's actually available.
usersRouter.post('/:id/kit', async (req, res) => {
  try {
    const collectorId = req.params.id;
    const picks = req.body?.picks as { itemId: string; quantity: number }[];
    const collector = await prisma.user.findUnique({ where: { id: collectorId } });
    if (!collector) return res.status(404).json({ ok: false, error: 'Login not found.' });

    await prisma.$transaction(async (tx) => {
      for (const pick of picks) {
        const item = await tx.inventoryItem.findUnique({ where: { id: pick.itemId }, include: { holders: true, issues: true } });
        if (!item) continue;
        const existing = item.holders.find(h => h.collectorId === collectorId);
        const held = item.holders.reduce((s, h) => s + h.quantity, 0);
        const reported = item.issues.reduce((s, x) => s + x.quantity, 0);
        const available = Math.max(0, item.quantity - held - reported);
        const cap = available + (existing?.quantity || 0);
        const qty = Math.max(1, Math.min(pick.quantity, cap));
        if (existing) await tx.inventoryHolder.update({ where: { id: existing.id }, data: { quantity: qty } });
        else await tx.inventoryHolder.create({ data: { itemId: item.id, collectorId, quantity: qty } });
        await tx.inventoryItem.update({ where: { id: item.id }, data: { updatedAt: nowIso() } });
      }
      const pickedIds = new Set(picks.map(p => p.itemId));
      const currentHoldings = await tx.inventoryHolder.findMany({ where: { collectorId }, select: { id: true, itemId: true } });
      const toRemove = currentHoldings.filter(h => !pickedIds.has(h.itemId));
      if (toRemove.length) {
        await tx.inventoryHolder.deleteMany({ where: { id: { in: toRemove.map(h => h.id) } } });
        await tx.inventoryItem.updateMany({ where: { id: { in: toRemove.map(h => h.itemId) } }, data: { updatedAt: nowIso() } });
      }
    });

    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const nameById = new Map(users.map(u => [u.id, u.name]));
    const items = await prisma.inventoryItem.findMany({ include: inventoryItemInclude });
    res.json({ ok: true, inventory: items.map(i => toInventoryItem(i, nameById)) });
  } catch (err) {
    console.error('POST /api/users/:id/kit failed:', err);
    res.status(500).json({ ok: false, error: "Could not update this collector's equipment." });
  }
});
