import { defaultAuthService } from '../lib/runtime/auth-service.js';
import { defaultProfileService } from '../lib/runtime/profile-service.js';
import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';
import { run6StagePipeline } from '../lib/agent/multi-agent-pipeline.js';
import { authRequiredResponse, requireAuth } from '../lib/http/auth-context.js';

export async function handleChatRequest(req, { env, runPipeline = run6StagePipeline } = {}) {
  if (env?.DB && env?.AUTH_KV) return handleCloudflareChatRequest(req, { env, runPipeline });
  return handleLegacyChatRequest(req);
}

export async function handleGuestChatRequest(req, { runPipeline = run6StagePipeline } = {}) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => null);
  const profile = normalizeGuestProfile(body?.profile);
  if (!profile) return json({ error: 'INVALID_GUEST_PROFILE' }, 400);

  const question = String(body?.question || '').trim();
  const previousReport = typeof body?.previousReport === 'string' ? body.previousReport : null;
  const sessionId = `guest-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      sendEvent({ type: 'session_start', sessionId, conversationId: sessionId, profileName: profile.name });
      const startedAt = Date.now();
      try {
        const result = await runPipeline({ profile, question, previousReport, onEvent: sendEvent });
        sendEvent({ type: 'evidence', evidencePayload: result.evidencePayload });
        sendEvent({ type: 'conclusion', text: result.summary || '解析已完成，参阅右侧报告。', conversationId: sessionId, serviceDegraded: result.service?.degraded === true });
        sendEvent({ type: 'report', markdown: result.report || '', conversationId: sessionId, reportVersion: 1 });
        sendEvent({ type: 'session_end', duration: Date.now() - startedAt, creditsUsed: 0, conversationId: sessionId, reportVersion: 1, serviceDegraded: result.service?.degraded === true });
      } catch (error) {
        console.error('Guest 6-Stage Pipeline execution error:', error);
        sendEvent({ type: 'error', message: error.message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function normalizeGuestProfile(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name || '').trim();
  const date = String(input.date || '').trim();
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id: typeof input.id === 'string' ? input.id : 'guest-profile',
    name: name.slice(0, 80),
    date,
    time: /^\d{2}:\d{2}$/.test(String(input.time || '')) ? String(input.time) : '12:00',
    gender: input.gender === 'female' ? 'female' : 'male',
    timeKnown: input.timeKnown !== false,
    birthplace: String(input.birthplace || '').trim().slice(0, 120),
  };
}

async function handleLegacyChatRequest(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { wallet, profileId, question = '', previousReport = null } = body;

  if (!wallet) {
    return new Response(JSON.stringify({ error: 'Missing wallet' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Profile 检索顺序：1. body.profile -> 2. profileId in ProfileService -> 3. masterProfile in AuthService -> 4. default profile for default wallet
  let profile = body.profile;
  if (!profile && profileId) {
    const userStore = defaultProfileService.getProfiles(wallet);
    profile = userStore.profiles.find(p => p.id === profileId);
  }
  if (!profile) {
    const account = defaultAuthService.getAccount(wallet);
    profile = account?.masterProfile;
  }
  if (!profile && wallet === 'default') {
    profile = defaultProfileService.getActiveProfile(wallet);
  }
  if (!profile) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const title = question ? `解答: ${question.slice(0, 12)}...` : `八字运势解读`;
      const sessionId = defaultSessionHistoryService.addSession(wallet, {
        profileId: profile.id || 'default',
        profileName: profile.name,
        title,
        topic: 'overview',
        summary: ''
      });

      sendEvent({ type: 'session_start', sessionId, profileName: profile.name });

      const startTime = Date.now();

      try {
        const pipelineResult = await run6StagePipeline({
          profile,
          question,
          previousReport,
          onEvent: sendEvent
        });

        // 供后续报告解释与客户端核对使用；载荷只含本次实际计算出的盘面事实。
        sendEvent({ type: 'evidence', evidencePayload: pipelineResult.evidencePayload });

        defaultSessionHistoryService.updateSession(wallet, sessionId, {
          question,
          topic: pipelineResult.topics?.[0]?.topic || 'overview',
          summary: pipelineResult.summary || '',
          reportMarkdown: pipelineResult.report || '',
        });

        // 终结事件，包含对话区核心结论
        sendEvent({
          type: 'conclusion',
          text: pipelineResult.summary || '解析已完成，参阅右侧报告。',
          serviceDegraded: pipelineResult.service?.degraded === true,
        });

        sendEvent({
          type: 'report',
          markdown: pipelineResult.report
        });

        const duration = Date.now() - startTime;
        sendEvent({
          type: 'session_end',
          duration,
          creditsUsed: 0,
          serviceDegraded: pipelineResult.service?.degraded === true,
        });
      } catch (err) {
        console.error('6-Stage Pipeline execution error:', err);
        sendEvent({ type: 'error', message: err.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

async function handleCloudflareChatRequest(req, { env, runPipeline }) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const auth = await requireAuth(req, env);
  if (!auth) return authRequiredResponse();
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'INVALID_JSON' }, 400);
  const question = String(body.question || '').trim();
  const requestId = String(body.requestId || crypto.randomUUID()).trim();

  const replay = await auth.repositories.turnRequests.findByRequestId(auth.userId, requestId);
  if (replay) {
    const conversation = await auth.repositories.conversations.findById(auth.userId, replay.conversationId);
    if (!conversation) return json({ error: 'SESSION_NOT_FOUND' }, 404);
    const report = replay.reportVersionNumber === null
      ? null
      : await auth.repositories.reportVersions.findByVersion(auth.userId, conversation.id, replay.reportVersionNumber);
    return streamCompletedConversation(conversation, report, 0);
  }

  const profile = await auth.repositories.profiles.findById(auth.userId, body.profileId);
  if (!profile) return json({ error: 'PROFILE_NOT_FOUND' }, 404);
  let conversation = null;
  if (body.conversationId) {
    conversation = await auth.repositories.conversations.findById(auth.userId, body.conversationId);
    if (!conversation || conversation.profileId !== profile.id) return json({ error: 'SESSION_NOT_FOUND' }, 404);
  }
  const latestPersistedReport = conversation
    ? await auth.repositories.reportVersions.findLatest(auth.userId, conversation.id)
    : null;

  try {
    conversation = await auth.repositories.turns.start(auth.userId, {
      conversationId: conversation?.id || null,
      profileId: profile.id,
      requestId,
      question,
      topic: 'overview',
      title: question ? `解答: ${question.slice(0, 12)}...` : '八字运势解读',
      userId: auth.userId,
      creditAmount: -10,
      creditReason: 'chat',
    });
    return streamPipelineConversation({
      conversation,
      profile,
      question,
      previousReport: latestPersistedReport?.reportMarkdown || null,
      runPipeline,
      repositories: auth.repositories,
      userId: auth.userId,
    });
  } catch (error) {
    if (/UNIQUE constraint failed/u.test(String(error?.message || ''))) {
      const racedReplay = await auth.repositories.turnRequests.findByRequestId(auth.userId, requestId);
      if (racedReplay) {
        const racedConversation = await auth.repositories.conversations.findById(auth.userId, racedReplay.conversationId);
        const racedReport = racedReplay.reportVersionNumber === null
          ? null
          : await auth.repositories.reportVersions.findByVersion(auth.userId, racedReplay.conversationId, racedReplay.reportVersionNumber);
        return streamCompletedConversation(racedConversation, racedReport, 0);
      }
    }
    const status = error.code === 'INSUFFICIENT_CREDITS' ? 402 : ['PROFILE_NOT_FOUND', 'PROFILE_MISMATCH', 'SESSION_NOT_FOUND'].includes(error.code) ? 404 : 400;
    return json({ error: error.code || 'CHAT_ERROR' }, status);
  }
}

function streamPipelineConversation({ conversation, profile, question, previousReport, runPipeline, repositories, userId }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      sendEvent({ type: 'session_start', sessionId: conversation.id, conversationId: conversation.id, reportVersion: null, profileName: profile.name });
      const startTime = Date.now();
      try {
        const result = await runPipeline({ profile, question, previousReport, onEvent: sendEvent });
        const assistantMessage = result.summary || '解析已完成，参阅右侧报告。';
        const report = await repositories.turns.complete(userId, conversation.requestId, {
          summary: result.summary || '',
          reportMarkdown: result.report || '',
          chartSummary: result.chartSummary || '',
          chart: result.chart || {},
          topic: result.topics?.[0]?.topic || 'overview',
        });
        sendEvent({ type: 'evidence', evidencePayload: result.evidencePayload });
        sendEvent({ type: 'conclusion', text: assistantMessage, conversationId: conversation.id, reportVersion: report.versionNumber, serviceDegraded: result.service?.degraded === true });
        sendEvent({ type: 'report', markdown: report.reportMarkdown, conversationId: conversation.id, reportVersion: report.versionNumber });
        sendEvent({ type: 'session_end', duration: Date.now() - startTime, creditsUsed: 10, conversationId: conversation.id, reportVersion: report.versionNumber, serviceDegraded: result.service?.degraded === true });
      } catch (error) {
        await repositories.reports.fail(userId, conversation.id, conversation.requestId);
        sendEvent({ type: 'error', message: error.message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function streamCompletedConversation(conversation, report, creditsUsed) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: 'session_start', sessionId: conversation.id, conversationId: conversation.id, reportVersion: report?.versionNumber || null });
      if (report) {
        send({ type: 'conclusion', text: report.summary || '解析已完成，参阅右侧报告。', conversationId: conversation.id, reportVersion: report.versionNumber, serviceDegraded: false });
        send({ type: 'report', markdown: report.reportMarkdown, conversationId: conversation.id, reportVersion: report.versionNumber });
      }
      send({ type: 'session_end', duration: 0, creditsUsed, replayed: true, conversationId: conversation.id, reportVersion: report?.versionNumber || null, serviceDegraded: false });
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' };
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export default handleChatRequest;
