const vscode = require('vscode');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require("os")
const path = require("path")

let tmpFilePrefix = path.join(os.tmpdir(), "remote-file-compare-files-1703262838047.");
let config = null;
let selectedDocumentUri = null; // Store selected document URI during command execution

async function showProgressMessage(message) {
  return new Promise((mainResolve, mainReject) => {
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: false
    }, (progress, token) => {
        return new Promise(resolve => {
          mainResolve(resolve)
        });
    });
  })
}

async function activate(context) {
  let compareFilesDisposable = vscode.commands.registerCommand('extension.compareFiles', async () => {
    await parseConfig();
    if(!config) {
      return;
    }
    
    let localFilePath = await getLocalFilePath()
    let remoteFilePath = await getRemoteFilePath(localFilePath)

    let {localFilePathShort, remoteFilePathShort} = makeFileNamesShort(localFilePath, remoteFilePath)
    const closeComparingMessage = await showProgressMessage(`Comparing ${config.sshConfig.host}:${remoteFilePathShort} with ${localFilePathShort} ...`)
    try {
      const format = localFilePath.split(".").pop()
      const tmpFilePath = tmpFilePrefix + format;
      await downloadRemoteFile(remoteFilePath, tmpFilePath);

      vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(tmpFilePath), vscode.Uri.file(localFilePath), `${config.sshConfig.host} ↔ Local`);
    } catch (err) {
      console.error("Bade: ", err);
      if(err.code === 2) { // No such file error
        vscode.window.showErrorMessage("Error comparing files. Couldn't find this file on the remote.");
      } else {
        vscode.window.showErrorMessage('Error comparing files. ' + err.message);
      }
    } finally {
      closeComparingMessage();
      selectedDocumentUri = null; // Clear stored document URI when command completes
    }
  });

  let deployFileDisposable = vscode.commands.registerCommand('extension.deployFile', async () => {
    await parseConfig();
    if(!config) {
      return;
    }

    let localFilePath = await getLocalFilePath()
    let remoteFilePath = await getRemoteFilePath(localFilePath)

    let {localFilePathShort, remoteFilePathShort} = makeFileNamesShort(localFilePath, remoteFilePath)
    const closeDeployMessage = await showProgressMessage(`Deploying ${localFilePathShort} to ${config.sshConfig.host}:${remoteFilePathShort} ...`)
    try {
      const dirName = path.dirname(remoteFilePath)
      const dirExists = await checkIfRemoteDirExists(dirName);
      let cont = false;
      if(!dirExists) {
        const response = await vscode.window.showWarningMessage(
          `The remote does not have this directory "${dirName}". Create it?`,
          { modal: true },
          'Yes (continue)',
        );
    
        if (response === 'Yes (continue)') {
          await recursiveRemoteMkdir(dirName)
          cont = true;
        }
      } else {
        cont = true;
      }

      if(cont) {
        await uploadLocalFile(localFilePath, remoteFilePath);
      }
    } catch (err) {
      console.error("Bade: ", err);
      vscode.window.showErrorMessage('Error deploying file. ' + err.message);
    } finally {
      closeDeployMessage();
      selectedDocumentUri = null; // Clear stored document URI when command completes
    }
  });

  context.subscriptions.push(compareFilesDisposable, deployFileDisposable);
}

async function getLocalFilePath() {
  // Use the stored document URI if available (from getConfig/getDocumentUri)
  // Otherwise try active editor, then prompt
  let localFilePath = null;
  
  if (selectedDocumentUri) {
    localFilePath = selectedDocumentUri.fsPath;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      localFilePath = editor.document.uri.fsPath;
      selectedDocumentUri = editor.document.uri;
    }
  }

  if(!localFilePath) {
    const documentUri = await getDocumentUri();
    if (!documentUri) {
      vscode.window.showWarningMessage('No file selected.');
      return;
    }
    localFilePath = documentUri.fsPath;
  }
  
  return localFilePath;
}

