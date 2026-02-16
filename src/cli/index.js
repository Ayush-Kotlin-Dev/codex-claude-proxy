#!/usr/bin/env node

/**
 * codex-claude-proxy CLI
 *
 * Antigravity-style UX:
 *   codex-claude-proxy start
 *   codex-claude-proxy accounts <subcommand>
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`\nCodex Claude Proxy\n\nUsage:\n  codex-claude-proxy start [--port <port>]\n  codex-claude-proxy accounts <add|list|...> [args]\n\nNotes:\n  - \'start\' runs the proxy server\n  - \'accounts\' delegates to the accounts CLI\n`);
}

function runNodeScript(scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  printHelp();
  process.exit(0);
}

if (cmd === 'start') {
  // Pass through args like --port to the server via env or args.
  // Current server reads PORT from env, so we translate --port into PORT.
  const args = argv.slice(1);

  const portFlagIndex = args.findIndex((a) => a === '--port' || a === '-p');
  if (portFlagIndex !== -1) {
    const portValue = args[portFlagIndex + 1];
    if (!portValue || String(Number(portValue)) !== portValue) {
      console.error('Invalid port. Usage: codex-claude-proxy start --port <port>');
      process.exit(1);
    }
    process.env.PORT = portValue;
    args.splice(portFlagIndex, 2);
  }

  const serverEntrypoint = join(__dirname, '..', 'index.js');
  runNodeScript(serverEntrypoint, args);
  process.exit(0);
}

if (cmd === 'accounts') {
  const accountsEntrypoint = join(__dirname, 'accounts.js');
  runNodeScript(accountsEntrypoint, argv.slice(1));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
printHelp();
process.exit(1);
