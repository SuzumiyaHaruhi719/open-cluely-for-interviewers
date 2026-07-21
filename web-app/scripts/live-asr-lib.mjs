export function parseLiveAsrOptions(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return {
    autoGenerate: args.includes('--auto-generate'),
    diarize: !args.includes('--no-diarize')
  };
}

export function parsePcm16Wav(input) {
  if (!Buffer.isBuffer(input) || input.length < 12) {
    throw new Error('Audio must be a RIFF/WAVE buffer');
  }
  if (input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Audio must be a RIFF/WAVE buffer');
  }

  let format = null;
  let pcm = null;
  for (let offset = 12; offset + 8 <= input.length;) {
    const id = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > input.length) throw new Error(`Invalid WAV chunk ${id}`);

    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV fmt chunk');
      format = {
        audioFormat: input.readUInt16LE(start),
        channels: input.readUInt16LE(start + 2),
        sampleRate: input.readUInt32LE(start + 4),
        bitsPerSample: input.readUInt16LE(start + 14)
      };
    } else if (id === 'data') {
      pcm = input.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!format || !pcm) throw new Error('WAV is missing fmt or data');
  if (format.audioFormat !== 1) throw new Error('WAV must contain uncompressed PCM');
  if (format.channels !== 1 || format.sampleRate !== 16_000 || format.bitsPerSample !== 16) {
    throw new Error(
      `WAV must be mono 16 kHz PCM16; got ${format.channels}ch ${format.sampleRate}Hz ${format.bitsPerSample}bit`
    );
  }
  return { ...format, pcm };
}

