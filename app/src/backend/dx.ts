/**
 * @fileOverview Methods for installing dx-toolkit and interacting with DNAnexus.
 **/

import {
  SuccessCallback,
  UpdateCallback,
  SJDTAFile,
  SJDTAProject,
} from "./types";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as utils from "./utils";
import * as logging from "./logging";
import * as child_process from "child_process";

const async = require("async");
const expandHomeDir = require("expand-home-dir");
const config = require("../../../config.json");

/**********************************************************
 *                 Utility Functionality                  *
 **********************************************************/

interface dxDownloadInfo {
  url: string;
  hash: string;
}

/**
 * Returns the URL and hash of the precompiled dx-toolkit 
 * for the platform passed in. The only platforms supported
 * are Mac, Windows, and Ubuntu flavored Linux. 
 * 
 * Unknown platform case handled in state.js.
 *
 * @see state.js
 * @param platform Name of the operating system.
 * @returns URL and hash of the download
 */
function dxToolkitDownloadInfo(platform: string): dxDownloadInfo {
  switch (platform) {
    case "darwin": return config.DOWNLOAD_INFO.MAC;
    case "ubuntu12": return config.DOWNLOAD_INFO.UBUNTU_12;
    case "ubuntu14": return config.DOWNLOAD_INFO.UBUNTU_14;
    case "win32": return config.DOWNLOAD_INFO.WINDOWS;
    default: throw new Error("Unrecognized platform: " + platform);
  }
}

/**********************************************************
 *                DX-Toolkit Functionality                *
 **********************************************************/

/**
 * Login to DNAnexus using an authentication token
 * via the dx command line utility.
 *
 * @param token Authentication token
 * @param callback
*/
export function login(token: string, callback: SuccessCallback): void {
  const cmd = `dx login --token ${token} --noprojects`;
  utils.runCommand(cmd, callback);
};

/**
 * Logout of DNAnexus via the dx command line utility.
 *
 * @param callback
*/
export function logout(callback: SuccessCallback): void {
  const cmd = "dx logout";
  utils.runCommand(cmd, callback);
};

/**
 * Describe a 'dx-item' as JSON via the dx command* line utility.
 *
 * @param dnanexusId The DNAnexus object identifier (ex: file-XXXXXX).
 * @param callback
 **/
export function describeDXItem(
  dnanexusId: string,
  callback: SuccessCallback
): void {
  let cmd = `dx describe ${dnanexusId} --json`;

  utils.runCommand(cmd, (err: any, stdout: any) => {
    if (!stdout) {
      callback(err, stdout);
      return;
    }

    callback(err, JSON.parse(stdout));
  });
};

/**
 * List all of the files available for download in a DNAnexus project.
 *
 * @param projectId The DNAnexus project identifier (ex: project-XXXX).
 * @param allFiles List all files or just St. Jude Cloud associated ones.
 * @param callback
 **/
export function listDownloadableFiles(
  projectId: string,
  allFiles: boolean,
  callback: SuccessCallback
): void {
  let cmd = `dx find data --path ${projectId}:/ --json --state closed --class file`;

  if (!allFiles) {
    cmd += ` --tag ${config.DOWNLOADABLE_TAG}`;
  }

  utils.runCommand(cmd, (err: any, stdout: any) => {
    callback(err, JSON.parse(stdout));
  });
};

/**
 * Download a file from DNAnexus.
 *
 * @param remoteFileId DNAnexus identifier of the file to be downloaded.
 *                     (ex: file-XXXX).
 * @param fileName Name of the downloaded file.
 * @param fileRawSize Size in bytes of the file, received from DNAnexus.
 * @param downloadLocation Folder for the downloaded file to reside.
 * @param updateCb To be called on each update to progress.
 * @param finishedCb To be called upon completion.
 * @return ChildProcess
*/
export function downloadDxFile(
  remoteFileId: string,
  fileName: string,
  fileRawSize: number,
  downloadLocation: string,
  updateCb: UpdateCallback,
  finishedCb: SuccessCallback
): child_process.ChildProcess {
  const platform = os.platform();
  const outputPath = expandHomeDir(path.join(downloadLocation, fileName));

  if (platform === "darwin" || platform === "linux") {
    utils.runCommandSync(`touch '${outputPath}'`);
  } else if (platform === "win32") {
    utils.runCommandSync(`New-Item '${outputPath}' -type file -force`);
  } else throw new Error(`Unknown platform: ${platform}.`);

  const cmd = `dx download -f ${remoteFileId} -o '${outputPath}'`;
  fs.watchFile(outputPath, { interval: 1000 }, () => {
    fs.stat(outputPath, (err: any, stats: any) => {
      if (stats !== undefined) {
        let progress = Math.round(stats.size / fileRawSize * 100.0);
        updateCb(progress);
      }
    });
  });

  return utils.runCommand(cmd, finishedCb);
};

