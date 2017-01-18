#! /usr/bin/env node

// System Includes
const fs = require('fs');
const localExec = require('child_process').exec;
const path = require('path');
const spawn = require('child_process').spawn;
const util = require('util');

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
  .version('0.1.0')
  .option('-v, --release-version [semver]', 'Semver Release Version')
  .option('-i --ssh-key [keyPath]', 'SSH Key path to computer machine', expandTilde('~/.ssh/id_rsa'))
  .option('-c --config [config file path]', 'Path to JSON file containing AWS config', '../config.json')
  .option('-s --semver [semver increment amount]', 'The type of Semver increment to apply to version', 'patch')
  .parse(process.argv);

function validateSemver() {
  return new Promise((resolve, reject) => {
    if (!program.releaseVersion && !program.semver) {
      return reject('Please specify a --semver argument. (major, minor, patch)');
    } else {
      if (!program.semver && !semver.valid(program.releaseVersion)) {
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
    spawn('vagrant', ['up'])
    .on('exit', (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(deploySettings);
      }
    })
  });
}

function remoteExecHelper(command) {
  return new Promise((resolve, reject) => {
    debug('executing new command', command);
    var proc = spawn('vagrant', ['ssh', '-c', command])
    proc.stderr.pipe(process.stderr);
    proc.stdout.pipe(process.stdout);
    var stdout = '';
    proc.stdout.on('data', function(data) {
      debug('STDOUT', data.toString());
      stdout += data.toString();
    });
    proc.once('exit', function(code) {
      debug('Resolving', command);
      if (code !== 0) {
        return reject(`Command failed with exit code ${code}`);
      } else {
        return resolve(stdout.trim());
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

function fetchOpenWRTSHA(deploySettings) {
  return remoteExecHelper(`
    cd /work/openwrt-tessel;
    git rev-parse --verify HEAD;
  `)
    .then((sha) => {
      deploySettings.openWRTSHA = sha;
      return Promise.resolve(deploySettings);
    });
}

function buildOpenWRT(deploySettings) {
  console.log('building...');
  return remoteExecHelper(`
    cd /work/openwrt-tessel;
    make -j64; make -j64; make -j64 V=s;
  `)
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function buildFirmware(deploySettings) {
  return remoteExecHelper(`
    cd /work/t2-firmware;
    make -j64;
  `)
    .then(() => {
      return Promise.resolve(deploySettings);
    });
}

function buildLocalReleaseDirectory(deploySettings) {
  return localExecHelper('mkdir -p build/linux')
    .then(() => {
      deploySettings.localReleaseFolder = path.join(__dirname, 'build');
      return Promise.resolve(deploySettings);
    });
}

function downloadFreshBuilds(deploySettings) {
  return remoteExecHelper(`
    cp /work/t2-firmware/build/firmware.bin /vagrant/build/firmware.bin;
    cp /work/openwrt-tessel/openwrt/bin/ramips/openwrt-ramips-mt7620-tessel-squashfs-sysupgrade.bin /vagrant/build/linux/openwrt.bin;
  `)
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
        console.log('wait,', deploySettings.builds);
        process.exit(1);

        var params = {
          localFile: deploySettings.localBuildsJSONFile,

          s3Params: {
            Bucket: awsBucket,
            Key: path.join(awsPath, 'builds.json'),
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
    localExec(`tar -zcvf ./build/${deploySettings.openWRTSHA}.tar.gz -C ./build/linux .`, (error) => {
      if (error !== null) {
        return reject(error);
      } else {
        var params = {
          localFile: `build/${deploySettings.openWRTSHA}.tar.gz`,

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

function reportError() {
  console.error(colors.red('ERR!'), util.format.apply(util, arguments));
  process.exit(1);
}

// process.once('SIGINT', () => {
//   wipeResources()
//     .then(process.exit);
// });

console.log('running release process...');
validateSemver()
  .then(connectToServer)
  .then(fetchOpenWRTSHA)
  .then(buildOpenWRT)
  .then(buildFirmware)
  .then(buildLocalReleaseDirectory)
  .then(downloadFreshBuilds)
  .then(loadS3Credentials)
  .then(downloadBuildsJSON)
  .then(setReleaseVersion)
  .then(uploadUpdatedBuildsJSON)
  // .then(uploadNewBuilds)
  // .then(wipeResources)
  .catch(reportError);
