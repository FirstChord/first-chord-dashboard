/** @fileoverview Injectable human-triggered resolution pilot, with fresh source checks and metadata-only proposal storage. */
import { randomUUID } from 'node:crypto';
import { buildProposalRecord } from './proposal-helpers.mjs';
import { isJevConfigured } from './jev-provider.mjs';
import { RESOLUTION_LANE, RESOLUTION_VERSION, RESOLUTION_LABELS, RESOLUTION_QUESTION,
  projectResolutionContext, publicResolutionProposal, resolutionDecision } from './incoming-resolution-helpers.mjs';

export function isIncomingResolutionConfigured(env = process.env) {
  return env.ADMIN_AI_INBOX_RESOLUTION_ENABLED === 'true' && isJevConfigured(env);
}

export function createIncomingResolutionService({ readInbox, readProposals, readStudents, saveProposal, evaluate,
  env = process.env, now = () => new Date(), uuid = randomUUID }) {
  async function sources(force = false) {
    const [rows, proposals, students] = await Promise.all([readInbox({ force }), readProposals({ force }), readStudents()]);
    return { rows, proposals, students };
  }
  async function list() {
    const { rows, proposals, students } = await sources();
    const byIncomingId = {};
    for (const proposal of [...proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (proposal.lane !== RESOLUTION_LANE) continue;
      let context;
      try { context = projectResolutionContext(rows, proposal.linkedId, { students, now: now() }); } catch { continue; }
      const key = context.cluster.lead.incomingId;
      if (byIncomingId[key]) continue;
      const publicProposal = publicResolutionProposal(proposal, context, now());
      if (publicProposal) byIncomingId[key] = publicProposal;
    }
    return { byIncomingId, available: isIncomingResolutionConfigured(env) };
  }
  async function assess({ incomingId, actorEmail = '' }) {
    if (!isIncomingResolutionConfigured(env)) throw new Error('Reply checking is not connected yet');
    const first = await sources(true);
    const context = projectResolutionContext(first.rows, incomingId, { students: first.students, now: now() });
    let label = 'unclear', modelMeta = {};
    if (!context.guard) {
      const result = await evaluate({ state: context.state, questions: { resolution: RESOLUTION_QUESTION } });
      label = resolutionDecision(result.answers.resolution);
      modelMeta = { model: result.model, confidence: result.answers.resolution.confidence,
        probabilities: result.answers.resolution.probabilities, usage: result.usage, latencyMs: result.latencyMs };
    }
    const fresh = await sources(true);
    const current = projectResolutionContext(fresh.rows, incomingId, { students: fresh.students, now: now() });
    if (current.sourceHash !== context.sourceHash) throw new Error('The conversation changed. Check the latest replies first');
    const proposal = buildProposalRecord({ proposalId: `res_${uuid()}`, lane: RESOLUTION_LANE,
      linkedId: current.cluster.lead.incomingId, createdBy: actorEmail, proposalBody: label, now: now(),
      evidence: { version: RESOLUTION_VERSION, sourceHash: context.sourceHash, queueHash: context.queueHash,
        guard: context.guard, ...modelMeta } });
    await saveProposal(proposal);
    return { proposal: publicResolutionProposal(proposal, current, now()), incomingId: proposal.linkedId };
  }
  async function feedback({ proposalId, label, actorEmail = '' }) {
    if (!Object.hasOwn(RESOLUTION_LABELS, label)) throw new Error('Choose a valid assessment');
    const { rows, proposals, students } = await sources(true);
    const proposal = proposals.find(row => row.proposalId === proposalId && row.lane === RESOLUTION_LANE);
    if (!proposal || proposal.status !== 'proposed') throw new Error('This assessment has already been reviewed or is missing');
    const context = projectResolutionContext(rows, proposal.linkedId, { students, now: now() });
    if (!publicResolutionProposal(proposal, context, now())) throw new Error('The assessment is stale. Check the latest replies first');
    const decided = { ...proposal, status: label === proposal.proposalBody ? 'approved' : 'rejected',
      appliedBody: label, decidedBy: actorEmail, decidedAt: now().toISOString() };
    await saveProposal(decided);
    return { proposal: publicResolutionProposal(decided, context, now()), incomingId: context.cluster.lead.incomingId };
  }
  return { list, assess, feedback };
}
