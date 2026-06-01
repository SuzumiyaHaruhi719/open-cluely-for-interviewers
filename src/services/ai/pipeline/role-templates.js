// Role-based pipeline templates — the "template library" HR picks from.
//
// Every template reuses the proven Expert 7-block DAG (same nodes/edges, same
// depth+ownership machinery). Each template tunes the ROLE-SENSITIVE blocks to
// its role so the templates are genuinely different end-to-end (not just at D):
//   A (anatomy)     — which claims/spans to prioritize as anchors
//   B (evidence-gap)— which competencies a gap counts toward
//   D (question-pool)— the generator's mission/lens (the big one)
//   E (rank-score)  — which trait to prefer when candidates are equally deep
//   G (final-render)— what the interviewer rationale is framed around
// The fixed frame (input injection, JSON schema, hard rules incl. mandatory
// personal ownership) stays intact on every block, so each template is still
// guaranteed runnable and keeps the quality floor.
//
// These register as builtins in preset-library, so they show up in the Customize
// picker with no extra wiring.

const { EXPERT_PRESET } = require('./presets');
const { DEFAULT_BODY: BODY_A } = require('../interviewer-prompts/expert/block-a-answer-anatomy');
const { DEFAULT_BODY: BODY_B } = require('../interviewer-prompts/expert/block-b-evidence-gap');
const { DEFAULT_BODY: BODY_E } = require('../interviewer-prompts/expert/block-e-rank-score');
const { DEFAULT_BODY: BODY_G } = require('../interviewer-prompts/expert/block-g-final-render');

// Shared preamble so every role keeps the "probe the person, not the datum" spine.
const SPINE = `THE MISSION — probe the PERSON, not the datum. A great follow-up makes the candidate reveal durable potential and work traits: judgment, the alternatives they weighed, what they personally owned, what broke and what they learned. A fact a transcript already holds (a number, a tool name, a date) is the failure to avoid — probe the DECISION behind the datum, and force the candidate's OWN call ("you personally", "yours alone"), never a "we".`;

// Per-role lens appended after the shared spine. Keep each to the role's highest-
// signal traits — what separates a strong hire from a mediocre one in that role.
const ROLE_LENSES = {
  backend: {
    name: '后端 / 技术工程师',
    blurb: '深挖系统设计权衡、故障处理、线上事故的个人担当与调试判断。',
    lens: `Role focus: a senior BACKEND / software engineer. Aim every question at engineering judgment under real constraints — system-design tradeoffs they personally chose (consistency vs. latency, build vs. buy), how they diagnosed a production failure, the call they made under an incident, what they got wrong in a design first and what fixing it taught them, where they owned a decision inside a "we" team. Avoid trivia about syntax/tool names; chase the reasoning behind the architecture.`
  },
  pm: {
    name: '产品经理',
    blurb: '深挖冲突下的优先级取舍、无授权影响力、用户/业务/技术的权衡判断。',
    lens: `Role focus: a PRODUCT MANAGER. Aim every question at prioritization under conflict (what they personally cut and why), influence without authority (how they got an unwilling team/stakeholder to move), the tradeoff they owned between user value, business goals, and engineering cost, a roadmap bet that was theirs and what it cost, and a product call they got wrong and how they noticed. Avoid pinning metrics; chase the judgment behind the prioritization.`
  },
  data: {
    name: '数据 / 算法',
    blurb: '深挖实验设计、指标取舍、模型决策、面对数据模糊性的判断。',
    lens: `Role focus: a DATA SCIENTIST / ML engineer. Aim every question at experiment-design judgment (the hypothesis they personally chose to test and why, what they'd have done with half the data), metric tradeoffs they owned (optimizing one thing at another's expense), a modeling decision and the alternative they rejected, and a time their analysis was wrong and how they caught it. Avoid asking for exact numbers; chase the reasoning behind the experiment and the metric choice.`
  },
  sales: {
    name: '销售 / BD',
    blurb: '深挖异议处理、韧性、成交取舍中的判断、个人对业绩的担当。',
    lens: `Role focus: a SALES / business-development rep. Aim every question at resilience and judgment in deals — an objection they personally turned around (and the one they couldn't), a deal tradeoff they owned (discount vs. margin, walking away vs. chasing), how they prioritized a pipeline under a hard quarter, and a deal they lost and what they'd do differently. Avoid asking for quota numbers; chase the judgment and ownership behind the deal.`
  },
  manager: {
    name: '管理 / 团队负责人',
    blurb: '深挖用人决策、冲突化解、授权取舍、对绩效的艰难判断。',
    lens: `Role focus: an ENGINEERING/TEAM MANAGER or lead. Aim every question at people-judgment they personally made — a hard performance or hiring call they owned (and what it cost), a conflict between two reports they resolved, what they chose to delegate vs. hold and why, a time they backed an unpopular decision, and a management mistake and what it taught them. Avoid org-chart trivia; chase the judgment and personal stake behind the people decision.`
  },
  campus: {
    name: '校招 / 通用潜力',
    blurb: '深挖潜力、学习敏捷度、项目/实习中的个人担当与面对失败的反应。',
    lens: `Role focus: a CAMPUS / early-career candidate with limited experience. Aim every question at POTENTIAL rather than track record — a decision they personally drove in a project/internship (not the group's), how they taught themselves something hard and where it bit them, a time they were wrong and changed course, and what they'd redo about a project. Be fair to thin experience but still force a first-person call and the reasoning behind it. Avoid pinning facts; chase learning agility and ownership.`
  }
};

