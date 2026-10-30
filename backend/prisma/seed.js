import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const email = process.env.SEED_ADMIN_EMAIL || 'admin@localhost';
const name = process.env.SEED_ADMIN_NAME || 'Super Admin';
const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe-Immediately!';
const role = process.env.SEED_ADMIN_ROLE || 'SUPER_ADMIN';

async function main() {
  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hash, role, isActive: true },
    create: { name, email, password: hash, role, isActive: true },
  });

  console.log(`[seed] User siap: ${user.email} (role ${user.role})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('[seed] PERINGATAN: memakai password default. Ganti sebelum dipakai di production.');
  }
}

main()
  .catch((err) => {
    console.error('[seed] gagal:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
