function registerProcessLoopbackIpc({ ipcMain, processLoopbackService }) {
  ipcMain.handle('process-audio-list', async () => {
    return processLoopbackService.listAudioProcesses();
  });

  ipcMain.handle('process-audio-start', async (_event, payload = {}) => {
    try {
      const processId = typeof payload === 'string' ? payload : payload?.processId;
      const result = await processLoopbackService.start(processId);
      return result;
    } catch (error) {
      console.error('process-audio-start failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('process-audio-stop', async () => {
    try {
      const result = await processLoopbackService.stop();
      return result;
    } catch (error) {
      console.error('process-audio-stop failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('process-audio-status', () => {
    return processLoopbackService.getStatus();
  });
}

module.exports = {
  registerProcessLoopbackIpc
};
