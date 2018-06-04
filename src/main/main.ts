/**
 * @file Main entrypoint for the SJCP Data Upload tool.
 *       This file includes all functionality for bootstrapping
 *       the application, handling events, and logging.
 */

// First, check that NODE_ENV is set correctly or fail.
import * as env from './env';
env.checkIsValidOrFail();

import * as os from 'os';
import { app, Menu as menu, BrowserWindow } from 'electron';

import * as ui from './window';
import config from './config';
import { logging, logLevel } from './logging';

const platform = os.platform();
const nodeEnvironment = env.getEnv();

logging.info('');
logging.info(' ###############################################');
logging.info(' # Starting the SJCP Data Transfer Application #');
logging.info(' ###############################################');
logging.info('');
logging.info(' == Startup Information ==');
logging.info('   [*] Environment: ' + nodeEnvironment);
logging.info('   [*] Log Level: ' + logLevel);
logging.debug('   [*] Configuration:');
for (let elem in config) {
  logging.debug(`       [-] ${elem}: ${config[elem]}`);
}
logging.debug('   [*] Process arguments:');
process.argv.forEach((elem, index) => {
  logging.debug('       [-] ' + index + ': ' + elem);
});
logging.info('');
logging.info(' == Bootstrapping Environment ==');
const ipc = require('./ipc');
const protocol = require('./protocol');

/**
 * START PROGRAM.
 *
 * Below, you will see two variables. It is crucial that you understand
 * how these two variables work based on electron's application lifecycle.
 *
 *   mainWindow: this is the window object that holds all of the content
 *               for the application.
 *   startupOptions: this variable catches all of the relevant information
 *                   in the event based methods below for parsing by the 'ready'
 *                   event.
 */

let mainWindow: BrowserWindow;
let startupOptions = {};

/**
 * Performs commands to bootstrap the main window.
 * @param {*} mainWindow The window.
 */
function bootstrapWindow(mainWindow: BrowserWindow) {
  mainWindow.loadURL(`file://${__dirname}/../index.html`);

  if (!config.CHROMIUM_MENU) {
    logging.debug('Production menu enabled (chromium menu disabled).');
    const { menuConfig } = require('./menu');
    menu.setApplicationMenu(menu.buildFromTemplate(menuConfig));
  } else {
    logging.debug('Chromium menu enabled (production menu disabled).');
  }

  if (nodeEnvironment === 'production' && config.AUTOUPDATE_ENABLED === true) {
    const autoupdater = require('./autoupdate');
    autoupdater.startUpdateClient();
  }

  logging.info('');
}

/**
 * Ensure that a main window exists.
 *
 * @param {function} callback
 */
function ensureWindow(callback = undefined) {
  // If the app isn't 'ready', we can't create a window.
  if (!app.isReady()) {
    return;
  }

  if (
    mainWindow === null ||
    mainWindow === undefined ||
    mainWindow.isDestroyed()
  ) {
    ui.createWindow((err, mw) => {
      mainWindow = mw;
      bootstrapWindow(mainWindow);
      if (callback !== undefined) {
        return callback();
      }
    });
  }
}

app.on('ready', () => {
  ensureWindow(() => {
    // Handle open-url event.
    let uriCommand = '';

    if (platform === 'win32') {
      uriCommand = protocol.handleURIWindows();
    } else if (startupOptions.open_url_event_occurred) {
      uriCommand = protocol.handleURIMac(
        startupOptions.open_url_event,
        startupOptions.open_url_url,
      );
    }

    if (uriCommand) {
      logging.silly(`Running JS command: ${uriCommand}`);
      mainWindow.webContents.executeJavaScript(
        "window.setCurrPath = 'upload';",
      );
      mainWindow.webContents.executeJavaScript(uriCommand);
    }
  });
});

app.on('activate', () => {
  ensureWindow();
});

app.on('open-url', (event, url) => {
  if (!app.isReady()) {
    // this will execute if the application is not open.
    startupOptions.open_url_event_occurred = true;
    startupOptions.open_url_event = event;
    startupOptions.open_url_url = url;
  } else {
    uriCommand = protocol.handleURIMac(event, url);

    if (uriCommand !== '') {
      ensureWindow(() => {
        logging.silly(`Running JS command: ${uriCommand}`);
        mainWindow.webContents.executeJavaScript("window.currPath = 'upload';");
        mainWindow.webContents.executeJavaScript(uriCommand);
        mainWindow.webContents.executeJavaScript(
          "window.VueApp.$store.dispatch('updateToolsFromRemote', true);",
        );
      });
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on(
  'certificate-error',
  (event, webContents, url, error, certificate, callback) => {
    if (url.startsWith('https://localhost:4433/authcb?code=')) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  },
);
