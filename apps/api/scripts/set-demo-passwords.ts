/**
 * Dev only: sets every demo user's password to `Password1!` (or the first CLI argument),
 * clears lockouts, and records the hash in password_history.
 *
 *   pnpm --filter @24f/api demo:passwords
 *   pnpm --filter @24f/api demo:passwords 'Another1!'
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  for (const f of [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
    }
  }
}

async function main() {
  loadEnv();
  const env = process.env;
  if (['production', 'staging'].includes(env.APP_ENV ?? '')) throw new Error('Refusing to run outside local/dev.');
  const password = process.argv[2] ?? 'Password1!';
  const prisma = new PrismaClient();
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(env.ARGON2_MEMORY_KIB ?? 19456),
    timeCost: Number(env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(env.ARGON2_PARALLELISM ?? 1),
  });
  const users = await prisma.user.findMany({ where: { status: { not: 'closed' }, OR: [{ email: { endsWith: '@example.com' } }, { email: { endsWith: '.example' } }] }, select: { id: true, email: true, phoneE164: true, publicId: true } });
  const now = new Date();
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } });
    await prisma.passwordHistory.create({ data: { userId: u.id, passwordHash: hash } });
  }
  console.log(`Set password "${password}" for ${users.length} users.`);
  for (const u of users.slice(0, 5)) console.log(`  ${u.publicId}  ${u.email ?? u.phoneE164}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
