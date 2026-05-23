// Smoke test: exercise the two-stage interviewer prompt chain end to end.
// Run:  node scripts/smoke-deepseek.js
// Requires: DEEPSEEK_API_KEY set in environment.

const path = require('path');
const DeepSeekService = require(path.join('..', 'src', 'services', 'ai', 'deepseek-service'));

const SAMPLE = {
  jobDescription: 'Senior Backend Engineer for ad-tech bidding service. Must reason about latency tail, traffic shaping, and incident response.',
  resumeChunk: '- Led migration of ad-bidder from monolith to gRPC microservices at AdCo, 2023-2024.\n- Reduced p99 latency from 280ms to 95ms.\n- Mentored 3 engineers.',
  candidateAnswer: 'Yeah so the migration was a big project, we moved the bidder over to microservices and the latency got a lot better, we hit our SLO targets. The team was great, we worked through it together.',
  questionHistory: ['Walk me through the bidder migration.']
};

async function main() {
  const svc = new DeepSeekService();
  console.log('=== Stage 1: hook detection ===');
  const stage1 = await svc.detectHooks(SAMPLE);
  console.log('raw:', stage1.raw.slice(0, 500));
  console.log('parsed:', JSON.stringify(stage1.parsed, null, 2));
  console.log('usage:', stage1.usage);

  if (!stage1.parsed) {
    console.error('Stage 1 returned unparseable output. Aborting.');
    process.exit(2);
  }
  const score = stage1.parsed.depth_worth_score;
  if (score < 4) {
    console.log(`Stage 1 score=${score} — would skip Stage 2 in production. Running anyway for smoke test.`);
  }

  console.log('\n=== Stage 2: follow-up generation ===');
  const stage2 = await svc.generateFollowUps({
    concreteHooks: stage1.parsed.concrete_hooks || [],
    missingStar: stage1.parsed.missing_star_element || 'none',
    recommendedDirection: stage1.parsed.recommended_direction || 'technical-depth',
    candidateAnswer: SAMPLE.candidateAnswer,
    questionHistory: SAMPLE.questionHistory
  });
  console.log('raw:', stage2.raw.slice(0, 800));
  console.log('parsed:', JSON.stringify(stage2.parsed, null, 2));
  console.log('usage:', stage2.usage);

  if (!stage2.parsed || !Array.isArray(stage2.parsed.questions)) {
    console.error('Stage 2 returned unexpected shape.');
    process.exit(3);
  }
  console.log('\nSMOKE OK');
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err);
  process.exit(1);
});
