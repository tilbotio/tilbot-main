const http = require('http');
const https = require('https');
const express = require('express');
const socket = require('socket.io');
const path = require('path');
const fs = require('fs');
const ProjectController = require('./projectcontroller.cjs');

const app = express();

var server = null;

if (fs.existsSync(__dirname + '/../certs/privkey.pem') && fs.existsSync(__dirname + '/../certs/pubkey.pem')) {

  const key = fs.readFileSync(__dirname + '/../certs/privkey.pem');
  const cert = fs.readFileSync(__dirname + '/../certs/pubkey.pem');
  var ssloptions = {
    key: key,
    cert: cert
  };   

  app.use(express.static(path.join(__dirname, '/../certs/')));
  
  server = https.createServer(ssloptions, app);
}

else {
  server = http.createServer(app);
}

const io = socket(server);

let project = fs.readFileSync(__dirname + '/../currentproject/electron-project.json');
project = JSON.parse(project);
console.log(project);

let clients = {};

app.use(express.static(path.join(__dirname, '/../build/')));

app.get('/', (req, res) => {
    res.status(200);
    res.sendFile(path.join(__dirname, '/../build/index.html'));
});

server.listen(2801, () => {
    console.log('listening on port 2801');
});

io.on('connection', (socket) => {
    console.log('a user connected');

    clients[socket.id] = new ProjectController(io, project, socket.id);
  
    socket.on('message sent', () => {
      clients[socket.id].message_sent_event();
    });

    socket.on('user_message', (str) => {
      clients[socket.id].receive_message(str);
    });

    socket.on('disconnect', () => {
      clients[socket.id].disconnected();
      delete clients[socket.id];
      console.log('disconnected');
    });

    socket.on('log', (str) => {
      clients[socket.id].log(str);
    });

});