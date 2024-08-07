import { ProjectSchema } from '../db/project.js';
import { LogSchema } from '../db/log.js';
import { mongoose } from 'mongoose';
import crypto from 'crypto-js';

export class ProjectApiController {

    static ProjectDetails = mongoose.model('projectschemas', ProjectSchema);
    static LogDetails = mongoose.model('logschemas', LogSchema);

    /**
     * Managing users stored in the database.
     * @constructor
     */
    constructor() {

    }

    /**
     * Retrieve a project (@TODO: check for active only)
     *
     * @param {string} id - The project id to search for.
     * @param {string} username - The username that owns the project.
     * @return {ProjectSchema} The project object from database if found, otherwise null.
     */
    static get_project(id, username) {
        return new Promise(resolve => {
            this.ProjectDetails.findOne({ id: id, user_id: username, active: true }).then(function(project) {
                resolve(project);
            });
        });
    }    
        
    /**
     * Import a project, replacing the existing one
     *
     * @param {string} project - The project to import (JSON string).
     * @param {string} username - The username that owns the project.
     * @return {boolean} True if success, false if failed.
     */
    static import_project(project, project_id, username) {
        let self = this;

        return new Promise(resolve => {
            this.ProjectDetails.deleteOne({ id: project_id, user_id: username }).then(function(res) {

                if (res.deletedCount == 0) {
                    resolve(false);
                }
                else {
                    // Add new project
                    let newschema = self.ProjectDetails.fromModel(JSON.parse(project));
                    newschema.id = project_id;
                    newschema.user_id = username;

                    newschema.save().then(function(e) {
                        resolve(true);
                    }).catch(function(error) {
                        console.log(error);
                        resolve(false);
                    });    
                }
            });
        });
    }        
            
    /**
     * Retrieve all projects belonging to the current user from database.
     *
     * @param {string} user - The username that owns the projects.
     * @return {string[]} Array of projects present in database.
     */
    static get_projects(user) {
        return new Promise(resolve => {
            this.ProjectDetails.find({ user_id: user, active: true }).then(function(projects) {
                var projects_return = [];

                for (var p in projects) {
                    projects_return.push({
                        id: projects[p].id,
                        name: projects[p].settings.project_name,
                        status: projects[p].status
                    });
                }
    
                projects_return.sort((a, b) => (a.name > b.name) ? 1 : -1);
    
                resolve(projects_return);
            });
        });
    }

    /**
     * Retrieve all running projects belonging to the current user from database.
     *
     * @param {string} user - The username that owns the projects.
     * @return {string[]} Array of projects present in database.
     */
    static get_running_projects_user(user) {
        return new Promise(resolve => {
            this.ProjectDetails.find({ user_id: user, active: true, status: 1 }).then(function(projects) {
                var projects_return = [];
        
                for (var p in projects) {
                    projects_return.push({
                        id: projects[p].id,
                        name: projects[p].name,
                        status: projects[p].status
                    });
                }
        
                projects_return.sort((a, b) => (a.name > b.name) ? 1 : -1);

                resolve(projects_return);
            });
        });
    }        
        
    /**
     * Create a new account and store it in the database.
     *
     * @param {string} user - Username
     * @return {boolean} true if project created successfully, false if not.
     */
    static create_project(user) {
        return new Promise(resolve => {
            var p = new this.ProjectDetails();

            // Generate a unique id
            p.id = crypto.MD5('tb' + user + Date.now());
            p.user_id = user;
            p.status = 0; // paused by default
            p.settings.project_name = 'New project';

            p.save().then(function(e) {
                resolve('OK');
            }).catch(function(error) {
                resolve(error);
            });
        });
    }

    /**
     * Retrieve the socket for a particular project.
     *
     * @param {string} project_id - Project ID
     * @return {integer} Socket of the retrieved project, or -1 if the project is not found.
     */        
    static get_socket(project_id) {
        return new Promise(resolve => {
            this.ProjectDetails.findOne({ id: project_id, status: 1, active: true }).then(function(project) {
                if (project === null) {
                    resolve('-1');
                }
                else {
                    resolve(project.socket.toString());
                }
            });
        });
    }

