const vscode = require('vscode');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require("os")
const path = require("path")

let tmpFilePrefix = path.join(os.tmpdir(), "remote-file-compare-files-1703262838047.");

async function activate(context) {
  let compareFilesDisposable = vscode.commands.registerCommand('extension.compareFiles', async () => {
    let config = parseConfig();
    if(!config) {
      return;
    }

    let {sshConfig, remoteWorkspaceDir} = config;
    
    let localFilePath = await getLocalFilePath()
    let remoteFilePath = await getRemoteFilePath(remoteWorkspaceDir, localFilePath)

    let {localFilePathShort, remoteFilePathShort} = makeFileNamesShort(localFilePath, remoteFilePath)
    vscode.window.showInformationMessage(`Comparing ${sshConfig.host}:${remoteFilePathShort} with ${localFilePathShort} ...`)
    try {
      const format = localFilePath.split(".").pop()
      const tmpFilePath = tmpFilePrefix + format;
      await downloadRemoteFile(sshConfig, remoteFilePath, tmpFilePath);

      vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(localFilePath), vscode.Uri.file(tmpFilePath), `Local File ↔ ${sshConfig.host} File`);
    } catch (error) {
      console.error("Bade: ", error);
      vscode.window.showErrorMessage('Error comparing files. ' + error.message);
    }
  });

  let deployFileDisposable = vscode.commands.registerCommand('extension.deployFile', async () => {
    let config = parseConfig();
    if(!config) {
      return;
    }

    let {sshConfig, remoteWorkspaceDir} = config;

    let localFilePath = await getLocalFilePath()
    let remoteFilePath = await getRemoteFilePath(remoteWorkspaceDir, localFilePath)

    let {localFilePathShort, remoteFilePathShort} = makeFileNamesShort(localFilePath, remoteFilePath)
    vscode.window.showInformationMessage(`Deploying ${localFilePathShort} to ${sshConfig.host}:${remoteFilePathShort} ...`)

    try {
      await uploadLocalFile(sshConfig, localFilePath, remoteFilePath);
      vscode.window.showInformationMessage(`Deployed successfully to ${sshConfig.host}:${remoteFilePath}`);
    } catch (error) {
      console.error("Bade: ", error);
      vscode.window.showErrorMessage('Error deploying file. ' + error.message);
    }
  });

  context.subscriptions.push(compareFilesDisposable, deployFileDisposable);
}

async function getLocalFilePath() {
  let localFilePath = vscode.window?.activeTextEditor?.document?.uri?.fsPath;
  if(!localFilePath) {
    vscode.window.showWarningMessage('Could not find the local file. Choose manually.');
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select file',
      title: "No opened file found. Choose file manually"
    });
  
    if (!uris || uris.length === 0) {
      vscode.window.showWarningMessage('No file selected.');
      return;
    }
    localFilePath = uris[0].fsPath;
  }
  return localFilePath;
}

async function getRemoteFilePath(remoteWorkspaceDir, localFilePath) {
  const workspaceFolder = getWorkspaceFolder(localFilePath);
  const workspaceName = workspaceFolder.name || vscode.workspace.rootPath;

  let remoteFilePath = ""
  if(workspaceName && countSubstringOccurrences(localFilePath, workspaceName) === 1) {
    remoteFilePath = localFilePath.substring(localFilePath.indexOf(workspaceName) + workspaceName.length)
  }
  if(!remoteFilePath) {
    const userInput = await vscode.window.showInputBox({
      prompt: "Failed to generate remote path base on your current opened file. Input the absolute path of the remote file here:",
      placeHolder: 'Type here...'
    });
    remoteFilePath = userInput;
  }
  remoteFilePath = path.join(remoteWorkspaceDir, remoteFilePath);
  return remoteFilePath;
}

function makeFileNamesShort(localFilePath, remoteFilePath) {
  let localFilePathShort = localFilePath, remoteFilePathShort = remoteFilePath;
  if(localFilePathShort.length > 25) {
    localFilePathShort = localFilePathShort.slice(-25);
  }
  if(remoteFilePathShort.length > 25) {
    remoteFilePathShort = remoteFilePathShort.slice(-25);
  }

  return {localFilePathShort, remoteFilePathShort}
}

function countSubstringOccurrences(mainString, subString) {
  let count = 0;
  let index = mainString.indexOf(subString);

  while (index !== -1) {
    count++;
    index = mainString.indexOf(subString, index + 1);
  }

  return count;
}

function getWorkspaceFolder(filePath) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  // Find the first workspace folder that contains the file
  return workspaceFolders.find(folder => filePath.startsWith(folder.uri.fsPath));
}

function downloadRemoteFile(sshConfig, remoteFilePath, tmpFilePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return conn.end();
        }

        const writeStream = fs.createWriteStream(tmpFilePath, { encoding: 'utf-8' });

        sftp.createReadStream(remoteFilePath)
          .on('data', chunk => writeStream.write(chunk, 'utf-8'))
          .on('end', () => {
            writeStream.end();
            conn.end();
            resolve(tmpFilePath);
          })
          .on('error', err => {
            reject(err);
            conn.end();
          });
      });
    });
    conn.on("error", (err) => {
      reject(err)
    })

    conn.connect(sshConfig);
  });
}

function uploadLocalFile(sshConfig, localFilePath, remoteFilePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return conn.end();
        }

        const readStream = fs.createReadStream(localFilePath);

        const writeStream = sftp.createWriteStream(remoteFilePath)
          .on('close', () => {
            conn.end();
            resolve();
          })
          .on('error', err => {
            reject(err);
            conn.end();
          });

        readStream.pipe(writeStream);
      });
    });

    conn.connect(sshConfig);
  });
}

function getConfig() {
  return vscode.workspace.getConfiguration('bade');
}

function parseConfig() {
  const targets = getConfig().get("targets");
  if(!targets || !targets[0] || !targets[0].sshConfig || !targets[0].remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
    console.error("Bade: !targets || !targets[0] || !targets[0].sshConfig || !targets[0].remoteWorkspaceDir")
    console.error("Bade: The found config:" + JSON.stringify(targets))
    return null;
  }

  const sshConfig = targets[0].sshConfig;
  if(sshConfig.privateKey) {
    sshConfig.privateKey = fs.readFileSync(sshConfig.privateKey);
  }
  const remoteWorkspaceDir = targets[0].remoteWorkspaceDir

  if(!sshConfig || !remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
    console.error("Bade: !sshConfig || !remoteWorkspaceDir")
    return null;
  }

  return {sshConfig, remoteWorkspaceDir}
}

exports.activate = activate;
