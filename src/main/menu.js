const { Menu, shell, app } = require("electron");
const { translate } = require("./translate");

function createMenu({ mainWindow, language }) {
  const label = (key) => translate(language, key);
  const native = (role, key = role) => ({ role, label: label("menu." + key) });
  const template = [
    {
      label: "GetANNY",
      submenu: [
        {
          label: label("menu.about"),
          click: () => shell.openExternal("https://github.com/p4yy/GetANNY"),
        },
        { type: "separator" },
        native("quit"),
      ],
    },
    {
      label: label("menu.file"),
      submenu: [
        {
          label: label("downloads.newDownload"),
          click: () => mainWindow()?.webContents.send("menu:add-download"),
        },
        native("close"),
      ],
    },
    {
      label: label("menu.edit"),
      submenu: [
        native("undo"),
        native("redo"),
        { type: "separator" },
        native("cut"),
        native("copy"),
        native("paste"),
        native("selectAll"),
      ],
    },
    {
      label: label("menu.view"),
      submenu: [
        native("reload"),
        native("toggleDevTools", "developerTools"),
        { type: "separator" },
        native("resetZoom"),
        native("zoomIn"),
        native("zoomOut"),
      ],
    },
    {
      label: label("menu.help"),
      submenu: [
        {
          label: label("shortcuts.title"),
          click: () => mainWindow()?.webContents.send("menu:shortcuts"),
        },
        {
          label: label("menu.project"),
          click: () => shell.openExternal("https://github.com/p4yy/GetANNY"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  return app.getName();
}
module.exports = { createMenu };