async function getRemoteFilePath(localFilePath) {
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
  remoteFilePath = remoteFilePath.replace(/\\/ig, "/") // for windows. convert all \\ to / to work on linux server
  remoteFilePath = remoteFilePath.replace(/^(\/)*/ig, "") // to remove the first / because we are adding it in the line bellow
  remoteFilePath = config.remoteWorkspaceDir.replace(/\/$/ig, "") + "/" + remoteFilePath
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

function downloadRemoteFile(remoteFilePath, tmpFilePath) {
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

    conn.connect(config.sshConfig);
  });
}

function uploadLocalFile(localFilePath, remoteFilePath) {
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

    conn.connect(config.sshConfig);
  });
}

function checkIfRemoteDirExists(dirName) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return conn.end();
        }

        sftp.stat(dirName, (err, stats) => {
          conn.end();
          if(err) {
            return resolve(false)
          } else if (stats) {
            return resolve(true)
          } else {
            return resolve(false)
          }
        })
      });
    });

    conn.connect(config.sshConfig);
  });
}

async function asyncMkdir(sftp, dirName) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dirName, (err) => {
      if(err) {
        return reject(err)
      }

      return resolve(true);
    })
  })
}

function recursiveRemoteMkdir(dirName) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp(async (err, sftp) => {
        if (err) {
          reject(err);
          return conn.end();
        }
        const parts = dirName.split('/');
        for (let i = 0; i < parts.length; i++) {
          const part = parts.slice(0, i + 1).join('/');
          if(!part.startsWith(config.remoteWorkspaceDir)/* || part == config.remoteWorkspaceDir */) {
            // Create directories only inside remoteDir.
            continue;
          }

          try {
            await asyncMkdir(sftp, part);
          } catch (err) {
            console.error(err)
            if (err.code !== 4) { // Ignore "Directory already exists" error
              return reject(err);
            }
          }
        }

        conn.end()
        return resolve(true)
      });
    });

    conn.connect(config.sshConfig);
  });
}

async function getDocumentUri() {
  // First check if we have a stored document URI from a previous selection
  if (selectedDocumentUri) {
    return selectedDocumentUri;
  }

  // Then check if there's an active text editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    selectedDocumentUri = editor.document.uri;
    return selectedDocumentUri;
  }

  // If no active editor, prompt user to select a file
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Select file',
    title: "No opened file found. Choose file to deploy or compare"
  });

  if (!uris || uris.length === 0) {
    return null;
  }

  // Store the selected URI for reuse during this command execution
  selectedDocumentUri = uris[0];
  return selectedDocumentUri;
}

async function getConfig() {
  const documentUri = await getDocumentUri();
  if (!documentUri) return null;
  return vscode.workspace.getConfiguration(
    "bade",
    documentUri
  )
}

async function parseConfig() {
  config = null; // set it to null so if we return in the middle of this function, we can detect it in the parent function
  selectedDocumentUri = null; // Reset selected document URI at the start of each command

  const configObj = await getConfig();
  if (!configObj) {
    return null;
  }
  const targets = configObj.get("targets");
  if(!targets || !targets[0] || !targets[0].sshConfig || !targets[0].remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
    console.error("Bade: !targets || !targets[0] || !targets[0].sshConfig || !targets[0].remoteWorkspaceDir")
    console.error("Bade: The found config:" + JSON.stringify(targets))
    return null;
  }

  let sshConfig = targets[0].sshConfig;
  if(sshConfig.privateKey) {
    sshConfig.privateKey = fs.readFileSync(sshConfig.privateKey);
  }
  const remoteWorkspaceDir = targets[0].remoteWorkspaceDir

  if(!sshConfig || !remoteWorkspaceDir) {
    vscode.window.showErrorMessage('Failed to load configs for bade. Double check the settings.json file');
    console.error("Bade: !sshConfig || !remoteWorkspaceDir")
  }

  if(!sshConfig.privateKey && !sshConfig.password) {
    const userInput = await vscode.window.showInputBox({
      placeHolder: `${sshConfig.username}'s password on remote side`,
      prompt: "Please input the remote server's password. You can also specify a privateKey or password in your config.",
      password: true,
    });
    if(userInput === undefined) {
      vscode.window.showWarningMessage("Operation canceled by user.")
      return null;
    }
    sshConfig.password = userInput
  }

  config = {sshConfig, remoteWorkspaceDir}
}

exports.activate = activate;
