const { Tray, Menu, nativeImage } = require("electron");
const { showTrayWindow, toggleTrayWindow } = require("./tray-window");
function createTray({ mainWindow, app, iconPath, onShow, onToggle }) {
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return null;
  const tray = new Tray(icon);
  tray.setToolTip("GetANNY Download Manager");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show GetANNY",
        click: () => (onShow ? onShow() : showTrayWindow(mainWindow())),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () =>
    onToggle ? onToggle() : toggleTrayWindow(mainWindow()),
  );
  return tray;
}
module.exports = { createTray };
