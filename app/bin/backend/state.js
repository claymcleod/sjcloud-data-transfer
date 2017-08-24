/**
 * @fileOverview Determines what html page to display based on what requirements for uploading files are met.
 **/

const os = require("os");
const fs = require("fs");
const utils = require("./utils");

module.exports.state_to_route = {
  NEED_DOWNLOAD: {htmlfile: "download"},
  NEED_LOGIN: {htmlfile: "login"},
  UPLOAD: {htmlfile: "upload"},
  UNKNOWN: {htmlfile: "unknown"},
};

/**
 * Determines what route to use on startup.
 * 
 * @param {callback} callback Callback function
 * @return {string} html file to be loaded
 */
module.exports.getState = function(callback) {
  self = this;

  if (os.platform() != "darwin" && os.platform() != "linux" && os.platform() != "win32") {
    return callback(self.state.UNKNOWN);
  }

  utils.initSJCloudHome(function(err, res) {
    if (err) {
      return callback(self.state.UNKNOWN);
    }

    utils.dxToolkitOnPath( function(err, res) {
      if (err) {
        return callback(self.state.NEED_DOWNLOAD);
      }

      utils.dxLoggedIn( (err, res) => {
        if (err) {
          return callback(self.state.NEED_LOGIN);
        }

        utils.dxCheckProjectAccess( (err, res) => {
          if (err) {
            return callback(self.state.UNKNOWN);
          }

          return callback(self.state.UPLOAD);
        });
      });
    });
  });
};
