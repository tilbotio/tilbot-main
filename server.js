//import { handler } from './build/handler.js';
import express from 'express';
import mongoose from 'mongoose';
import mongodbsession from 'express-mongodb-session';
import session from 'express-session';
import cors from 'cors';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'fs';
const upload = multer({ dest: 'tmp_upload/' });
import { UserApiController } from './api/user.js';
import { ProjectApiController } from './api/project.js';
import { SettingsApiController } from './api/settings.js';

const app = express();

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// parse application/json
app.use(express.json());

// For CORS
app.use(cors({
  allowedHeaders: ['Content-Type'],
  origin: 'http://localhost:5173',
  preflightContinue: true,
  credentials: true,
}));

// Set up the MongoDB connection
var dbPath = 'mongodb://127.0.0.1:27017/tilbot';

console.log(dbPath);

if (process.env.MONGO_USERNAME != undefined) {
  dbPath = 'mongodb://' + process.env.MONGO_USERNAME + ':' + process.env.MONGO_PASSWORD + '@mongo:' + process.env.MONGO_PORT + '/' + process.env.MONGO_DB;
}

const options = {useNewUrlParser: true, useUnifiedTopology: true};
const mongo = mongoose.connect(dbPath, options);

// Make sure the express-mongodb-session can also use the existing connection
console.log(mongodbsession);
const MongoDBStore = mongodbsession(session);

