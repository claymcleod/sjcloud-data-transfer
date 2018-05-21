/**
 * @module utils
 * @description Contains the various utility functions used in the application.
 **/

import {ChildProcess} from 'child_process';
import powershell from './powershell';
import {
  SuccessCallback,
  CommandCallback,
  ResultCallback,
  ErrorCallback,
} from './types';

const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mkdirp = require('mkdirp');
const _crypto = require('crypto');
const treeKill = require('tree-kill');

const {logging} = require('./logging');
const {remote, shell} = require('electron');
const {exec} = require('child_process');

/**
 * CONSTANTS
 */

export const platform = os.platform();
export const defaultDownloadDir = path.join(os.homedir(), 'Downloads');

interface StJudeCloudPaths {
  SJCLOUD_HOME?: string;
  ANACONDA_HOME?: string;
  ANACONDA_BIN?: string;
  ANACONDA_SJCLOUD_ENV?: string;
  ANACONDA_SJCLOUD_BIN?: string;
}

/**
 * Returns the various paths for SJ Cloud and Anaconda.
 *
 * @param sjcloudHomeDirectory SJ Cloud home path saved in the application, if any
 * @param thePlatform Platform the application is running on
 */
export function getSJCloudPaths(
  sjcloudHomeDirectory: string = null,
  thePlatform: string = platform
): StJudeCloudPaths {
  let result: StJudeCloudPaths = {};

  if (!sjcloudHomeDirectory) {
    sjcloudHomeDirectory = path.join(os.homedir(), '.sjcloud');
  }

  result.SJCLOUD_HOME = sjcloudHomeDirectory;
  result.ANACONDA_HOME = path.join(sjcloudHomeDirectory, 'anaconda');
  result.ANACONDA_BIN =
    thePlatform === 'win32'
      ? path.join(result.ANACONDA_HOME, 'Scripts')
      : path.join(result.ANACONDA_HOME, 'bin');
  result.ANACONDA_SJCLOUD_ENV = path.join(
    result.ANACONDA_HOME,
    'envs',
    'sjcloud'
  );
  result.ANACONDA_SJCLOUD_BIN = path.join(result.ANACONDA_SJCLOUD_ENV, 'bin');

  return result;
}

/**
 * Checks if given path exists in the list of SJ Cloud paths.
 *
 * @param pathProperName The path to lookup
 * @param sjcloudHomeDirectory The SJ Cloud paths
 */
export function lookupPath(
  pathProperName: string,
  sjcloudHomeDirectory: string = null
): string {
  const paths = getSJCloudPaths(sjcloudHomeDirectory);
  return pathProperName in paths ? (paths as any)[pathProperName] : null;
}

/**
 * Creates the ~/.sjcloud directory if it doesn't already exist.
 * Callback takes args (error, created_dir) to determine whether this is the
 * user's first time to run the app.
 *
 * @param {SuccessCallback} callback Returns (error, was directory created?)
 * @param {string?} directory Directory for SJCloud home if not default.
 */
export function initSJCloudHome(
  callback: SuccessCallback,
  sjcloudHomeDirectory: string = null
): void {
  sjcloudHomeDirectory = lookupPath('SJCLOUD_HOME', sjcloudHomeDirectory);
  fs.stat(sjcloudHomeDirectory, function(statErr: any, stats: any) {
    if (statErr || !stats) {
      mkdirp(sjcloudHomeDirectory, function(mkdirErr: any) {
        if (mkdirErr) {
          return callback(mkdirErr, null);
        }

        return callback(null, true);
      });
    } else {
      return callback(null, false);
    }
  });
}

/**
 * Return the boostrapping command on a UNIX machine. This will inject the
 * correct binaries on the PATH based on what has been successfully installed
 * up until this point.
 *
 * @returns {string} A command with the correct sources and PATH variable.
 */
function unixBootstrapCommand(): string {
  let paths = [];

  try {
    let stats = fs.statSync(lookupPath('ANACONDA_SJCLOUD_BIN'));
    if (stats) {
      paths.push(lookupPath('ANACONDA_SJCLOUD_BIN'));
    }
  } catch (err) {
    /* ignore */
  }

  try {
    let stats = fs.statSync(lookupPath('ANACONDA_BIN'));
    if (stats) {
      paths.push(lookupPath('ANACONDA_BIN'));
    }
  } catch (err) {
    /* ignore */
  }

  return paths.length != 0 ? `export PATH="${paths.join(':')}:$PATH";` : null;
}

