const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = process.env.WINDOWS_PACKAGE_TARGET || 'dir';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join(root, 'scripts', 'build-next.js')]);
run(process.execPath, [
  path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--win',
  target,
  '--x64'
]);
