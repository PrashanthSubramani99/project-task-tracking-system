#!/usr/bin/env node
/**
 * Run the API and the Vite dev server together, so `npm run dev` at the repo
 * root is all anyone needs. Ctrl-C stops both.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [];

function run(name, cwd, args, color) {
  const child = spawn(npm, args, { cwd: path.join(root, cwd), shell: process.platform === 'win32' });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;

  const pipe = (stream, target) => {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) target.write(`${prefix} ${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix} exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', 'server', ['run', 'dev'], '36');
run('web', 'client', ['run', 'dev'], '35');

console.log('\nTeamTrack is starting…');
console.log('  API  http://localhost:4000');
console.log('  App  http://localhost:5173   <- open this one\n');
