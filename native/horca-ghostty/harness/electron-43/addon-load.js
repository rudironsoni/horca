const { app } = require('electron');
const path = require('path');
const addonPath = path.join(__dirname, '../../adopted/electron-ghostty/addon.js');

app.whenReady().then(() => {
  try {
    const { load, available, ADDON_PATH } = require(addonPath);
    console.log(JSON.stringify({
      electron: process.versions.electron,
      available,
      ADDON_PATH,
    }));
    const addon = load();
    addon.init();
    console.log('ADDON_LOAD_IN_ELECTRON_43_7: PASS');
    app.exit(0);
  } catch (err) {
    console.error('ADDON_LOAD_IN_ELECTRON_43_7: FAIL', err && err.stack || err);
    app.exit(1);
  }
});
