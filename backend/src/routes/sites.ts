import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toAssignment, toSite } from '../lib/mappers.js';
import { SITE_STATUS_TO_DB } from '../lib/enums.js';
import { nowIso, todayStr, uid } from '../lib/ids.js';
import type { Site } from '../types.js';

export const sitesRouter = Router();

function siteCommon(s: Site) {
  return {
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
    updatedAt: nowIso(),
  };
}

// Create or update a site. If it's a fresh self-claim on an Available site
// ("I'll collect this myself"), also creates the assignment straight into
// that person's My Work — same rule the app always had.
sitesRouter.post('/', async (req, res) => {
  try {
    const draft = req.body as Site;
    if (!draft?.id || !draft.name) return res.status(400).json({ ok: false, error: 'Site id and name are required.' });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.site.findUnique({ where: { id: draft.id } });
      const common = siteCommon(draft);
      const site = existing
        ? await tx.site.update({ where: { id: draft.id }, data: common })
        : await tx.site.create({ data: { id: draft.id, createdAt: todayStr(), ...common } });

      let assignment = null;
      const selfAssigning = draft.reservedById && draft.status === 'Available';
      if (selfAssigning) {
        const already = await tx.assignment.findFirst({ where: { siteId: site.id, collectorId: draft.reservedById! } });
        if (!already) {
          assignment = await tx.assignment.create({
            data: {
              id: uid('asg'),
              siteId: site.id,
              siteName: site.name,
              collectorId: draft.reservedById!,
              collectorName: draft.reservedByName,
              assignedById: draft.reservedById!,
              assignedByName: draft.reservedByName,
              status: 'Active',
              hoursLogged: 0,
              createdAt: todayStr(),
              updatedAt: nowIso(),
            },
            include: { sessions: true },
          });
        }
      }
      return { site, assignment };
    });

    res.json({
      ok: true,
      site: toSite(result.site),
      assignment: result.assignment ? toAssignment(result.assignment) : null,
    });
  } catch (err) {
    console.error('POST /api/sites failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save the site. Nothing was changed.' });
  }
});

// Admin approves a pending site — becomes Available, and if the finder had
// self-claimed it, goes straight into their My Work too.
sitesRouter.post('/:id/approve', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const site = await tx.site.findUnique({ where: { id: req.params.id } });
      if (!site) throw new Error('NOT_FOUND');
      if (site.status !== 'PendingApproval') throw new Error('NOT_PENDING');

      const updated = await tx.site.update({ where: { id: site.id }, data: { status: 'Available', updatedAt: nowIso() } });

      let assignment = null;
      if (site.reservedById) {
        assignment = await tx.assignment.create({
          data: {
            id: uid('asg'),
            siteId: site.id,
            siteName: site.name,
            collectorId: site.reservedById,
            collectorName: site.reservedByName,
            assignedById: site.reservedById,
            assignedByName: site.reservedByName,
            status: 'Active',
            hoursLogged: 0,
            createdAt: todayStr(),
            updatedAt: nowIso(),
          },
          include: { sessions: true },
        });
      }
      return { site: updated, assignment };
    });
    res.json({ ok: true, site: toSite(result.site), assignment: result.assignment ? toAssignment(result.assignment) : null });
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'Site not found.' });
    if (err?.message === 'NOT_PENDING') return res.status(409).json({ ok: false, error: 'This site is no longer pending approval.' });
    console.error('POST /api/sites/:id/approve failed:', err);
    res.status(500).json({ ok: false, error: 'Could not approve the site.' });
  }
});

// A pending site that never went live — just removed, not kept around.
sitesRouter.post('/:id/reject', async (req, res) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found.' });
    if (site.status !== 'PendingApproval') return res.status(409).json({ ok: false, error: 'This site is no longer pending approval.' });
    await prisma.site.delete({ where: { id: site.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/sites/:id/reject failed:', err);
    res.status(500).json({ ok: false, error: 'Could not reject the site.' });
  }
});

sitesRouter.delete('/:id', async (req, res) => {
  try {
    const isAdmin = req.query.isAdmin === 'true';
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found.' });

    if (!isAdmin) {
      const [assignmentCount, pendingCount] = await Promise.all([
        prisma.assignment.count({ where: { siteId: site.id } }),
        prisma.siteRequest.count({ where: { siteId: site.id, status: 'Pending' } }),
      ]);
      if (assignmentCount > 0) return res.status(409).json({ ok: false, error: "This site has assignments — it can't be deleted." });
      if (pendingCount > 0) return res.status(409).json({ ok: false, error: 'This site has a pending request — decide on it first.' });
    }

    // Assignments and requests referencing this site cascade-delete in the DB.
    await prisma.site.delete({ where: { id: site.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/sites/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete the site.' });
  }
});
