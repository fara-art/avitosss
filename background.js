async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  } catch (error) {
    console.error('Не удалось настроить боковую панель', error);
  }
}

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);
