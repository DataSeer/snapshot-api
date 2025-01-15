// File: scripts/sync_version.js
const fs = require('fs');
const { execSync } = require('child_process');
const semver = require('semver');

function getCurrentVersion() {
  // Get the latest tag from git
  try {
    const tag = execSync('git describe --tags --abbrev=0').toString().trim();
    // Remove 'v' prefix if present
    return tag.startsWith('v') ? tag.slice(1) : tag;
  } catch (error) {
    console.log('No git tags found, using package.json version');
    const pkg = JSON.parse(fs.readFileSync('./package.json'));
    return pkg.version;
  }
}

function updatePackageVersion(version) {
  const packagePath = './package.json';
  const pkg = JSON.parse(fs.readFileSync(packagePath));
  
  // Only update if the new version is greater
  if (semver.gt(version, pkg.version)) {
    pkg.version = version;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`Updated package.json version to ${version}`);
  } else {
    console.log('Package version is already up to date');
  }
}

// Main execution
const version = getCurrentVersion();
updatePackageVersion(version);