/**
 * Return the boostrapping command on a Windows machine. This will inject the
 * correct binaries on the PATH based on what has been successfully installed
 * up until this point.
 *
 * @returns {string} A command with the correct sources and PATH variable.
 */
function windowsBootstrapCommand(): string {
  let paths = [];

  try {
    let stats = fs.statSync(lookupPath('ANACONDA_BIN'));
    if (stats) {
      paths.push(lookupPath('ANACONDA_BIN'));
    }
  } catch (err) {
    /* ignore */
  }

  try {
    let stats = fs.statSync(lookupPath('ANACONDA_SJCLOUD_ENV'));
    if (stats) {
      paths.push(lookupPath('ANACONDA_SJCLOUD_ENV'));
    }
  } catch (err) {
    /* ignore */
  }

  return paths.length != 0
    ? `$ENV:PATH="${paths.join(';')};"+$ENV:PATH;`
    : null;
}

/**
 * Run a command on the Unix platform.
 *
 * @param {string} cmd The command to be run.
 * @param {CommandCallback} innerCallback Callback to process the command output.
 */
function runCommandUnix(
  cmd: string,
  innerCallback: CommandCallback
): ChildProcess {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(`Invalid platform for 'runCommandUnix': ${platform}`);
  }

  let bootstrapCommand = unixBootstrapCommand();
  if (bootstrapCommand) {
    cmd = `${bootstrapCommand} ${cmd}`;
  }

  cmd = `/usr/bin/env bash -c '${cmd}'`;
  logging.silly(cmd);
  return exec(cmd, {maxBuffer: 10000000}, innerCallback);
}

/**
 * Run a command on the Windows platform.
 *
 * @param {string} cmd The command to be run.
 * @param {CommandCallback} innerCallback Callback to process the command output.
 */
function runCommandWindows(
  cmd: string,
  innerCallback: CommandCallback
): ChildProcess {
  if (platform !== 'win32') {
    throw new Error(`Invalid platform for 'runCommandWindows': ${platform}`);
  }

  const bootstrapCommand = windowsBootstrapCommand() || '';
  cmd = `${bootstrapCommand}; ${cmd}`;

  logging.silly(cmd);

  return powershell(cmd, innerCallback);
}

/**
 * Runs command based on the system.
 *
 * @param {string} cmd Text to be entered at the command line
 * @param {SuccessCallback} callback
 * @param {boolean} [raiseOnStderr=true] Raise an error if we see anything on stderr.
 * @return {string}
 */
export function runCommand(
  cmd: string,
  callback: SuccessCallback,
  raiseOnStderr: boolean = true
): ChildProcess {
  const innerCallback = function(err: any, stdout: string, stderr: string) {
    if (err) {
      logging.error(err);
      return callback(err, null);
    }

    if (raiseOnStderr && stderr && stderr.length > 0) {
      logging.error(stderr);
      return callback(stderr, null);
    }

    if (stdout.trim() === 'False') {
      /** Powershell sometimes just returns False */
      return callback(new Error('STDOUT was False'), null);
    }

    return callback(null, stdout);
  };

  if (platform === 'darwin' || platform === 'linux') {
    return runCommandUnix(cmd, innerCallback);
  } else if (platform === 'win32') {
    return runCommandWindows(cmd, innerCallback);
  } else throw new Error(`Unrecognized platform: ${platform}.`);
}

/**
 * Parse Python version from a string. Presumably, output from 'python --version'.
 * @param versionString String to parse Python version from
 * @returns A tuple containing [majorNum, minorNum, patchNum]
 */
export function parsePythonVersion(versionString: string) {
  const regex = /Python ([0-9]+).([0-9]+).([0-9]+)/;
  let match = regex.exec(versionString);

  if (!match) {
    throw new Error(
      `Could not parse Python version from string '${versionString}'`
    );
  }

  let [full, major, minor, patch] = match;
  return [parseInt(major), parseInt(minor), parseInt(patch)];
}

/**
 * Determines if Python 2.7.13+ is accessible on the PATH.
 *
 * @todo Change callback to SuccessCallback
 * @param {ResultCallback} callback
 */
