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
  const speakerIds = Array.from(
    new Set(
      finals
        .map((event) => event.message.speakerId)
        .filter((speakerId) => Number.isInteger(speakerId))
    )
  ).sort((a, b) => a - b);
  const finalPartitionEvent = safeEvents
    .filter((event) => event.message?.type === 'speaker-partition' && event.message.status === 'final')
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

  return {
    statuses,
    statusEvents,
    finalCount: finals.length,
    partialCount: messages.filter(
      (message) => message.type === 'transcript' && message.isFinal === false
    ).length,
    speakerIds,
    finalPartition,
    finalPartitionBeforeStopped:
      finalPartitionEvent !== undefined &&
      stoppedEvent !== undefined &&
      safeEvents.indexOf(finalPartitionEvent) < safeEvents.indexOf(stoppedEvent),
    errors,
    firstFinalMs: finals.length ? finals[0].at - startedAt : null,
    durationMs: safeEvents.length ? safeEvents.at(-1).at - startedAt : 0,
    finalTexts: finals.map((event) => String(event.message.text ?? ''))
  };
}
