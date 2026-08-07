import { defaultAuthService } from '../lib/runtime/auth-service.js';
import { defaultProfileService } from '../lib/runtime/profile-service.js';
import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';
import { run6StagePipeline } from '../lib/agent/multi-agent-pipeline.js';

export async function handleChatRequest(req) {
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

        defaultSessionHistoryService.updateSession(wallet, sessionId, {
          question,
          topic: pipelineResult.topics?.[0]?.topic || 'overview',
          summary: pipelineResult.summary || '',
          reportMarkdown: pipelineResult.report || '',
        });

        // 终结事件，包含对话区核心结论
        sendEvent({
          type: 'conclusion',
          text: pipelineResult.summary || '解析已完成，参阅右侧报告。'
        });

        sendEvent({
          type: 'report',
          markdown: pipelineResult.report
        });

        const duration = Date.now() - startTime;
        sendEvent({ type: 'session_end', duration, creditsUsed: 0 });
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

export default handleChatRequest;