export function pythonOnPath(callback: ResultCallback): void {
  runCommand('python --version', (err, res) => {
    let majorNum: number, minorNum: number, patchNum: number;
    [majorNum, minorNum, patchNum] = parsePythonVersion(err);
    return callback(majorNum === 2 && minorNum === 7 && patchNum >= 13);
  });
}

/**
 * Determines if dx-toolkit is accessible on the PATH.
 *
 * @param {SuccessCallback} callback
 */
export function dxToolkitInstalled(callback: SuccessCallback): void {
  const dxLocation = path.join(lookupPath('ANACONDA_SJCLOUD_BIN'), 'dx');
  if (platform === 'linux' || platform === 'darwin') {
    runCommand(`[ -f ${dxLocation} ]`, callback);
  } else if (platform === 'win32') {
    runCommand(`[System.IO.File]::Exists("${dxLocation}") `, callback);
  }
}

/**
 * Downloads a normal file. Downloading of a DXFile is in dx.js
 *
 * @param {string} url URL of download.
 * @param {string} dest Path for newly downloaded file.
 * @see dx:downloadDxFile
 */
export function downloadFile(url: string, dest: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let file = fs.createWriteStream(dest);
    file.on('error', (error: any) => {
      reject(error);
    });

    file.on('finish', () => {
      file.close();
      resolve(true);
    });

    https.get(url, (res: any) => {
      res.pipe(file);
    });
  });
}

/**
 * Untars a file to the specified location.
 *
 * @param {string} filepath Path to TAR file.
 * @param {string} destParentDir Path to the parent directory of TAR content.
 * @param {SuccessCallback} callback
 */
export function untarTo(
  filepath: string,
  destParentDir: string,
  callback: SuccessCallback
): void {
  runCommand(`tar - C ${destParentDir} -zxf ${filepath} `, callback);
}

export const computeMd5 = (pathname: string): Promise<string> => {
  return new Promise(resolve => {
    const hash = _crypto.createHash('md5');
    const reader = fs.ReadStream(pathname);

    reader.on('data', (chunk: any) => {
      hash.update(chunk);
    });

    reader.on('end', () => {
      const hexDigest = hash.digest('hex');
      resolve(hexDigest);
    });
  });
};

/**
 * Computes the SHA256 sum of a given file.
 *
 * @todo No error possible in callback, the calculation needs to be checked
 *       for success.
 * @param {string} filepath Path to file being checksummed
 * @param {SuccessCallback} callback
 */
export function computeSHA256(
  filepath: string,
  callback: SuccessCallback
): void {
  let shasum = _crypto.createHash('SHA256');

  if (!fs.existsSync(filepath)) {
    throw new Error(`${filepath} does not exist!`);
  }

  if (!fs.lstatSync(filepath).isFile()) {
    throw new Error(`${filepath} is not a file!`);
  }

  let s = fs.ReadStream(filepath);
  s.on('data', (chunk: object) => {
    shasum.update(chunk);
  });
  s.on('end', () => {
    const result = shasum.digest('hex');
    return callback(null, result);
  });
}

/**
 * Opens a URL in the default, external browser (in other words, not inside
 * of the electron window).
 *
 * @param {string} url URL to open
 *****************************************************************************/
export function openExternal(url: string): void {
  shell.openExternal(url);
}

/**
 * Open a file dialog that can be used to select a directory.
 *
 * @param {ResultCallback} callback
 * @param {string} [defaultPath=undefined]
 */
export function openDirectoryDialog(
  callback: ResultCallback,
  defaultPath: string = null
): void {
  return callback(
    remote.dialog.showOpenDialog({
      buttonLabel: 'Select',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
    })
  );
}

/**
 * Open a file dialog that can be used to select a file.
 *
 * @param {ResultCallback} callback
 */
export function openFileDialog(callback: ResultCallback) {
  return callback(
    remote.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    })
  );
}

/**
 * Returns a readable size from a raw byte count.
 *
 * Base function derived from stack overflow.
 * Credit: https://stackoverflow.com/a/14919494
 *
 * @param {number} bytes number of bytes
 * @param {boolean} [roundNumbers=false] round the output numbers
 * @param {number} [divisor=1000] how many bytes are in one 'unit'? Usually,
 *                                this is 1000 or 1024.
 * @return {string} Human-readable size.
 */
