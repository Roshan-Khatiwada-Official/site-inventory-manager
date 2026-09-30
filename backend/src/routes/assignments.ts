import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toAssignment } from '../lib/mappers.js';
import { nowIso, todayStr, uid } from '../lib/ids.js';
import type { Assignment, CollectionSession } from '../types.js';

export const assignmentsRouter = Router();

async function loadAssignment(id: string) {
  const a = await prisma.assignment.findUnique({ where: { id }, include: { sessions: true } });
  return a ? toAssignment(a) : null;
}
function hoursSum(sessions: { hours: number }[]) {
  return sessions.reduce((s, x) => s + (Number(x.hours) || 0), 0);
}

// Sites never lock to one collector — many people may work the same site,
// and assignments don't change a site's approval status. Names are
// denormalised server-side from the actual Site/User rows, not trusted from
// the client.
assignmentsRouter.post('/', async (req, res) => {
  try {
    const draft = req.body.assignment as Assignment;
    const assignedById = req.body.assignedById as string;
    const assignedByName = req.body.assignedByName as string;
    if (!draft?.id || !draft.siteId || !draft.collectorId) {
      return res.status(400).json({ ok: false, error: 'Site and collector are required.' });
    }
    const [site, collector] = await Promise.all([
      prisma.site.findUnique({ where: { id: draft.siteId } }),
      prisma.user.findUnique({ where: { id: draft.collectorId } }),
    ]);
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found.' });
    if (!collector) return res.status(404).json({ ok: false, error: 'Collector not found.' });

    const common = {
      siteId: site.id, siteName: site.name, collectorId: collector.id, collectorName: collector.name,
      assignedById, assignedByName, status: draft.status === 'Completed' ? 'Completed' as const : 'Active' as const,
      hoursLogged: draft.hoursLogged || 0, updatedAt: nowIso(),
    };
    await prisma.assignment.upsert({
      where: { id: draft.id },
      create: { id: draft.id, createdAt: todayStr(), ...common },
      update: common,
    });
    res.json({ ok: true, assignment: await loadAssignment(draft.id) });
  } catch (err) {
    console.error('POST /api/assignments failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save the assignment. Nothing was changed.' });
  }
});

