// Uso: pnpm admin:promote <email>
// Marca la cuenta con ese email como administrador global (users.role = 'admin').
// Es la forma de crear el primer admin: los endpoints /admin/* exigen ya serlo.
import 'dotenv/config';
import postgres from 'postgres';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Uso: pnpm admin:promote <email>');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL (definila en .env o en el entorno).');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
try {
  const rows = await sql`
    update users set role = 'admin' where email = ${email} returning id, email, role
  `;
  if (rows.length === 0) {
    console.error(`No existe una cuenta con el email "${email}". Registrala primero.`);
    process.exitCode = 1;
  } else {
    console.log(`Listo: ${rows[0].email} ahora es administrador global.`);
  }
} finally {
  await sql.end();
}
