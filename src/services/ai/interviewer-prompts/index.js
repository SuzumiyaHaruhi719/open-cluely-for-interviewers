// Combined export surface for interviewer prompts.
//   Fast (champion) mode → unchanged 3-stage chain in ../interviewer-prompts.js
//   Expert mode          → new 7-block chain (A..G) under ./expert/*
//
// The expert chain's schemas + validator live in ./schemas.js and are also
// exported here for the orchestrator + offline evaluators.

const fastChampion = require('../interviewer-prompts');

const { buildBlockA } = require('./expert/block-a-answer-anatomy');
const { buildBlockB } = require('./expert/block-b-evidence-gap');
const { buildBlockC } = require('./expert/block-c-state-update');
const { buildBlockD } = require('./expert/block-d-question-pool');
const { buildBlockE } = require('./expert/block-e-rank-score');
const { buildBlockF, runHardRules } = require('./expert/block-f-safety-audit');
const { buildBlockG, EXPERT_ITERATION_VERSION } = require('./expert/block-g-final-render');
const schemas = require('./schemas');

module.exports = {
  fast: {
    ITERATION_VERSION: fastChampion.ITERATION_VERSION,
    buildHookDetectionPrompt: fastChampion.buildHookDetectionPrompt,
    buildFollowUpQuestionPrompt: fastChampion.buildFollowUpQuestionPrompt,
    buildFreshTopicPrompt: fastChampion.buildFreshTopicPrompt
  },
  expert: {
    ITERATION_VERSION: EXPERT_ITERATION_VERSION,
    buildBlockA,
    buildBlockB,
    buildBlockC,
    buildBlockD,
    buildBlockE,
    buildBlockF,
    buildBlockG,
    runHardRules
  },
  schemas
};
