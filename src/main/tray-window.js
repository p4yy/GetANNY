function showTrayWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function toggleTrayWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isVisible()) {
    window.hide();
    return;
  }
  showTrayWindow(window);
}

function shouldRevealOnActivation(hiddenToTray) {
  return !hiddenToTray;
}

function shouldKeepBackgroundProcess(hiddenToTray, trayAvailable) {
  return hiddenToTray && trayAvailable;
}

function shouldReleaseTrayWindow(clipboardMonitoring) {
  return !clipboardMonitoring;
}

module.exports = {
  showTrayWindow,
  toggleTrayWindow,
  shouldRevealOnActivation,
  shouldKeepBackgroundProcess,
  shouldReleaseTrayWindow,
};
