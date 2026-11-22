#!/usr/bin/env node
/**
 * LEVHUB — Password Hash Generator
 * Generates a salted scrypt hash (format: scrypt$N$r$p$saltHex$hashHex)
 * compatible with LEVHUB backend APP_PASSWORD_HASH without external native deps.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

const inputPassword = process.argv[2] || (await ask('Masukkan Master Password LEVHUB: '));
rl.close();

if (!inputPassword || inputPassword.length < 10) {
  console.error('Error: Password minimal 10 karakter.');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const N = 16384;
const r = 8;
const p = 1;
const derived = crypto.scryptSync(inputPassword, salt, 64, { N, r, p }).toString('hex');
const encoded = `scrypt$${N}$${r}$${p}$${salt}$${derived}`;

console.log('\nSimpan nilai berikut ke variabel environment APP_PASSWORD_HASH:\n');
console.log(encoded);
console.log('');
