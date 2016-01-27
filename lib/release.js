#! /usr/bin/env node

// System Includes
const util = require('util');
const localExec = require('child_process').exec;
const path = require('path');
const fs = require('fs');

// Third party
var program = require('commander');
const expandTilde = require('expand-tilde');
const debug = require('debug')('all');
const colors = require('colors');
const semver = require('semver');
var s3 = require('s3');
var Client = require('ssh2').Client;

const awsBucket = 'builds.tessel.io';
const awsPath = 't2/firmware';

program
  .version('0.0.1')
  .option('-v, --release-version [semver]', 'Semver Release Version')
  .option('-i --ssh-key [keyPath]', 'SSH Key path to computer machine', expandTilde('~/.ssh/id_rsa'))
  .option('-c --config [config file path]', 'Path to JSON file containing AWS config', '../config.json')
  .option('-s --semver [semver increment amount]', 'The type of Semver increment to apply to version', 'patch')
  .parse(process.argv);

function validateSemver() {
  return new Promise((resolve, reject) => {
    if (!program.releaseVersion) {
      console.warn(colors.grey('INFO'), `No semver explicitly requested. Incrementing ${program.semver} of previously released version.`);
      return resolve({});
    } else {
      if (!semver.valid(program.releaseVersion)) {
        return reject(`Invalid version: ${program.releaseVersion}. It must follow semver protocol.`);
      } else {
        return resolve({
          releaseVersion: program.releaseVersion
        });
      }
    }
  });
}

function connectToServer(deploySettings) {
  return new Promise((resolve, reject) => {
    var config = require(program.config);

    if (!config.buildMachine.host || !config.buildMachine.user) {
      return reject('config.json is missing build machine details. See README.md for install details.');
    }

    var gCloudAuth = {
      host: config.buildMachine.host,
      username: config.buildMachine.user,
      privateKey: require('fs').readFileSync(program.sshKey)
    };

    deploySettings.client = new Client();
    deploySettings.client.on('ready', function() {
      debug('Connected to computer server!');
      return resolve(deploySettings);
    });
    deploySettings.client.on('error', reject)
      .connect(gCloudAuth);
  });
}

function remoteExecHelper(client, command) {
  return new Promise((resolve, reject) => {
    debug('executing new command', command);
    client.exec(command, function(err, stream) {
      if (err) {
        debug('Exec failed:', err);
        return reject(err);
      } else {
        stream.stderr.pipe(process.stderr);
        var stdout = '';
        stream.on('data', function(data) {
          debug('STDOUT', data.toString());
          stdout += data.toString();
        });
        stream.once('close', function(code) {
          debug('Resolving', command);
          if (code !== 0) {
            return reject(`Command failed with exit code ${code}`);
          } else {
            return resolve(stdout.trim());
          }
        });
      }
    });
  });
}

function localExecHelper(command) {
  debug('local exec', command);
  return new Promise((resolve, reject) => {
    localExec(command, (error, stdout, stderr) => {
      if (error !== null) {
        return reject(error);
      }
      if (stderr !== '') {
        return reject(stderr.trim());
      } else {
        debug('Done with', command, stdout.trim());
        return resolve(stdout.trim());
      }
    });
  });
}

function createRemoteBuildDirectory(deploySettings) {
  return remoteExecHelper(deploySettings.client, 'mktemp -d -t "release.XXXXXXXX"')
    .then((buildPath) => {
      deploySettings.buildPath = buildPath;
      return Promise.resolve(deploySettings);
    });
}

