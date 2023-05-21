const { app, protocol, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const publicIp = require('public-ip');
const AdmZip = require('adm-zip');

let ps = undefined;

const createWindow = () => {       
  const win = new BrowserWindow({
    show: false, 
    title: "Tilbot",
    nodeIntegration: false,
    webPreferences: {
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
    },    
  });
  win.maximize();

  win.on('close', function() {
    if (ps !== undefined) {
      ps.kill('SIGTERM');
    }
  });

  // Get external and internal ip-address
  (async () => {
    var address, ifaces = require('os').networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].filter((details) => details.family === 'IPv4' && details.internal === false ? address = details.address: undefined);
    }

    let ipv4 = await publicIp.v4();

    ipcMain.on('open-server', (event, project_json) => {
      if (!fs.existsSync(`${__dirname}/currentproject/`)) {
        fs.mkdirSync(`${__dirname}/currentproject`);
      }
      fs.writeFileSync(`${__dirname}/currentproject/electron-project.json`, project_json);
      ps = fork(`${__dirname}/electron/electron-server.cjs`);

      win.webContents.send('server-ip', {public_ip: ipv4, local_ip: address});
    });

    ipcMain.on('close-server', (event) => {
      if (ps !== undefined) {
        ps.kill('SIGTERM');
      }        
    });
  })(); 

  ipcMain.on('do-load', (event) => {
    let load_file = dialog.showOpenDialogSync({
        properties: [
          'openFile'
        ],
        filters: [{
            name: 'Tilbot project',
            extensions: [
                '.tilbot',
                '.json'
            ]
        }]
    });

    if (load_file !== undefined) {
      // Remove the old temp project
      if (fs.existsSync(`${__dirname}/currentproject`)) {
        fs.rmSync(`${__dirname}/currentproject`, { recursive: true });
      }
      fs.mkdirSync(`${__dirname}/currentproject`);

      // Only one file should be allowed to be selected.
      if (load_file[0].endsWith('.tilbot')) {
        const zip = new AdmZip(load_file[0]);
        var zipEntries = zip.getEntries(); // an array of ZipEntry records
  
        zipEntries.forEach(function (zipEntry) {
            if (zipEntry.entryName == "project.json") {
                win.webContents.send('project-load', zipEntry.getData().toString("utf8"));
            }
            else if (zipEntry.entryName.startsWith('var/')) {
              zip.extractEntryTo(zipEntry, `${__dirname}/currentproject`);              
            }
        });          
      }

      else {
        let json = fs.readFileSync(load_file[0], 'utf8');
        console.log(json);
        win.webContents.send('project-load', json);
      }

      // @TODO: something with additional files like avatar, data files, etc.
    }
  });  

  ipcMain.on('get-csv', (event, filename) => {
    if (fs.existsSync(`${__dirname}/currentproject/var/` + filename)) {
      let csv = fs.readFileSync(`${__dirname}/currentproject/var/` + filename, 'utf8');
      win.webContents.send('csv-load', { filename: filename, csv: csv });
    }
  });  

  ipcMain.on('do-load-csv-data', (event) => {
    let load_file = dialog.showOpenDialogSync({
        properties: [
          'openFile'
        ],
        filters: [{
            name: 'Comma-separated value (CSV) file',
            extensions: [
                '.csv'
            ]
        }]
    });

    if (load_file !== undefined) {
        let fname = path.basename(load_file[0]);

        if (!fs.existsSync(`${__dirname}/currentproject/`)) {
          fs.mkdirSync(`${__dirname}/currentproject`);
        }

        if (!fs.existsSync(`${__dirname}/currentproject/var/`)) {
          fs.mkdirSync(`${__dirname}/currentproject/var`);
        }
          
        fs.copyFileSync(load_file[0], `${__dirname}/currentproject/var/` + fname);
        let csv = fs.readFileSync(load_file[0], 'utf8');
        win.webContents.send('csv-load', { filename: fname, csv: csv });

        // @TODO: load into csvdb for use
    }
  });    
  
  ipcMain.on('do-save', (event, project) => {
    let save_file = dialog.showSaveDialogSync({
        filters: [{
            name: 'Tilbot project',
            extensions: [
                '.tilbot'
            ]
        }]
    });

    if (save_file !== undefined) {
      const file = new AdmZip();
      file.addFile('project.json', Buffer.from(project));

      let proj_obj = JSON.parse(project);
      for (v in proj_obj.variables) {
        if (proj_obj.variables[v].type == 'csv') {
          file.addLocalFile(`${__dirname}/currentproject/var/` + proj_obj.variables[v].csvfile, 'var');
        }
      }
      
      fs.writeFileSync(save_file, file.toBuffer());
      win.webContents.send('project-saved');
    }

    // @TODO: save related files (avatar image, data files, etc.)
  });

  // @TODO: For the online version, this will have to be integrated with the editorsocket, I think.
  // @TODO: CSV client thing here when launching the simulator (send project file here, load CSV things)


  protocol.interceptFileProtocol('file', (request, callback) => {        

    // Some paths need to be fixed

    let url = request.url;//.substr(5);

    if (url.indexOf('build') == -1) {
        if (url.indexOf('_app') != -1) {
            callback({url: 'build/' + url.substring(url.indexOf('_app'))});
        }
        else {
            // This should not be triggered anymore with a fix in place in the editor code
            callback({url: 'build/index.html'});
        }        
    }
    else {
        //if (url.indexOf('electron') != -1) {
        //  callback({path: path.normalize(__dirname) + '/' + url.substring(url.indexOf('electron'))});
        //}
        //else {
          callback({path: path.normalize(__dirname) + '/' + url.substring(url.indexOf('build'))});
        //}        
    }    
});  

  win.loadFile('build/editor.html');
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});