/**
 * Creates an interval that watches a remote DX file.
 * 
 * @param file 
 * @param dxRemotePath 
 * @param progressCb 
 */
function watchRemoteFile(
  file: SJDTAFile,
  dxRemotePath: string,
  progressCb: UpdateCallback
) {
  return setInterval(() => {
    if (file.sizeCheckingLock) { return; }
    file.sizeCheckingLock = true; // acquire file size checking lock

    module.exports.describeDXItem(dxRemotePath, (err: any, remoteFile: any) => {
      file.sizeCheckingLock = false; // release file size checking lock
      if (!remoteFile || !remoteFile.parts) { return; }

      let remoteObjectSize: number = 0;
      // sum concurrent chunk sizes uploaded so far.
      for (let chunk in remoteFile.parts) {
        if (remoteFile.parts[chunk].size) {
          remoteObjectSize += remoteFile.parts[chunk].size;
        }
      }

      if (file.largestReportedProgress < remoteObjectSize) {
        remoteObjectSize = file.largestReportedProgress;
      } else {
        file.largestReportedProgress = remoteObjectSize;
      }

      let progress = remoteObjectSize / file.raw_size * 100.0;
      progressCb(progress);
    });
  }, utils.randomInt(500, 750)); // randomized interval for jitter.
}

/**
 * Uploads a file to a DNAnexus project via the dx command line utility.
 *
 * @param file File object from the Vuex store.
 * @param projectId DNAnexus ID of projectId being uploaded to.
 * @param progressCb
 * @param finishedCb
 * @return ChildProcess
*/
export function uploadFile(
  file: SJDTAFile,
  projectId: string,
  progressCb: UpdateCallback,
  finishedCb: SuccessCallback,
  remoteFolder: string = "/uploads",
): child_process.ChildProcess {
  const basename: string = path.basename(file.path.trim())
  const dxRemotePath: string = `${projectId}: ${remoteFolder} /${basename}`

  // If this fails, not a big deal. Just means there is no file at this path
  // to begin with.
  // TODO(clay): cleaner solution here. Ignoring this error seems hacky.
  try {
    utils.runCommandSync(`dx rm -a '${dxRemotePath}' || true`);
  } catch (e) { }

  // keep track of the largest reported progress to ensure that if callbacks
  // get out of order, the progress meter isn't jumping all around.
  file.largestReportedProgress = -1;
  let sizeCheckerInterval = watchRemoteFile(file, dxRemotePath, progressCb);

  // We wrap the last callback to ensure the file watcher interval is cleared
  // out before moving on.
  let finishedCbWrapper = (err: any, result: any) => {
    clearInterval(sizeCheckerInterval);
    finishedCb(err, result);
  };

  const uploadCmd = `dx upload -p --path '${dxRemotePath}' '${file.path}'`;
  return utils.runCommand(uploadCmd, (err: any, stdout: any) => {
    if (err) { return finishedCbWrapper(err, null); }

    const tagCmd = `dx tag '${dxRemotePath}' ${config.NEEDS_ANALYSIS_TAG}`;
    utils.runCommand(tagCmd, (err: any, stdout: any) => {
      if (err) { finishedCbWrapper(err, null); }
      finishedCbWrapper(null, stdout);
    });
  });
};

/**
 * Utility method to parse out projects from a 'dx find projects' command.
 * 
 * @param stdout STDOUT from a 'dx find projects' command.
 */
