[![Build Status](https://travis-ci.org/tessel/t2-release.svg?branch=master)](https://travis-ci.org/tessel/t2-release)

## What is this?
This is a script to deploy new builds to AWS. Currently, it will only work for those with Tessel GCloud and AWS access (which is pretty much just @johnnyman727).

## Install

```
git clone git@github.com:tessel/t2-release.git;
cd t2-release;
npm install -g;
```
You will then need to create a `config.json` file that matches `example-config.json` but with real AWS credentials and your own compute machine details.

## Usage
```
t2-release # Releases a new build with a pacth increment from the last published version

t2-release --semver minor # Specify the semver increment ('patch', 'minor', 'major', etc.) and release
```
