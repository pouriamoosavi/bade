const vscode = require('vscode');
const fs = require('fs');
const { Client } = require('ssh2');
const sshConfig = require('./config').sshConfig;
const remoteWorkspaceDir = require('./config').remoteWorkspaceDir
const os = require("os")
const path = require("path")

let tmpFilePrefix = path.join(os.tmpdir(), "remote-file-compare-files-1703262838047.");

function activate(context) {
  let disposable = vscode.commands.registerCommand('extension.compareFiles', async () => {
    const localFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
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
    if(remoteFilePathShort.length > 30) {
      remoteFilePathShort = remoteFilePathShort.slice(-30);
    }
    if(localFilePathShort.length > 30) {
      localFilePathShort = localFilePathShort.slice(-30);
    }
    vscode.window.showInformationMessage(`Comparing ${sshConfig.host}:"` + remoteFilePathShort + '" with local:"' + localFilePathShort + '"...')
    try {
      // const localFileContent = fs.readFileSync(localFilePath, 'utf-8');
      await downloadRemoteFile(sshConfig, remoteFilePath, tmpFilePath);

      // Show a side-by-side comparison
      vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(localFilePath), vscode.Uri.file(tmpFilePath), 'Local File ↔ Remote File');
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error comparing files. ' + error.message);
    }
  });

  context.subscriptions.push(disposable);
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

    conn.connect(sshConfig);
  });
}


exports.activate = activate;
