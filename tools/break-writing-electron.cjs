const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.env.BREAK_WRITING_PROFILE)
app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 1200,
        height: 900,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    })
    win.loadURL('http://127.0.0.1:4197/break-writing.html?data=demo')
})
