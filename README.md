# BADE (Bourne Again DEploy)

## Why another deploy extension
All other deploy extensions failed to do a simple deploy on a simple ssh connection for me. So I wrote this.<br>
It is as simple as possible. 

## Support and does not support
It Just supports SFTP and for now it only accepts one target.<br>
For now it only supports `privateKey` file and without any encryption<br>
It does not support directory actions, and does not have a pull command (Which I think I won't add)

After installation there should be two new commands available:
- >Bade: Deploy File
- >Bade: Compare File

## Config file example
```json
{
  "bade": {
    "targets": [{
      "sshConfig": {
        "host": "0.0.0.0", // Remote host or address to ssh to
        "username": "ubuntu", // Remote user to login to ssh
        "privateKey": "path/to/key.pem", // Path to private key file
      },
      "remoteWorkspaceDir": "/will/prepend/to/path/in/remote" // The same as dir in other deploy extensions
    }]
  },
}
```