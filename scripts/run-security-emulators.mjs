import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const homebrewJava = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const environment = { ...process.env };
if (!environment.JAVA_HOME && existsSync(homebrewJava)) environment.JAVA_HOME = homebrewJava;
delete environment.DEBUG;

const executable = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
const child = spawn(executable, [
  'emulators:exec',
  '--only',
  'auth,firestore,storage',
  '--project',
  'demo-zoko-security',
  'npm run test:security',
], {
  env: environment,
  stdio: 'inherit',
  shell: false,
});

child.on('error', error => {
  console.error(`Unable to start Firebase emulators: ${error.code || 'unknown error'}`);
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
