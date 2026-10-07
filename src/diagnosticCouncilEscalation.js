'use strict';

const crypto = require('node:crypto');
const { MultiAiOrchestrator } = require('./multiAiOrchestrator');
const { createConfiguredAdapters } = require('./aiProviderAdapters');
const { FREE_PROVIDER_IDS, redact } = require('./aiProviderRegistry');

const MAX_CONTEXT_BYTES = 48 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function bounded(value, max = MAX_CONTEXT_BYTES) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? text.slice(0, max) + '\n[truncated]' : text;
}

function struggleReasons({
  phase,
  report = null,
  repairResult = null,
  attempt = 1,
  repeatedFailureCount = 0,
  regression = false,
} = {}) {
  const reasons = [];
  if (phase === 'diagnostic') {
    if (report?.unclassifiedFailure === true) reasons.push('unclassified-failure');
    if (Array.isArray(report?.diagnoses) && report.diagnoses.length > 1) reasons.push('ambiguous-diagnosis');
    if (Array.isArray(report?.diagnoses) && report.diagnoses.length === 0 && report?.conclusion === 'failure') reasons.push('no-diagnosis');
  }
  if (phase === 'repair') {
    const state = String(repairResult?.state || '').toLowerCase();
    if (['failed','rolled-back','timed-out','no-change','blocked'].includes(state)) reasons.push(`repair-${state}`);
  }
  if (Number(attempt) >= 2) reasons.push('repeated-repair-attempt');
  if (Number(repeatedFailureCount) >= 2) reasons.push('recurrent-failure');
  if (regression === true) reasons.push('repair-regression');
  return [...new Set(reasons)];
}

function advisoryPrompt({ phase, projectId, boundary, failureCode = null, report = null, repairResult = null, reasons, context = null }) {
  return [
    'You are advisory only. You do not have repair, verification, promotion, custody, governance, or release authority.',
    'The Crucible is struggling with a bounded diagnostic or repair task.',
    'Return concise candidate explanations, disconfirming evidence to seek, bounded experiments/tests, and repair ideas.',
    'Do not declare a new CRU code, do not claim an existing code is proven, and do not claim a repair is verified.',
    'Preserve uncertainty and disagreement.',
    `Phase: ${phase}`,
    `Project: ${projectId}`,
    `Boundary: ${boundary}`,
    `Known CRU code: ${failureCode || 'none'}`,
    `Struggle reasons: ${reasons.join(', ')}`,
    report ? `Diagnostic report:\n${bounded(report)}` : '',
    repairResult ? `Repair result:\n${bounded(repairResult)}` : '',
    context ? `Additional bounded context:\n${bounded(context)}` : '',
  ].filter(Boolean).join('\n\n');
}

async function localCrucibleConsult({ taskId, prompt, env = process.env, orchestratorFactory = null } = {}) {
  const { adapters, unconfigured } = createConfiguredAdapters({ env });
  for (const id of [...adapters.keys()]) if (!FREE_PROVIDER_IDS.includes(id)) adapters.delete(id);
  if (!adapters.size) {
    return {
      available: false,
      source: 'crucible-local-council',
      reason: 'no-free-local-provider-configured',
      unconfigured,
      authorizationGranted: false,
    };
  }
  const orchestrator = orchestratorFactory ? orchestratorFactory() : new MultiAiOrchestrator({ env });
  for (const [id, adapter] of adapters) orchestrator.register(id, adapter);
  const distribution = await orchestrator.distribute({
    taskId,
    prompt,
    providers: [...adapters.keys()],
    purpose: 'struggling Crucible diagnostic/repair consultation',
  });
  const corroboration = orchestrator.corroborate(distribution);
  return {
    available: true,
    source: 'crucible-local-council',
    distribution,
    corroboration,
    authorizationGranted: false,
  };
}

async function aiCollaborationConsult({
  taskId,
  prompt,
  phase,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 90_000,
} = {}) {
  const baseUrl = String(env.AI_COLLABORATION_BASE_URL || '').trim().replace(/\/$/, '');
  const token = String(env.AI_COLLABORATION_BEARER_TOKEN || '').trim();
  if (!baseUrl || !token) {
    return {
      available: false,
      source: 'ai-collaboration-council',
      reason: !baseUrl ? 'AI_COLLABORATION_BASE_URL-not-configured' : 'AI_COLLABORATION_BEARER_TOKEN-not-configured',
      authorizationGranted: false,
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('AI Collaboration council requires fetch.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: phase === 'repair' ? 'nexus-review' : 'nexus-reasoning',
        messages: [
          { role: 'system', content: 'Act as an advisory multi-provider council. Preserve provider disagreement and grant no execution authorization.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) {
      return {
        available: false,
        source: 'ai-collaboration-council',
        reason: `HTTP ${response.status}: ${redact(raw, env).slice(0, 1000)}`,
        authorizationGranted: false,
      };
    }
    if (payload?.ai_collaboration?.authorizationGranted === true || payload?.authorizationGranted === true) {
      throw new Error('AI Collaboration violated the authority boundary by granting authorization.');
    }
    return {
      available: true,
      source: 'ai-collaboration-council',
      taskId,
      text: redact(payload?.choices?.[0]?.message?.content || '', env),
      council: payload?.ai_collaboration || null,
      authorizationGranted: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function createDiagnosticCouncilEscalation(options = {}) {
  const env = options.env || process.env;
  const localConsult = options.localConsult || ((input) => localCrucibleConsult({ ...input, env, orchestratorFactory: options.orchestratorFactory }));
  const externalConsult = options.externalConsult || ((input) => aiCollaborationConsult({ ...input, env, fetchImpl: options.fetchImpl || globalThis.fetch, timeoutMs: options.timeoutMs }));
  return {
    async consultWhenStruggling(input = {}) {
      const reasons = struggleReasons(input);
      if (!reasons.length) return {
        invoked: false,
        reasons: [],
        consultations: [],
        authorizationGranted: false,
      };
      const prompt = advisoryPrompt({ ...input, reasons });
      const taskId = input.taskId || `crucible-struggle-${sha256({ phase: input.phase, projectId: input.projectId, boundary: input.boundary, reasons, prompt }).slice(0, 24)}`;
      const settled = await Promise.allSettled([
        externalConsult({ taskId, prompt, phase: input.phase }),
        localConsult({ taskId, prompt, phase: input.phase }),
      ]);
      const consultations = settled.map((result, index) => {
        const source = index === 0 ? 'ai-collaboration-council' : 'crucible-local-council';
        if (result.status !== 'fulfilled') return {
          available: false,
          source,
          reason: redact(result.reason?.message || String(result.reason), env),
          authorizationGranted: false,
        };
        if (result.value?.authorizationGranted === true || result.value?.promotionAuthorized === true || result.value?.ownerApproved === true) return {
          available: false,
          source: result.value?.source || source,
          reason: 'authority-boundary-violation',
          authorizationGranted: false,
        };
        return { ...result.value, authorizationGranted: false };
      });
      return {
        invoked: true,
        taskId,
        reasons,
        promptSha256: sha256(prompt),
        consultations,
        authorizationGranted: false,
      };
    },
  };
}

module.exports = {
  MAX_CONTEXT_BYTES,
  sha256,
  struggleReasons,
  advisoryPrompt,
  localCrucibleConsult,
  aiCollaborationConsult,
  createDiagnosticCouncilEscalation,
};