export function summarizeAsrRun(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const startedAt = safeEvents[0]?.at ?? 0;
  const messages = safeEvents.map((event) => event.message).filter(Boolean);
  const statusEvents = safeEvents
    .filter((event) => event.message?.type === 'asr-status')
    .map((event) => ({ state: event.message.state, atMs: event.at - startedAt }));
  const statuses = statusEvents.map((event) => event.state);
  const finals = safeEvents.filter(
    (event) => event.message?.type === 'transcript' && event.message.isFinal === true
  );
  const finalsWithSeq = finals.map((event, seq) => ({ ...event, seq }));
  const speakerIds = Array.from(
    new Set(
      finals
        .map((event) => event.message.speakerId)
        .filter((speakerId) => Number.isInteger(speakerId))
    )
  ).sort((a, b) => a - b);
  const partitionEvents = safeEvents.filter(
    (event) => event.message?.type === 'speaker-partition'
  );
  const finalPartitionEvent = partitionEvents
    .filter((event) => event.message.status === 'final')
    .at(-1);
  const finalPartitionMessage = finalPartitionEvent?.message;
  const finalPartition = finalPartitionMessage
    ? {
        model: finalPartitionMessage.model,
        segmentCount: finalPartitionMessage.segments.length,
        roles: finalPartitionMessage.segments.reduce(
          (roles, segment) => {
            const role = segment.role === 'interviewer' || segment.role === 'candidate'
              ? segment.role
              : 'unknown';
            roles[role] += 1;
            return roles;
          },
          { interviewer: 0, candidate: 0, unknown: 0 }
        )
      }
    : null;
  const assignmentHistories = {};
  const assignedRolesBySpeaker = new Map();
  let invalidPartitionCount = 0;
  for (const event of partitionEvents) {
    const assignments = Array.isArray(event.message.speakerAssignments)
      ? event.message.speakerAssignments
      : [];
    const byId = new Map();
    let valid = true;
    for (const assignment of assignments) {
      if (!Number.isInteger(assignment?.speakerId) || byId.has(assignment.speakerId)) {
        valid = false;
        continue;
      }
      byId.set(assignment.speakerId, assignment);
      const key = String(assignment.speakerId);
      const history = assignmentHistories[key] ?? [];
      history.push({
        atMs: event.at - startedAt,
        status: event.message.status,
        role: assignment.role,
        state: assignment.state,
        roleSource: assignment.roleSource,
        confidence: Number(assignment.confidence ?? 0),
        evidenceVersion: Number(assignment.evidenceVersion ?? 0),
        updatedAtMs: Number(assignment.updatedAtMs ?? 0),
        reasonCodes: Array.isArray(assignment.reasonCodes) ? [...assignment.reasonCodes] : []
      });
      assignmentHistories[key] = history;
      if (assignment.role === 'candidate' || assignment.role === 'interviewer') {
        const roles = assignedRolesBySpeaker.get(assignment.speakerId) ?? new Set();
        roles.add(assignment.role);
        assignedRolesBySpeaker.set(assignment.speakerId, roles);
      }
    }
    for (const segment of Array.isArray(event.message.segments) ? event.message.segments : []) {
      const assignment = byId.get(segment.speakerId);
      if (!assignment) continue;
      if (segment.role !== assignment.role || segment.roleSource !== assignment.roleSource) {
        valid = false;
      }
    }
    if (!valid) invalidPartitionCount += 1;
  }
  const mixedRoleSpeakerIds = [...assignedRolesBySpeaker.entries()]
    .filter(([, roles]) => roles.size > 1)
    .map(([speakerId]) => speakerId)
    .sort((a, b) => a - b);
  const finalAssignments = Array.isArray(finalPartitionMessage?.speakerAssignments)
    ? finalPartitionMessage.speakerAssignments
    : [];
  const finalAssignmentById = new Map(
    finalAssignments
      .filter((assignment) => Number.isInteger(assignment?.speakerId))
      .map((assignment) => [assignment.speakerId, assignment])
  );
  const speakerEvidence = new Map();
  for (const event of finals) {
    const speakerId = event.message.speakerId;
    if (!Number.isInteger(speakerId)) continue;
    const evidence = speakerEvidence.get(speakerId) ?? { utterances: 0, chars: 0 };
    evidence.utterances += 1;
    evidence.chars += String(event.message.text ?? '').replace(/\s+/g, '').length;
    speakerEvidence.set(speakerId, evidence);
  }
  const substantiveSpeakerIds = [...speakerEvidence.entries()]
    .filter(([, evidence]) => evidence.utterances >= 2 && evidence.chars >= 48)
    .map(([speakerId]) => speakerId)
    .sort((a, b) => a - b);
  const pendingSpeakerIds = speakerIds.filter((speakerId) => {
    const assignment = finalAssignmentById.get(speakerId);
    return !assignment ||
      assignment.role === 'unknown' ||
      (assignment.state !== 'delegated' && assignment.state !== 'manual');
  });
  const pendingSubstantiveSpeakerIds = substantiveSpeakerIds.filter((speakerId) =>
    pendingSpeakerIds.includes(speakerId)
  );
  const errors = messages.flatMap((message) => {
    if (message.type === 'error') return [String(message.message ?? 'unknown error')];
    if (message.type === 'asr-status' && (message.state === 'failed' || message.state === 'partial')) {
      return [String(message.message ?? message.state)];
    }
    return [];
  });
  const stoppedEvent = safeEvents.find(
    (event) => event.message?.type === 'asr-status' && event.message.state === 'stopped'
  );
  const autoMonitorStates = safeEvents
    .filter((event) => event.message?.type === 'auto-monitor')
    .map((event) => ({
      status: event.message.status,
      model: event.message.model,
      ...(Number.isFinite(event.message.elapsedMs) ? { elapsedMs: event.message.elapsedMs } : {}),
      atMs: event.at - startedAt
    }));
  const autoQuestions = safeEvents
    .filter((event) => event.message?.type === 'result' && event.message.trigger === 'auto')
    .map((event) => ({
      requestId: String(event.message.requestId ?? ''),
      question: String(event.message.output?.primary_question ?? ''),
      ...(Number.isInteger(event.message.anchorSeq) ? { anchorSeq: event.message.anchorSeq } : {}),
      tokensUsed: event.message.tokensUsed ?? { input: 0, output: 0, total: 0 },
      elapsedMs: Number.isFinite(event.message.elapsedMs) ? event.message.elapsedMs : 0,
      atMs: event.at - startedAt
    }));
  const invalidAutoQuestionIds = safeEvents
    .filter((event) => event.message?.type === 'result' && event.message.trigger === 'auto')
    .flatMap((event) => {
      const requestId = String(event.message.requestId ?? '');
      const anchorSeq = event.message.anchorSeq;
      if (!Number.isInteger(anchorSeq)) return [requestId];
      const anchorFinal = finalsWithSeq.find((candidate) => candidate.seq === anchorSeq);
      const speakerId = anchorFinal?.message?.speakerId;
      if (!Number.isInteger(speakerId)) return [requestId];
      const latestPartition = partitionEvents
        .filter((partitionEvent) => partitionEvent.at <= event.at)
        .at(-1);
      const assignment = Array.isArray(latestPartition?.message?.speakerAssignments)
        ? latestPartition.message.speakerAssignments.find((entry) => entry.speakerId === speakerId)
        : undefined;
      const valid = assignment?.role === 'candidate' &&
        (assignment.state === 'delegated' || assignment.state === 'manual');
      return valid ? [] : [requestId];
    });
  const qaChecks = {
    providerLifecycleClean: errors.length === 0,
    finalPartitionBeforeStopped:
      finalPartitionEvent !== undefined &&
      stoppedEvent !== undefined &&
      safeEvents.indexOf(finalPartitionEvent) < safeEvents.indexOf(stoppedEvent),
    oneRolePerNativeSpeaker: mixedRoleSpeakerIds.length === 0,
    validPartitions: invalidPartitionCount === 0,
    allSubstantiveSpeakersDelegated: pendingSubstantiveSpeakerIds.length === 0,
    autoQuestionsAnchorDelegatedCandidates: invalidAutoQuestionIds.length === 0
  };

  return {
    statuses,
    statusEvents,
    finalCount: finals.length,
    partialCount: messages.filter(
      (message) => message.type === 'transcript' && message.isFinal === false
    ).length,
    speakerIds,
    substantiveSpeakerIds,
    finalPartition,
    finalPartitionBeforeStopped:
      finalPartitionEvent !== undefined &&
      stoppedEvent !== undefined &&
      safeEvents.indexOf(finalPartitionEvent) < safeEvents.indexOf(stoppedEvent),
    errors,
    firstFinalMs: finals.length ? finals[0].at - startedAt : null,
    durationMs: safeEvents.length ? safeEvents.at(-1).at - startedAt : 0,
    finalTexts: finals.map((event) => String(event.message.text ?? '')),
    autoMonitorStates,
    autoQuestions,
    autoQuestionCount: autoQuestions.length,
    assignmentHistories,
    mixedRoleSpeakerIds,
    pendingSpeakerIds,
    pendingSubstantiveSpeakerIds,
    invalidPartitionCount,
    invalidAutoQuestionIds,
    qaChecks,
    qaPassed: Object.values(qaChecks).every(Boolean)
  };
}
