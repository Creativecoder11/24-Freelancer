/**
 * Local admin seed (Doc 09 §19.2). Creates the super admin plus one admin per role, all with the
 * same dev password, TOTP not enrolled (ADMIN_TOTP_REQUIRED=false locally).
 *
 *   cd apps/api && pnpm run script src/modules/admin/scripts/seed-admins.ts
 *
 * Idempotent: existing accounts get their password and roles reset.
 */
import * as argon2 from 'argon2';
import { prisma } from '@24f/db';

const PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'Admin123!';
const PEOPLE: { email: string; name: string; roles: string[] }[] = [
  { email: 'admin@24freelancing.local', name: 'Imran Hossain', roles: ['super_admin'] },
  { email: 'super2@24freelancing.local', name: 'Rafiq Chowdhury', roles: ['super_admin'] },
  { email: 'ops@24freelancing.local', name: 'Mitu Akter', roles: ['ops_admin'] },
  { email: 'finance@24freelancing.local', name: 'Farhana Akter', roles: ['finance_admin'] },
  { email: 'moderator@24freelancing.local', name: 'Sabbir Rahman', roles: ['moderator'] },
  { email: 'support@24freelancing.local', name: 'Nadia Islam', roles: ['support_agent'] },
  { email: 'analyst@24freelancing.local', name: 'Tariq Ahmed', roles: ['analyst'] },
];

async function main() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const roles = await prisma.adminRole.findMany();
  for (const p of PEOPLE) {
    const a = await prisma.adminUser.upsert({
      where: { email: p.email },
      update: { fullName: p.name, passwordHash: hash, status: 'active', mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      create: { email: p.email, fullName: p.name, passwordHash: hash, mustChangePassword: false },
    });
    await prisma.adminUserRole.deleteMany({ where: { adminUserId: a.id } });
    for (const code of p.roles) {
      const r = roles.find((x) => x.code === code);
      if (r) await prisma.adminUserRole.create({ data: { adminUserId: a.id, adminRoleId: r.id } });
    }
    console.log(`  ${p.roles.join(',').padEnd(14)} ${p.email}`);
  }
  console.log(`Password for all: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
