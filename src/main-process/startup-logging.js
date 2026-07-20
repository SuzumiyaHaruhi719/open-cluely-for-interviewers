function logStartupConfiguration({
  appEnvironment,
  appState,
  programmingLanguages,
  defaultProgrammingLanguage
}) {
  const dashscopeApiKey = typeof appState?.dashscopeApiKey === 'string' ? appState.dashscopeApiKey : '';
  const hasVolcCredentials = Boolean(
    String(process.env.VOLC_APP_ID || '').trim() &&
    String(process.env.VOLC_ACCESS_TOKEN || '').trim()
  );

  console.log('Loaded .env from:', appEnvironment.envPath);
  console.log('Startup configuration:');
  console.log(`  DashScope API key (UI state): ${dashscopeApiKey ? 'present' : 'missing'}`);
  console.log('  ASR provider:                 Doubao Seed ASR 2.0');
  console.log(`  Doubao credentials (.env):    ${hasVolcCredentials ? 'present' : 'missing'}`);
  console.log(`  HIDE_FROM_SCREEN_CAPTURE: ${appEnvironment.hideFromScreenCapture}`);
  console.log(`  MAX_SCREENSHOTS:          ${appEnvironment.maxScreenshots}`);
  console.log(`  SCREENSHOT_DELAY:         ${appEnvironment.screenshotDelay}`);
  console.log(`  NODE_ENV:                 ${appEnvironment.nodeEnv}`);
  console.log(`  NODE_OPTIONS:             ${appEnvironment.nodeOptions}`);
  console.log(`  Default programming language: ${defaultProgrammingLanguage}`);
  console.log(`  Programming languages: ${programmingLanguages.join(', ')}`);
}

module.exports = {
  logStartupConfiguration
};
