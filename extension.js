const vscode = require('vscode');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require("os")
const path = require("path")

let tmpFilePrefix = path.join(os.tmpdir(), "remote-file-compare-files-1703262838047.");

function activate(context) {
  const config = getConfig();
  if(!config || !config.targets || !config.targets[0] || !config.targets[0].sshConfig || !config.targets[0].remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
  }
  
  const sshConfig = config.targets[0].sshConfig;
  const remoteWorkspaceDir = config.targets[0].remoteWorkspaceDir

  if(!sshConfig || !remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
    return;
  }

  let compareFilesDisposable = vscode.commands.registerCommand('extension.compareFiles', async () => {
    let localFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
    if(!localFilePath) {
      const userInput = await vscode.window.showInputBox({
        prompt: "No opened file found. Input the path of your local file here:",
        placeHolder: 'Type here...'
      });
      localFilePath = userInput;
    }
    const format = localFilePath.split(".").pop()
    const tmpFilePath = tmpFilePrefix + format;
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

    let remoteFilePathShort = remoteFilePath, localFilePathShort = localFilePath;
    if(remoteFilePathShort.length > 25) {
      remoteFilePathShort = remoteFilePathShort.slice(-25);
    }
    if(localFilePathShort.length > 25) {
      localFilePathShort = localFilePathShort.slice(-25);
    }
    vscode.window.showInformationMessage(`Comparing ${sshConfig.host}:${remoteFilePathShort} with ${localFilePathShort} ...`)
    try {
      // const localFileContent = fs.readFileSync(localFilePath, 'utf-8');
      await downloadRemoteFile(sshConfig, remoteFilePath, tmpFilePath);

      // Show a side-by-side comparison
      vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(localFilePath), vscode.Uri.file(tmpFilePath), `Local File ↔ ${sshConfig.host} File`);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error comparing files. ' + error.message);
    }
  });

  let deployFileDisposable = vscode.commands.registerCommand('extension.deployFile', async () => {
    let localFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
    if(!localFilePath) {
      const userInput = await vscode.window.showInputBox({
        prompt: "No opened file found. Input the path of your local file here:",
        placeHolder: 'Type here...'
      });
      localFilePath = userInput;
    }
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

    let remoteFilePathShort = remoteFilePath, localFilePathShort = localFilePath;
    if(remoteFilePathShort.length > 25) {
      remoteFilePathShort = remoteFilePathShort.slice(-25);
    }
    if(localFilePathShort.length > 25) {
      localFilePathShort = localFilePathShort.slice(-25);
    }
    vscode.window.showInformationMessage(`Deploying ${localFilePathShort} to ${sshConfig.host}:${remoteFilePathShort} ...`)

    try {
      await uploadLocalFile(sshConfig, localFilePath, remoteFilePath);
      vscode.window.showInformationMessage(`Uploaded successfully to ${sshConfig.host}:${remoteFilePath}`);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error deploying file. ' + error.message);
    }
  });

  context.subscriptions.push(compareFilesDisposable, deployFileDisposable);
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
  return vscode.workspace.getConfiguration().get('bade');
}

exports.activate = activate;