function cloneOpenWRT(deploySettings) {
  return remoteExecHelper(deploySettings.client,
      `cd ${deploySettings.buildPath};
     git clone https://github.com/tessel/openwrt-tessel.git --recursive --depth=1;`
    )
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function fetchOpenWRTSHA(deploySettings) {
  return remoteExecHelper(deploySettings.client,
      `cd ${deploySettings.buildPath}/openwrt-tessel;
     git rev-parse --verify HEAD`
    )
    .then((sha) => {
      deploySettings.openWRTSHA = sha;
      return Promise.resolve(deploySettings);
    });
}

function buildOpenWRT(deploySettings) {
  return remoteExecHelper(deploySettings.client,
      `cd ${deploySettings.buildPath}/openwrt-tessel;
     make -j50`
    )
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function buildFirmware(deploySettings) {
  return remoteExecHelper(deploySettings.client,
      `
      sudo add-apt-repository ppa:terry.guo/gcc-arm-embedded && sudo apt-get update;
      sudo apt-get -y install git gcc-arm-none-eabi;
      cd ${deploySettings.buildPath};
      git clone https://github.com/tessel/t2-firmware --recursive --depth=1;
      cd t2-firmware;
      make;`
    )
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function buildLocalReleaseDirectory(deploySettings) {
  return localExecHelper('mktemp -d -t "tessel-release.XXXXXXXX"')
    .then((localReleaseFolder) => {
      deploySettings.localReleaseFolder = localReleaseFolder;
      return Promise.resolve(deploySettings);
    });
}

function downloadFreshBuilds(deploySettings) {
  return localExecHelper(
      `mkdir ${deploySettings.localReleaseFolder}/builds`
    )
    .then(() => {
      return localExecHelper(
        `scp ${program.user}@${program.host}:${deploySettings.buildPath}/t2-firmware/build/firmware.bin ${deploySettings.localReleaseFolder}/builds/firmware.bin`
      );
    })
    .then(() => {
      return localExecHelper(
        `scp ${program.user}@${program.host}:${deploySettings.buildPath}/openwrt-tessel/openwrt/bin/ramips/openwrt-ramips-mt7620-tessel-squashfs-sysupgrade.bin ${deploySettings.localReleaseFolder}/builds./openwrt.bin`
      );
    })
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function loadS3Credentials(deploySettings) {
  return new Promise((resolve) => {
    var s3Options = require(program.config).awsCredentials;
    var client = s3.createClient(s3Options);
    deploySettings.s3Client = client;
    return resolve(deploySettings);
  });
}

function downloadBuildsJSON(deploySettings) {
  return new Promise((resolve, reject) => {
    deploySettings.localBuildsJSONFile = path.join(deploySettings.localReleaseFolder, 'builds.json');
    var params = {
      localFile: deploySettings.localBuildsJSONFile,

      s3Params: {
        Bucket: awsBucket,
        Key: path.join(awsPath, 'builds.json'),
      },
    };

    var downloader = deploySettings.s3Client.downloadFile(params);

    downloader.on('error', reject);
    downloader.on('end', () => {
      deploySettings.builds = require(deploySettings.localBuildsJSONFile);
      deploySettings.builds.sort((a, b) => {
        return semver.rcompare(a.version, b.version);
      });
      return resolve(deploySettings);
    });
  });
}

function setReleaseVersion(deploySettings) {
  return new Promise((resolve, reject) => {
    // Release version was already set with provided cli option
    if (deploySettings.releaseVersion) {
      return resolve(deploySettings);
    } else {
      if (!deploySettings.builds || deploySettings.builds[0] === undefined) {
        return reject('Unable to deduce new version. Builds.json not found and no version explicitly set.');
      } else {
        deploySettings.releaseVersion = semver.inc(deploySettings.builds[0].version, program.semver);

        if (deploySettings.releaseVersion === null) {
          return reject(`Invalid patch type ${program.semver}`);
        } else {
          console.warn(colors.green(`New version will be released as ${deploySettings.releaseVersion}`));
          return resolve(deploySettings);
        }
      }
    }
  });
}

function uploadUpdatedBuildsJSON(deploySettings) {
  return new Promise((resolve, reject) => {
    var newBuild = {
      released: new Date(),
      sha: deploySettings.openWRTSHA,
      version: deploySettings.releaseVersion
    };
    // Add the new build to the array
    deploySettings.builds.unshift(newBuild);
    fs.writeFile(deploySettings.localBuildsJSONFile, JSON.stringify(deploySettings.builds, null, 4), function(err) {
      if (err) {
        return reject(err);
      } else {
        var params = {
          localFile: deploySettings.localBuildsJSONFile,

          s3Params: {
            Bucket: awsBucket,
            Key: path.join(awsPath, 'builds2.json'),
          },
        };

        var uploader = deploySettings.s3Client.uploadFile(params);
        uploader.on('error', reject);
        uploader.on('end', function() {
          return resolve(deploySettings);
        });
      }
    });
  });
}

function uploadNewBuilds(deploySettings) {
  return new Promise((resolve, reject) => {
    // Not using helper method because of output on stderr even in proper usage
    localExec(`cd ${deploySettings.localReleaseFolder}; tar -zcvf  ${deploySettings.openWRTSHA}.tar.gz -C ${deploySettings.localReleaseFolder}/builds .`, (error) => {
      if (error !== null) {
        return reject(error);
      } else {
        var params = {
          localFile: `${deploySettings.localReleaseFolder}/${deploySettings.openWRTSHA}.tar.gz`,

          s3Params: {
            Bucket: awsBucket,
            Key: path.join(awsPath, `${deploySettings.openWRTSHA}.tar.gz`),
          },
        };
        console.warn(colors.green(`Uploading build...`));
        var uploader = deploySettings.s3Client.uploadFile(params);
        uploader.on('error', reject);
        uploader.on('end', function() {
          console.warn(colors.green('Done!'));
          return resolve(deploySettings);
        });
      }
    });
  });
}

function wipeResources(deploySettings) {
  debug('Wiping deploy resources', deploySettings.buildPath, deploySettings.localReleaseFolder);
  var remoteClean = Promise.resolve(),
    localClean = Promise.resolve();

  if (deploySettings.buildPath !== undefined) {
    remoteClean = remoteExecHelper(deploySettings.client,
      `rm -rf ${deploySettings.buildPath}`
    );
  }

  if (deploySettings.localReleaseFolder !== undefined) {
    localClean = new Promise((resolve) => {
      localExec(`rm -rf ${deploySettings.localReleaseFolder}`, resolve);
    });
  }

  return remoteClean()
    .then(localClean)
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function conclude(deploySettings) {
  deploySettings.client.end();
  return Promise.resolve();
}

function reportError() {
  console.error(colors.red('ERR!'), util.format.apply(util, arguments));
  process.exit(1);
}

process.once('SIGINT', () => {
  wipeResources()
    .then(process.exit);
});

validateSemver()
  .then(connectToServer)
  .then(createRemoteBuildDirectory)
  .then(cloneOpenWRT)
  .then(fetchOpenWRTSHA)
  .then(buildOpenWRT)
  .then(buildFirmware)
  .then(buildLocalReleaseDirectory)
  .then(downloadFreshBuilds)
  .then(loadS3Credentials)
  .then(downloadBuildsJSON)
  .then(setReleaseVersion)
  .then(uploadUpdatedBuildsJSON)
  .then(uploadNewBuilds)
  .then(wipeResources)
  .then(conclude)
  .catch(reportError);
