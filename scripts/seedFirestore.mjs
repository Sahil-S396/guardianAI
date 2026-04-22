/**
 * GuardianAI — Firestore Seed Script
 *
 * Run with: node scripts/seedFirestore.mjs
 *
 * Prerequisites:
 *   - Set FIREBASE_PROJECT_ID in your environment
 *   - Have a Firebase service account or use `firebase login`
 *   - npm install firebase-admin
 *
 * This script seeds:
 *   - 12 rooms across 3 floors
 *   - 9 staff members
 * Under: hospitals/hospital-001/rooms and hospitals/hospital-001/staff
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'fs/promises';

// ── Configuration ──────────────────────────────────────────────────────────
const HOSPITAL_ID = 'hospital-001';

// Load service account key (download from Firebase Console → Project Settings → Service Accounts)
// Place the file at: scripts/serviceAccountKey.json
let serviceAccount;
try {
  const raw = await readFile(new URL('./serviceAccountKey.json', import.meta.url), 'utf-8');
  serviceAccount = JSON.parse(raw);
} catch {
  console.error('❌ Could not find scripts/serviceAccountKey.json');
  console.error('   Download it from Firebase Console → Project Settings → Service Accounts → Generate new private key');
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// ── Seed Data ───────────────────────────────────────────────────────────────
const rooms = [
  // Floor 1
  { id: 'rm-101', name: 'Room 101', zone: 'A', floor: '1', type: 'Ward', status: 'clear' },
  { id: 'rm-102', name: 'Room 102', zone: 'A', floor: '1', type: 'Ward', status: 'clear' },
  { id: 'rm-103', name: 'Room 103', zone: 'B', floor: '1', type: 'Isolation', status: 'clear' },
  { id: 'rm-104', name: 'ER Room 1', zone: 'A', floor: '1', type: 'Emergency', status: 'clear' },
  // Floor 2
  { id: 'rm-201', name: 'Room 201', zone: 'A', floor: '2', type: 'Ward', status: 'clear' },
  { id: 'rm-202', name: 'Room 202', zone: 'B', floor: '2', type: 'Ward', status: 'clear' },
  { id: 'rm-203', name: 'OR Suite 1', zone: 'C', floor: '2', type: 'Operating', status: 'clear' },
  { id: 'rm-204', name: 'OR Suite 2', zone: 'C', floor: '2', type: 'Operating', status: 'clear' },
  // Floor 3
  { id: 'rm-301', name: 'ICU Bay 1',  zone: 'A', floor: '3', type: 'ICU', status: 'clear' },
  { id: 'rm-302', name: 'ICU Bay 2',  zone: 'A', floor: '3', type: 'ICU', status: 'clear' },
  { id: 'rm-303', name: 'ICU Bay 3',  zone: 'A', floor: '3', type: 'ICU', status: 'clear' },
  { id: 'rm-304', name: 'NICU',       zone: 'B', floor: '3', type: 'NICU', status: 'clear' },
];

const staff = [
  // Nurses
  { id: 'sf-001', name: 'Sarah Chen', role: 'nurse', zone: 'A', floor: '1', available: true },
  { id: 'sf-002', name: 'James Okafor', role: 'nurse', zone: 'B', floor: '1', available: true },
  { id: 'sf-003', name: 'Priya Sharma', role: 'nurse', zone: 'A', floor: '2', available: true },
  { id: 'sf-004', name: 'Carlos Rivera', role: 'nurse', zone: 'C', floor: '2', available: false },
  { id: 'sf-005', name: 'Amira Hassan', role: 'nurse', zone: 'A', floor: '3', available: true },
  // Admins
  { id: 'sf-006', name: 'Dr. Emily Park', role: 'admin', zone: 'A', floor: '1', available: true },
  { id: 'sf-007', name: 'Dr. Michael Torres', role: 'admin', zone: 'B', floor: '3', available: false },
  // Security
  { id: 'sf-008', name: 'Kevin Walsh', role: 'security', zone: 'A', floor: '1', available: true },
  { id: 'sf-009', name: 'Nadia Petrov', role: 'security', zone: 'C', floor: '2', available: true },
];

// ── Write to Firestore ──────────────────────────────────────────────────────
async function seedCollection(collectionPath, items) {
  const batch = db.batch();
  for (const item of items) {
    const { id, ...data } = item;
    const ref = db.collection(collectionPath).doc(id);
    batch.set(ref, data, { merge: true });
  }
  await batch.commit();
}

console.log('🌱 Seeding GuardianAI Firestore…');
console.log(`   Hospital: ${HOSPITAL_ID}`);

await seedCollection(`hospitals/${HOSPITAL_ID}/rooms`, rooms);
console.log(`   ✅ Seeded ${rooms.length} rooms`);

await seedCollection(`hospitals/${HOSPITAL_ID}/staff`, staff);
console.log(`   ✅ Seeded ${staff.length} staff members`);

console.log('\n🎉 Database seeded successfully!');
console.log(`   Visit Firestore Console → hospitals/${HOSPITAL_ID} to verify.`);
