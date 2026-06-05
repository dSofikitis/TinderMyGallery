'use strict';

const fs = require('fs');
const path = require('path');

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;
  const archName = ARCH_NAMES[arch] ?? String(arch);

  const resourcesDir = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');

  const binRoot = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin');
  if (!fs.existsSync(binRoot)) return;

  for (const plat of fs.readdirSync(binRoot)) {
    const platDir = path.join(binRoot, plat);
    if (plat !== electronPlatformName) {
      fs.rmSync(platDir, { recursive: true, force: true });
      continue;
    }
    if (archName === 'universal') continue;
    for (const a of fs.readdirSync(platDir)) {
      if (a !== archName) fs.rmSync(path.join(platDir, a), { recursive: true, force: true });
    }
  }
};