function registerInterviewerIpc({ ipcMain, interviewerRuntime }) {
  ipcMain.handle('interviewer-analyze-answer', async (_event, payload = {}) => {
    try {
      const candidateAnswer = String(payload.candidateAnswer || '').trim();
      const questionHistory = Array.isArray(payload.questionHistory)
        ? payload.questionHistory.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const emotionTag = payload?.emotion?.tag ? String(payload.emotion.tag).trim().toLowerCase() : null;
      const emotionConfidence = typeof payload?.emotion?.confidence === 'number'
        ? payload.emotion.confidence
        : null;
      const emotion = emotionTag ? { tag: emotionTag, confidence: emotionConfidence } : null;
      const requestId = payload && payload.requestId != null ? String(payload.requestId) : null;

      const result = await interviewerRuntime.analyzeCandidateAnswer({
        candidateAnswer,
        questionHistory,
        emotion,
        requestId
      });

      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error?.message || 'Interviewer analysis failed' };
    }
  });

  ipcMain.handle('interviewer-is-configured', () => {
    return { configured: interviewerRuntime.isConfigured() };
  });
}

module.exports = {
  registerInterviewerIpc
};