// Main MongoDB connection
mongo.then(() => {
  console.log('MongoDB connected');

  // Sessions
  const store = new MongoDBStore({
    // Because we are using mongoose rather than MongoDB, express-mongodb-session refuses to use the existing connection because it is not instanceof MongoDB.MongoClient
    //existingConnection: mongo.connection,
    //databaseName: process.env.MONGO_DB,
    uri: dbPath,
    collection: 'sessions'
  });

  // Catch errors
  store.on('error', function(error) {
    console.log(error);
  });

  app.use(session({
    secret: 'Super secretthings',
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    },
    store: store,
    // Boilerplate options, see:
    // * https://www.npmjs.com/package/express-session#resave
    // * https://www.npmjs.com/package/express-session#saveuninitialized
    resave: true,
    saveUninitialized: true,
    secure: process.env.HTTPS ? true : false,
    httpOnly: true,
    sameSite: 'none'
  }));

  // add a route that lives separately from the SvelteKit app
  app.post('/api/login', (req, res) => {
    res.status(200);

    UserApiController.login(req.body.username, req.body.password).then(function(success) {
      if(success) {
        req.session.username = req.body.username;
        req.session.save();
        res.send('OK');
      }

      else {
        res.send('NOK');
      }
    });
  });

  app.get('/api/admin_account_exists', (req, res) => {
    res.status(200);

    UserApiController.get_admin_user().then(function(admin) {
      console.log(admin);

      if (admin === null) {
        UserApiController.create_account('admin', 'admin', 99);
        res.send('CREATED');
      }
      else {
        res.send('EXISTS');
      }
    });

  });

  app.post('/api/logout', (req, res) => {
    res.status(200);

    req.session.destroy();
    res.send('OK');
  });

  app.post('/api/change_pass', (req, res) => {
    UserApiController.update_password(req.session.username, req.body.oldpass, req.body.newpass).then(function(success) {
      res.send(success);
    });    
  });

  app.post('/api/create_user_account', (req, res) => {
    UserApiController.get_user(req.session.username).then(function(user) {
      if (user !== null) {
        if (user.role == 99) { // admin
          UserApiController.create_account(req.body.username, req.body.password, 1).then(function(success) {
            console.log(success);
            res.send(success);
          });    
        }

        else {
          res.send('USER_NOT_ADMIN');
        }
      }
      else {
        res.send('USER_NOT_FOUND');
      }
    });  
  });

  app.post('/api/set_user_active', (req, res) => {
    res.status(200);

    UserApiController.get_user(req.session.username).then(function(user) {
      if (user !== null) {
        if (user.role == 99) { // admin
          UserApiController.set_user_active(req.body.username, req.body.active).then(async function(response) {
            // If a user was set to inactive, stop all of their running projects.
            if (req.body.active == 'false') {
              var projects = await ProjectApiController.get_running_projects_user(req.body.username);

              for (var p in projects) {
                ProjectApiController.set_project_status(projects[p].id, 0).then(function(response) {
                  //this.stop_bot(projects[p].id);
                  // @TODO
                });
              }
            }

            res.send('OK');
          });
        }
        else {
          res.send('USER_NOT_ADMIN');
        }
      }
      else {
        res.send('USER_NOT_FOUND');
      }
    });    
  });

  app.get('/api/get_dashboard', (req, res) => {
    res.status(200);

    // Return error message if not logged in
    if (req.session.username === undefined) {
      res.send('NOT_LOGGED_IN');
    }

    else {
      var data = {'username': req.session.username};

      UserApiController.get_user(req.session.username).then(function(user) {
        if (user !== null) {
          if (user.role == 99) { // admin, retrieve user accounts
            UserApiController.get_users().then(async function(users) {

              for (var u in users) {
                var projects = await ProjectApiController.get_running_projects_user(users[u].username);
                users[u].running_projects = projects.length;
              }

              data.users = users;
              res.send(JSON.stringify(data));
            });
          }
          else { // regular user, retrieve projects and settings
            ProjectApiController.get_projects(req.session.username).then(function(projects) {
              data.projects = projects;

              SettingsApiController.get_settings(req.session.username).then(function(settings) {
                data.settings = settings;
                res.send(JSON.stringify(data));
              });
            });
          }
        }
        // An invalid username is somehow in the session
        else {
          res.send('USER_NOT_FOUND');
        }
      });
    }
  });  

  app.post('/api/create_project', (req, res) => {
    ProjectApiController.create_project(req.session.username).then(function(response) {
      res.send(response);
    });
  });

  /**
   * API call: change a project's status (active/inactive)
   */
  app.post('/api/set_project_active', async (req, res) => {
    res.status(200);

    UserApiController.get_user(req.session.username).then(function(user) {
      if (user !== null) {
        if (user.role == 1) {
          ProjectApiController.get_project(req.body.projectid, req.session.username).then(function(response) {
            if (response != null) {
              if (response.status == 1) {
                // Stop project from running first.
                  //stop_bot(req.body.projectid);
              }

              if (!req.body.active) {
                // Make the project inactive
                ProjectApiController.set_project_active(req.body.projectid, req.body.active).then(function(response) {
                  res.send('OK');
                });                  
              }
              else {
                // @TODO: maybe at some point also make it possible to set the project back to active.
                res.send('NOK');
              }
            }
            else {
              res.send('NOK');
            }
          });
        }
        else {
          res.send('NOK');
        }
      }
      else {
        res.send('USER_NOT_FOUND');
      }
    });
  }); 

  /**
   * API call: change a project's status (active/inactive)
   */
  app.post('/api/import_project', upload.single('file'), async (req, res) => {
    // Source: https://medium.com/@ritikkhndelwal/getting-the-data-from-the-multipart-form-data-in-node-js-dc2d99d10f97 
    UserApiController.get_user(req.session.username).then(function(user) {
      if (user !== null) {
          console.log('=== IMPORT PROJECT ===');
          console.log(req.body);

          // Check if the project file directory exists
          if (!fs.existsSync('projects')) {
            fs.mkdirSync('projects');
          }

          // Remove the old project files
          let dir = 'projects/' + req.body.project_id;
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true });
          }
          fs.mkdirSync(dir);

          const zip = new AdmZip(req.file.path);
          var zipEntries = zip.getEntries(); // an array of ZipEntry records

          console.log(zipEntries);
    
          zipEntries.forEach(function (zipEntry) {
              if (zipEntry.entryName == "project.json") {
                  console.log('project file found');
                  // @TODO: import project file into database
                  //win.webContents.send('project-load', zipEntry.getData().toString("utf8"));
              }
              else {
                zip.extractEntryTo(zipEntry, dir);
              }
          });  

          // Remove the temporary file
          fs.rmSync(req.file.path);
      }
    });    
  });

  /**
   * API call: save a user's settings
   */
  app.post('/api/save_settings', async (req, res) => {
    res.status(200);

    UserApiController.get_user(req.session.username).then(function(user) {
      if (user !== null) {
        if (user.role == 1) {
          SettingsApiController.update_settings(req.session.username, req.body.settings).then(function(response) {
            res.send(response);
          });
        }
        else {
          res.send('NOK');
        }
      }
      else {
        res.send('USER_NOT_FOUND');
      }
    });
  });   

  
  const stop_bot = function(projectid) {
    console.log('stopping ' + projectid);
    // Check whether we are running in Docker or not
    if (process.env.TILBOT_PORT != undefined) {
      this.botlauncher.write('stop ' + projectid);
    }
    else {
      if (this.running_bots[projectid] !== undefined) {
        this.running_bots[projectid].send('exit');
      }
    }

    ProjectApiController.set_project_status(req.body.projectid, 0).then(function(response) {
    });
  }

  app.get('/api/sesh', (req, res) => {
    res.status(200);
    console.log(req.session);
  });


  // let SvelteKit handle everything else, including serving prerendered pages and static assets
  //app.use(handler);

  app.listen(3001, () => {
    console.log('listening on port 3001');
  });
    
});