function parseDxProjects(
  stdout: string
): SJDTAProject[] {
  let results: SJDTAProject[] = [];

  // forEach is synchronous
  stdout.split("\n").forEach((el: string) => {
    if (el.trim().length <= 0) return;

    let _: string;
    let name: string;
    let dxLocation: string;
    let accessLevel: string;

    [dxLocation, name, accessLevel, _] = el.split("\t");
    if (accessLevel) {
      results.push({
        project_name: name,
        dx_location: dxLocation,
        access_level: accessLevel,
      });
    }
  });

  return results;
}
/**
 * Find and return projects the user can upload data to.
 *
 * @param allProjects should we limit to St. Jude Cloud
 *                    projects or list all projects?
 * @param callback
*/
export function listProjects(
  allProjects: boolean,
  callback: SuccessCallback
): void {
  // Setting tagsToCheck = [''] will run one command that does not filter any
  // tags. This is equivalent to checking all projects, not just SJCloud ones.
  let tagsToCheck = [''];
  let projects: SJDTAProject[] = [];
  let tabliteral = utils.getTabLiteral();

  if (!allProjects) {
    tagsToCheck = [
      config.TOOL_PROJECT_TAG,
      config.DATA_PROJECT_TAG
    ];
  }

  async.map(
    tagsToCheck,
    (tag: string, iteratorCallback: SuccessCallback) => {
      let iterCmd = `dx find projects --level UPLOAD --delim ${tabliteral}`;
      if (tag !== '') iterCmd += ` --tag ${tag}`;

      utils.runCommand(`${iterCmd}`, (err: any, stdout: string) => {
        if (err) { return iteratorCallback(err, []); }

        return iteratorCallback(null, parseDxProjects(stdout));
      });
    },
    (err: any, results: string[][]) => {
      if (err) { return callback(err, []); }

      // flatten 2d 'results' array to 1d.
      return callback(null, [].concat.apply([], results));
    }
  )
};

/**
 * Installs the dx-toolkit via the command line utility.
 *
 * @param updateProgress Function that updates on-screen progress bar.
 * @param callback Callback function.
*/
export function installDxToolkit(
  updateProgress: UpdateCallback,
  callback: SuccessCallback
) {
  let platform: string = os.platform().toString();
  if (platform === "linux") { platform = utils.getUbuntuVersionOrNull(); }
  if (!platform) throw new Error(`Unrecognized platform: ${platform}.`);

  const downloadInfo = dxToolkitDownloadInfo(platform);
  const downloadURL: string = downloadInfo.url;
  const expectedDownloadHash: string = downloadInfo.hash;

  const tmpdir = os.tmpdir();
  let dxToolkitDownloadPath = path.join(tmpdir, "dx-toolkit.tar.gz");
  if (platform === "win32") {
    dxToolkitDownloadPath = path.join(utils.getDXToolkitDir(), "dx-toolkit.exe");
  }

  const dxToolkitInstallDir = utils.getDXToolkitDir();
  const parentDir = path.dirname(dxToolkitInstallDir);

  // TODO(Clay): handle download failures throughout this whole block.

  updateProgress(["30%", "Downloading..."]);
  utils.downloadFile(downloadURL, dxToolkitDownloadPath, () => {
    updateProgress(["60%", "Verifying..."]);
    utils.computeSHA256(dxToolkitDownloadPath, (err: any, downloadHash: string) => {
      if (err) {
        return callback(true, `Could not verify download!\n\n${err}.`);
      }

      if (downloadHash !== expectedDownloadHash) {
        return callback(true, "Could not verify download (hash mismatch)!");
      }

      if (platform === "win32") {
        // For Windows, just execute the installer.
        updateProgress(["90%", "Installing..."]);
        setTimeout(() => {
          child_process.execSync(dxToolkitDownloadPath);
          updateProgress(["100%", "Success!"]);
          return callback(null, true);
        }, 500);
      } else {
        // for Mac + Linux, untar to correct place.
        updateProgress(["90%", "Extracting..."]);
        utils.untarTo(dxToolkitDownloadPath, parentDir, function (err: any, res: any) {
          if (err) {
            return callback(true, `Could not extract dx-toolkit!\n\n${err}.`);
          }

          updateProgress(["100%", "Success!"]);
          return callback(null, true);
        });
      }
    });
  });
};