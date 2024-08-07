# BADE (Bourne Again DEploy)
Yet another deploy extension for VSCode.

## Why another deploy extension
All other deploy extensions failed to do a simple deploy on a simple ssh connection for me. So I wrote this.<br>
It is as simple as possible. 

## Supports and does not support
It only supports Unix servers (remotes). The local machine can be anything.<br>
It Just supports SFTP and for now it only accepts one target. (The first target in target list)<br>
It does not support directory actions (Multiple actions at the same time).<br>
It does not have a pull command (Which I think I won't add)

## Usage
After installation, there should be two new commands available (in command palette):
- >Bade: Deploy File
- >Bade: Compare File

## Config
`sshConfig` key would be passed to <a href="https://www.npmjs.com/package/ssh2">`ssh2`</a> `connect` method directly. So all the valid inputs for `connect` method can be passed inside `sshConfig` key.
It is possible to use either a private key or a password to authenticate to the server. If the config does not have either of these keys, a prompt will be shown asking for the password.

## Example
A simple example:
```json
{
  "bade": {
    "targets": [{
      "sshConfig": {
        "host": "0.0.0.0", // Remote host or address to ssh to (MANDATORY)
        "username": "ubuntu", // Remote user to login to ssh (MANDATORY)
        "privateKey": "path/to/key.pem", // Path to private key file (OPTIONAL)
        "password": "secure_password", // SSH password for this username on the remote side (OPTIONAL)
      },
      "remoteWorkspaceDir": "/will/prepend/to/path/in/remote" // The same as dir in other deploy extensions (MANDATORY)
    }]
  },
}
```

If you are behind a firewall or something like this, the config bellow seems to work better...
```json
"sshConfig": {
  "host": "",
  "username": "",
  "privateKey": "",
  "algorithms": {
    "cipher": ["aes128-ctr","aes192-ctr","aes256-ctr","aes128-cbc","3des-cbc"],
    "hmac": ["hmac-md5","hmac-sha1"],
    "kex": ["curve25519-sha256","curve25519-sha256@libssh.org","ecdh-sha2-nistp256","ecdh-sha2-nistp384","ecdh-sha2-nistp521","diffie-hellman-group-exchange-sha256","diffie-hellman-group16-sha512","diffie-hellman-group18-sha512","diffie-hellman-group14-sha256"]
  }
},

```