// Compose node D's full promptBody from a role lens (shared by built-in templates
// and the AI generator, so both stay on the same proven frame).
function composeDBody(lens) {
  return `Role: You are the QUESTION-POOL block. Produce EXACTLY 5 follow-up question candidates for the interviewer. You do NOT rank — that is the next block's job.\n\n${SPINE}\n\n${String(lens || '').trim()}\n\nYour three jobs: (1) depth — every question forces reasoning/ownership/trait revelation through this role's lens; (2) diversity — ≥3 distinct question_types; (3) anchoring — quote the candidate's own words so the question can't be asked of anyone else.`;
}

// Append a role-focus directive to a block's default body. Keeps the block's
// proven mission + frame intact and aims it at this role, so every template's
// per-block prompt is genuinely different (not just block D).
function withFocus(baseBody, name, instruction, focus) {
  const f = String(focus || '').trim();
  if (!f) return baseBody;
  return `${baseBody}\n\n[ROLE FOCUS — ${name}] ${instruction} ${f}`;
}

// Build a valid pipeline (Expert DAG) with the role-sensitive blocks (A/B/D/E/G)
// all tuned to this role. `focus` is a short phrase naming the role's highest-
// signal traits; `lens` is node D's full mission. Used by built-ins and the AI
// generator alike — structure is fixed/validated, only the prompt bodies vary.
function assembleFromLens({ id, name, blurb, lens, focus = null, role = null }) {
  const f = focus || blurb || '';
  const body = {
    A: withFocus(BODY_A, name, 'When extracting claims and choosing anchor spans, prioritize those that reveal', f),
    B: withFocus(BODY_B, name, 'When flagging missing evidence, weight gaps toward', f),
    D: composeDBody(lens),
    E: withFocus(BODY_E, name, 'When two candidates are equally deep, prefer the one that better probes', f),
    G: withFocus(BODY_G, name, "Frame the interviewer rationale around this role's signals:", f)
  };
  const nodes = EXPERT_PRESET.nodes.map((n) => (
    body[n.id] ? { ...n, promptBody: body[n.id] } : { ...n }
  ));
  return {
    id: id || `custom-ai-${Date.now()}`,
    name: name || 'AI 生成的面试',
    blurb: blurb || '',
    builtin: false,
    role,
    version: 'ai_v1',
    nodes,
    edges: EXPERT_PRESET.edges.map((e) => ({ ...e }))
  };
}

// Clone the Expert nodes and inject the role lens into node D's promptBody.
function buildRoleTemplate(key) {
  const role = ROLE_LENSES[key];
  const p = assembleFromLens({ id: `builtin-role-${key}`, name: role.name, blurb: role.blurb, lens: role.lens, role: key });
  return { ...p, builtin: true, version: `role_${key}_v1` };
}

const ROLE_TEMPLATES = Object.keys(ROLE_LENSES).map(buildRoleTemplate);

module.exports = { ROLE_TEMPLATES, ROLE_LENSES, SPINE, buildRoleTemplate, assembleFromLens, composeDBody };
