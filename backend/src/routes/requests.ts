import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toAssignment, toSiteRequest } from '../lib/mappers.js';
import { nowIso, todayStr, uid } from '../lib/ids.js';

export const requestsRouter = Router();

// A collector may hold several sites at once — just no duplicate pending
// request for the same site, and no requesting a site already in their My
// Work (Active or Completed).
requestsRouter.post('/', async (req, res) => {
  try {
    const { siteId, collectorId } = req.body as { siteId: string; collectorId: string };
    const [site, collector] = await Promise.all([
      prisma.site.findUnique({ where: { id: siteId } }),
      prisma.user.findUnique({ where: { id: collectorId } }),
    ]);
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found.' });
    if (!collector) return res.status(404).json({ ok: false, error: 'Collector not found.' });

    const [existingAssignment, existingRequest] = await Promise.all([
      prisma.assignment.findFirst({ where: { siteId, collectorId } }),
      prisma.siteRequest.findFirst({ where: { siteId, collectorId, status: 'Pending' } }),
    ]);
    if (existingAssignment) return res.status(409).json({ ok: false, error: 'This site is already in your My Work.' });
    if (existingRequest) return res.status(409).json({ ok: false, error: 'You already have a pending request for this site.' });

    const request = await prisma.siteRequest.create({
      data: {
        id: uid('req'), siteId, siteName: site.name, collectorId, collectorName: collector.name,
        status: 'Pending', requestedAt: nowIso(), updatedAt: nowIso(),
      },
    });
    res.json({ ok: true, request: toSiteRequest(request) });
  } catch (err) {
    console.error('POST /api/requests failed:', err);
    res.status(500).json({ ok: false, error: 'Could not submit the request. Nothing was changed.' });
  }
});

// A collector withdrawing their own pending request.
requestsRouter.delete('/:id', async (req, res) => {
  try {
    const { collectorId } = req.body as { collectorId: string };
    const request = await prisma.siteRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== 'Pending' || request.collectorId !== collectorId) {
      return res.status(404).json({ ok: false, error: 'Request not found.' });
    }
    await prisma.siteRequest.delete({ where: { id: request.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/requests/:id failed:', err);
    res.status(500).json({ ok: false, error: 'Could not cancel the request.' });
  }
});

requestsRouter.post('/:id/decide', async (req, res) => {
  try {
    const { approve, assignedById, assignedByName } = req.body as { approve: boolean; assignedById: string; assignedByName: string };
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.siteRequest.findUnique({ where: { id: req.params.id } });
      if (!request) throw new Error('NOT_FOUND');

      const updated = await tx.siteRequest.update({
        where: { id: request.id },
        data: { status: approve ? 'Approved' : 'Rejected', decidedAt: nowIso(), updatedAt: nowIso() },
      });

      let assignment = null;
      if (approve) {
        const already = await tx.assignment.findFirst({ where: { siteId: request.siteId, collectorId: request.collectorId } });
        if (!already) {
          assignment = await tx.assignment.create({
            data: {
              id: uid('asg'), siteId: request.siteId, siteName: request.siteName,
              collectorId: request.collectorId, collectorName: request.collectorName,
              assignedById, assignedByName, status: 'Active', hoursLogged: 0,
              createdAt: todayStr(), updatedAt: nowIso(),
            },
            include: { sessions: true },
          });
        }
      }
      return { request: updated, assignment };
    });
    res.json({
      ok: true,
      request: toSiteRequest(result.request),
      assignment: result.assignment ? toAssignment(result.assignment) : null,
    });
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'Request not found.' });
    console.error('POST /api/requests/:id/decide failed:', err);
    res.status(500).json({ ok: false, error: 'Could not decide the request. Nothing was changed.' });
  }
});