export function readableFileSize(
  bytes: number,
  roundNumbers: boolean = false,
  divisor: number = 1000
): string {
  if (isNaN(bytes) || bytes === 0) {
    return '0 GB';
  }

  let byteCount = Math.abs(bytes);
  if (byteCount < divisor) {
    return Math.round(byteCount) + ' B';
  }

  let units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let u = -1;

  do {
    byteCount /= divisor;
    ++u;
  } while (byteCount >= divisor && u < units.length - 1);

  let number = byteCount.toFixed(1);
  if (roundNumbers) {
    number = Math.round(parseFloat(number)).toString();
  }
  return number + ' ' + units[u];
}

/**
 * Return the basename and size of a file from the path.
 *
 * @param {string} filepath Path where the file resides.
 * @param {boolean} [checked=false] Whether the entry should start out checked.
 * @return {object} object containing name and size properties.
 */
export function fileInfoFromPath(
  filepath: string,
  checked: boolean = false
): object {
  const name = path.basename(filepath);
  const size = fs.statSync(filepath).size;
  return {
    name,
    path: filepath,
    size: readableFileSize(size),
    raw_size: size,
    status: 0,
    checked,
    waiting: false,
    started: false,
    finished: false,
  };
}

/**
 * Generate a random number between min and max.
 *
 * @param {number} min minimum number
 * @param {number} max maximum number
 * @return {number} random integer.
 */
export function randomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Kills an entire process tree using a 3rd party package.
 *
 * @param {number} pid PID of the process to kill.
 */
export function killProcess(pid: number): void {
  return treeKill(pid);
}

/**
 * Reset a file object's status in Vuex.
 * @todo move to a more appropriate location.
 * @param {any} file File object
 */
export function resetFileStatus(file: any): void {
  file.status = 0;
  file.waiting = false;
  file.started = false;
  file.finished = false;
  file.errored = false;
}

/**
 * Saves some contents to a file in the SJCloud directory.
 *
 * @param {string} filename name of the file.
 * @param {string} content contents of the file.
 * @param {ErrorCallback} [callback=undefined]
 */
export function saveToSJCloudFile(
  filename: string,
  content: string,
  callback: ErrorCallback = undefined
): void {
  const dest = path.join(lookupPath('SJCLOUD_HOME'), filename);
  fs.writeFile(dest, content, callback);
}

/**
 * Reads a file from the SJCloud directory's contents.
 *
 * @todo Should the error case be a SuccessCallback rather than a return?
 * @param filename name of the file
 * @param callback results of the SJCloud file
 * @param defaultContent
 */
export function readSJCloudFile(
  filename: string,
  callback: ResultCallback,
  defaultContent: any = null
): void {
  const dest = path.join(lookupPath('SJCLOUD_HOME'), filename);
  fs.readFile(dest, (err: any, data: any) => {
    if (err) {
      if (!defaultContent) return;
    }
    callback(data ? data.toString() : defaultContent);
  });
}

/**
 * Gets the appropriate tab literal character based on the platform.
 */
export function getTabLiteral() {
  if (platform === 'darwin' || platform === 'linux') {
    return "$'\\t'";
  } else if (platform === 'win32') {
    return '`t';
  } else throw new Error('Unrecognized platform: ${platform}.');
}

export function selfSigned(callback: SuccessCallback) {
  const selfsigned = require('selfsigned');
  return selfsigned.generate({}, {days: 1}, callback);
}

/**
 * Utility timer class to time different parts of the application.
 */
export class Timer {
  start_time: number;
  stop_time: number;

  /**
   * @constructor
   */
  constructor() {}
  start() {
    this.start_time = performance.now();
  }

  stop() {
    this.stop_time = performance.now();
  }

  duration() {
    if (this.start_time == null && this.stop_time == null) return -1;
    return Math.round(this.stop_time - this.start_time);
  }
}

/**
 * Creates a native dialog box asking if the user wants to send a bug report.
 *
 * @param {Error} err
 */
export function reportBug(err: Error) {
  logging.debug(err);
  remote.dialog.showMessageBox(
    {
      type: 'error',
      buttons: ['Report Bug', 'Cancel'],
      title: err.name,
      message:
        "We've encountered an error. If you'd like to help us resolve it, " +
        'file a report with a brief description of the problem ' +
        'and the following text.',
      detail: err.stack,
    },
    response => {
      if (response === 0) {
        // 'Report Bug' selected
        openExternal('https://stjude.cloud/contact');
      } else {
        // 'Cancel' selected
      }
    }
  );
}