    /**
     * Retrieve all running bots.
     *
     */        
    static get_running_projects() {
        return new Promise(resolve => {
            this.ProjectDetails.find({ status: 1, active: true }).then(function(projects) {
                resolve(projects);
            });
        });
    }        


    /**
     * Set the status of a project (running or paused).
     *
     * @param {string} project_id - Project ID
     * @return {integer} The status that the project should be set to (0 = paused, 1 = running)
     */        
    static set_project_status(project_id, status) {
        return new Promise(resolve => {
            // @TODO: active projects only
            this.ProjectDetails.findOne({ id: project_id, active: true }).then(function(project) {
                if (project === null) {
                    resolve('NOK');
                }
                else {
                    project.status = status;
                    project.save();
                    resolve('OK');
                }
            });
        });
    }
        
    /**
     * Set a project to active or inactive status.
     * Used to delete projects without permanently deleting them.
     * (Although this is hidden to the users)
     *
     * @param {string} project_id - Project ID
     * @param {boolean} active - true if needs to be set to active, false for inactive
     */    
    static set_project_active(project_id, active) {
        return new Promise(resolve => {
            this.ProjectDetails.findOne({ id: project_id }).then(function(schema) {
                if (schema != null) {
                    schema.active = active;
                    schema.save().then(function() {
                        resolve(active);
                    });            
                }
            });        
        });
    }

    /**
     * Retrieve a project's logs
     *
     * @param {string} id - The project id to search for.
     * @return {JSONObject} The logs in .csv format (2 files, one containing user's text one containing bot's text)
     */
    static get_logs(id) {
        return new Promise(resolve => {
            let to_return = "project_id;session_id;participant_id;session_start;session_end;message_source;message_time;message_content\r\n";

            this.LogDetails.find({ project_id: id }).then(function(logs) {
                for (var l in logs) {
                    for (var m in logs[l].messages) {
                        let started = new Date(logs[l].session_started);
                        let started_str = started.getFullYear() + '-' + ('0' + started.getMonth()).slice(-2) + '-' + ('0' + started.getDate()).slice(-2) + ' ' + ('0' + started.getHours()).slice(-2) + ':' + ('0' + started.getMinutes()).slice(-2) + ':' + ('0' + started.getSeconds()).slice(-2);
                        let ended = new Date(logs[l].session_closed);
                        let ended_str = ended.getFullYear() + '-' + ('0' + ended.getMonth()).slice(-2) + '-' + ('0' + ended.getDate()).slice(-2) + ' ' + ('0' + ended.getHours()).slice(-2) + ':' + ('0' + ended.getMinutes()).slice(-2) + ':' + ('0' + ended.getSeconds()).slice(-2);
                        let sent_at = new Date(logs[l].messages[m].sent_at);
                        let sent_at_str = sent_at.getFullYear() + '-' + ('0' + sent_at.getMonth()).slice(-2) + '-' + ('0' + sent_at.getDate()).slice(-2) + ' ' + ('0' + sent_at.getHours()).slice(-2) + ':' + ('0' + sent_at.getMinutes()).slice(-2) + ':' + ('0' + sent_at.getSeconds()).slice(-2);

                        to_return += id + ";" + logs[l]._id + ";" + logs[l].participant_id + ";" + started_str + ";" + ended_str + ";" + logs[l].messages[m].source + ";" + sent_at_str + ';"' + logs[l].messages[m].message.replace(/(\r\n|\n|\r)/gm, " ").replace('"', '') + '"' + "\r\n";
                    }
                }
                
                resolve(to_return);
            });
        });
    }   

    /**
     * Delete a project's logs
     *
     * @param {string} id - The project id to search for.
     * @return {boolean} True if success, false if failed.
     */
    static delete_logs(id) {
        return new Promise(resolve => {
            this.LogDetails.deleteMany({ project_id: id }).then(function() {
                resolve(true);
            });
        });
    }     
}