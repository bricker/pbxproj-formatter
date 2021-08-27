#!/usr/bin/env node

const fs = require('fs');
const LineByLine = require('n-readlines');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const filesWithoutExtension = [
  'Podfile',
  'Mintfile',
].reduce((acc, f) => { acc[f.toLowerCase()] = true; return acc; }, {}); // Convert to Set with lowercased filenames.

const { argv } = yargs(hideBin(process.argv));
const { pbx, resolveVersion } = argv;

const tmpPath = '/tmp/cleanme.pbxproj.tmp';
const newFileStream = fs.createWriteStream(tmpPath);
const lines = new LineByLine(pbx);

async function writeLine(line) {
  await newFileStream.write(`${line}\n`);
}

const filenameRe = /^\s*[A-Z0-9]{24} \/\* (.+?) in /;
const childFilenameRe = /^\s*[A-Z0-9]{24} \/\* (.+?) \*\/,$/;
const suffixRe = /\.[^.]+$/; // file extension
const unifiedFilenameRe = /^UnifiedSource(\d+)/;
const children = 'children';
const files = 'files';

function isFile(name) {
  return filesWithoutExtension[name] || suffixRe.test(name);
}

function compareStrings(a, b) {
  if (a === b) {
    return 0;
  }

  return a > b ? 1 : -1;
}

function sortByFilename(a, b, type) {
  let re;
  switch (type) {
    case children:
      re = childFilenameRe;
      break;
    case files:
      re = filenameRe;
      break;
    default: throw new Error('children or file');
  }

  const matchA = a.match(re);
  const matchB = b.match(re);

  if (!matchA || !matchB) {
    throw new Error(`Unexpected line format: ${a} ${b}`);
  }

  const filenameA = matchA[1].toLowerCase();
  const filenameB = matchB[1].toLowerCase();

  if (type === children) {
    // Sort directories on top.
    if (!isFile(filenameA) && isFile(filenameB)) {
      // A is a directory, B is a file
      return -1;
    }

    if (isFile(filenameA) && !isFile(filenameB)) {
      // B is a directory, A is a file.
      return 1;
    }
    return compareStrings(filenameA, filenameB);
  }

  const altMatchA = filenameA.match(unifiedFilenameRe);
  const altMatchB = filenameB.match(unifiedFilenameRe);

  if (altMatchA && altMatchB) {
    const idA = altMatchA[1];
    const idB = altMatchB[1];

    return compareStrings(idA, idB);
  }

  return compareStrings(filenameA, filenameB);
}

function sortFiles(a, b) {
  return sortByFilename(a, b, files);
}

function sortChildren(a, b) {
  return sortByFilename(a, b, children);
}

async function cleanFiles(match, sortFn) {
  const set = {};
  let endMarker = `${match[1]}\\);`;
  let line;

  while (line = lines.next()) {
    line = line.toString();
    if (line.match(`^${endMarker}\\s*$`)) {
      endMarker = line;
      break;
    }

    // Using dictionary to de-duplicate lines
    set[line] = true;
  }

  const sortedSetMembers = Object.keys(set).sort(sortFn);
  for (const member of sortedSetMembers) {
    await writeLine(member);
  }
  await writeLine(endMarker);
}

async function cleanBuildSettings(match, projectVersion) {
  const endMarker = `${match[1]}\\};`;
  let line;
  let didWriteVersion = false;

  while (line = lines.next()) {
    line = line.toString();

    if (projectVersion) {
      // CURRENT_PROJECT_VERSION tends to get duplicated when merging. Take the highest version.
      const versionMatch = line.match(/CURRENT_PROJECT_VERSION = (\d+)/);
      if (versionMatch) {
        if (versionMatch[1] !== projectVersion || didWriteVersion) {
          // Don't write this line.
          continue;
        }
        didWriteVersion = true;
      }
    }

    await writeLine(line);

    if (line.match(`^${endMarker}\\s*$`)) {
      break;
    }
  }
}

async function processLine(line, projectVersion) {
  await writeLine(line);
  let match;

  match = line.match(/^(\s*)files = \(\s*$/);
  if (match) {
    await cleanFiles(match, sortFiles);
    return;
  }

  match = line.match(/^(\s*)children = \(\s*$/);
  if (match) {
    await cleanFiles(match, sortChildren);
    return;
  }

  match = line.match(/^(\s*)buildSettings = \{\s*$/);
  if (match) {
    await cleanBuildSettings(match, projectVersion);
  }
}

function sortStringsAsInts(a, b) {
  const intA = parseInt(a, 10);
  const intB = parseInt(b, 10);
  if (intA < intB) { return -1; }
  if (intA > intB) { return 1; }
  return 0;
}

async function run({ pbx: pbxPath, resolveVersion: resolveVersionAlgorithm = 'highest' }) {
  const { stdout: versions } = await exec(`grep -oE "CURRENT_PROJECT_VERSION = (\\d+)" "${pbxPath}" | cut -f2 -d=`);
  const projectVersions = versions.trimEnd().split('\n').map((s) => s.trim()).sort(sortStringsAsInts);

  let useVersion;
  if (resolveVersionAlgorithm === 'lowest') {
    useVersion = projectVersions.reverse().pop();
  } else {
    useVersion = projectVersions.pop();
  }

  let line;
  while (line = lines.next()) {
    await processLine(line.toString(), useVersion);
  }

  newFileStream.close();
  fs.renameSync(tmpPath, pbxPath);
}

run({ pbx, resolveVersion }).then(() => { console.log('Done! 🧹'); });