assignmentsRouter.delete('/:id', async (req, res) => {
  try {
    const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!a) return res.status(404).json({ ok: false, error: 'Assignment not found.' });
    await prisma.assignment.delete({ where: { id: a.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/assignments/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete the assignment.' });
  }
});

// Log hours (per camera/task) against a site still being worked — stays Active.
assignmentsRouter.post('/:id/sessions', async (req, res) => {
  try {
    const rows = req.body.sessions as Omit<CollectionSession, 'id'>[];
    const a = await prisma.assignment.findUnique({ where: { id: req.params.id }, include: { sessions: true } });
    if (!a) return res.status(404).json({ ok: false, error: 'Assignment not found.' });

    await prisma.$transaction(async (tx) => {
      await tx.collectionSession.createMany({
        data: rows.map(r => ({
          id: uid('ses'), assignmentId: a.id, date: r.date, hours: r.hours,
          cameraId: r.cameraId ?? null, cameraName: r.cameraName ?? null, cameraItemId: r.cameraItemId ?? null,
          task: r.task ?? null, note: r.note ?? null,
        })),
      });
      const all = await tx.collectionSession.findMany({ where: { assignmentId: a.id } });
      await tx.assignment.update({ where: { id: a.id }, data: { hoursLogged: hoursSum(all), updatedAt: nowIso() } });
    });
    res.json({ ok: true, assignment: await loadAssignment(a.id) });
  } catch (err) {
    console.error('POST /api/assignments/:id/sessions failed:', err);
    res.status(500).json({ ok: false, error: 'Could not submit hours. Nothing was changed.' });
  }
});

// Optionally log remaining hours, then mark the site done.
assignmentsRouter.post('/:id/finish', async (req, res) => {
  try {
    const rows = (req.body.sessions as Omit<CollectionSession, 'id'>[]) || [];
    const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!a) return res.status(404).json({ ok: false, error: 'Assignment not found.' });

    await prisma.$transaction(async (tx) => {
      if (rows.length) {
        await tx.collectionSession.createMany({
          data: rows.map(r => ({
            id: uid('ses'), assignmentId: a.id, date: r.date, hours: r.hours,
            cameraId: r.cameraId ?? null, cameraName: r.cameraName ?? null, cameraItemId: r.cameraItemId ?? null,
            task: r.task ?? null, note: r.note ?? null,
          })),
        });
      }
      const all = await tx.collectionSession.findMany({ where: { assignmentId: a.id } });
      await tx.assignment.update({ where: { id: a.id }, data: { hoursLogged: hoursSum(all), status: 'Completed', updatedAt: nowIso() } });
    });
    res.json({ ok: true, assignment: await loadAssignment(a.id) });
  } catch (err) {
    console.error('POST /api/assignments/:id/finish failed:', err);
    res.status(500).json({ ok: false, error: 'Could not finish the assignment. Nothing was changed.' });
  }
});

assignmentsRouter.post('/:id/reopen', async (req, res) => {
  try {
    const a = await prisma.assignment.update({
      where: { id: req.params.id }, data: { status: 'Active', updatedAt: nowIso() }, include: { sessions: true },
    });
    res.json({ ok: true, assignment: toAssignment(a) });
  } catch (err) {
    console.error('POST /api/assignments/:id/reopen failed:', err);
    res.status(500).json({ ok: false, error: 'Could not reopen the assignment.' });
  }
});

// A collector fixing their own mistake — locked once admin has verified it.
assignmentsRouter.patch('/:id/sessions/:sessionId', async (req, res) => {
  try {
    const updates = req.body as Partial<Pick<CollectionSession, 'date' | 'hours' | 'task' | 'cameraId' | 'cameraName' | 'cameraItemId'>>;
    const session = await prisma.collectionSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.assignmentId !== req.params.id) return res.status(404).json({ ok: false, error: 'Entry not found.' });
    if (session.actualHours != null) return res.status(409).json({ ok: false, error: 'This entry has already been verified and can no longer be edited.' });

    await prisma.$transaction(async (tx) => {
      await tx.collectionSession.update({ where: { id: session.id }, data: updates });
      const all = await tx.collectionSession.findMany({ where: { assignmentId: req.params.id } });
      await tx.assignment.update({ where: { id: req.params.id }, data: { hoursLogged: hoursSum(all), updatedAt: nowIso() } });
    });
    res.json({ ok: true, assignment: await loadAssignment(req.params.id) });
  } catch (err) {
    console.error('PATCH /api/assignments/:id/sessions/:sessionId failed:', err);
    res.status(500).json({ ok: false, error: 'Could not update the entry. Nothing was changed.' });
  }
});

assignmentsRouter.delete('/:id/sessions/:sessionId', async (req, res) => {
  try {
    const session = await prisma.collectionSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.assignmentId !== req.params.id) return res.status(404).json({ ok: false, error: 'Entry not found.' });
    if (session.actualHours != null) return res.status(409).json({ ok: false, error: 'This entry has already been verified and cannot be deleted.' });

    await prisma.$transaction(async (tx) => {
      await tx.collectionSession.delete({ where: { id: session.id } });
      const all = await tx.collectionSession.findMany({ where: { assignmentId: req.params.id } });
      await tx.assignment.update({ where: { id: req.params.id }, data: { hoursLogged: hoursSum(all), updatedAt: nowIso() } });
    });
    res.json({ ok: true, assignment: await loadAssignment(req.params.id) });
  } catch (err) {
    console.error('DELETE /api/assignments/:id/sessions/:sessionId failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete the entry.' });
  }
});

// Admin verifies the actual hours collected for one logged entry.
assignmentsRouter.post('/:id/sessions/:sessionId/verify', async (req, res) => {
  try {
    const { actualHours, verifiedByName } = req.body as { actualHours: number; verifiedByName: string };
    const session = await prisma.collectionSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.assignmentId !== req.params.id) return res.status(404).json({ ok: false, error: 'Entry not found.' });

    await prisma.collectionSession.update({
      where: { id: session.id },
      data: { actualHours, verifiedByName: verifiedByName || 'Admin', verifiedAt: nowIso() },
    });
    await prisma.assignment.update({ where: { id: req.params.id }, data: { updatedAt: nowIso() } });
    res.json({ ok: true, assignment: await loadAssignment(req.params.id) });
  } catch (err) {
    console.error('POST /api/assignments/:id/sessions/:sessionId/verify failed:', err);
    res.status(500).json({ ok: false, error: 'Could not verify the entry. Nothing was changed.' });
  }
});
