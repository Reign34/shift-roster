import 'dotenv/config';
import { db, migrate } from './db.js';
import { hashPassword } from './auth.js';

// Fills the database with a manager and 33 staff, which is enough to cover a
// 24/7 operation: 3 shifts a day, 7 people a shift, with rest days.
//
// Run with: npm run seed

const STAFF = [
  'Ama Mensah', 'Kwame Boateng', 'Akosua Danso', 'Yaw Owusu', 'Abena Asante',
  'Kofi Adjei', 'Adwoa Sarpong', 'Kojo Antwi', 'Efua Baidoo', 'Kwabena Frimpong',
  'Esi Quartey', 'Kwaku Agyeman', 'Afia Nyarko', 'Yaw Darko', 'Adjoa Bediako',
  'Kwesi Appiah', 'Araba Tetteh', 'Kobina Larbi', 'Maame Amoah', 'Fiifi Ocran',
  'Nana Ofori', 'Serwaa Addo', 'Kelvin Nkrumah', 'Gifty Amponsah', 'Daniel Osei',
  'Priscilla Ansah', 'Samuel Yeboah', 'Linda Acheampong', 'Michael Opoku',
  'Grace Donkor', 'Isaac Gyamfi', 'Vera Oppong', 'Emmanuel Tagoe'
];

const DEFAULT_PASSWORD = 'password123';

function emailFor(name) {
  return name.toLowerCase().replace(/\s+/g, '.') + '@example.com';
}

migrate();

const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existing > 0) {
  console.log(`Database already has ${existing} users. Delete data/roster.db to start over.`);
  process.exit(0);
}

const insert = db.prepare(
  'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
);

// One hash reused for every seeded account. scrypt is deliberately slow, so
// hashing 34 times separately adds seconds for no benefit in demo data.
const hash = hashPassword(DEFAULT_PASSWORD);

insert.run('Rota Manager', 'manager@example.com', hash, 'manager');
for (const name of STAFF) {
  insert.run(name, emailFor(name), hash, 'staff');
}

const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
console.log(`Seeded ${total} users (1 manager, ${STAFF.length} staff).`);
console.log(`Sign in as manager@example.com / ${DEFAULT_PASSWORD}`);
