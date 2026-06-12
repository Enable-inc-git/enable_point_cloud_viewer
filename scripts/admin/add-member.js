#!/usr/bin/env node
/*
 * Enable Point Cloud Viewer — admin helper.
 *
 * Grants a user access to a client by adding clients/<clientId>/members/<email>,
 * creating the client doc with a free access grant if it doesn't exist yet.
 *
 * Setup (one-time):
 *   1. Firebase console -> Project settings -> Service accounts -> Generate new
 *      private key. Save the JSON somewhere private (do NOT commit it).
 *   2. npm install firebase-admin     (in this scripts/admin folder)
 *   3. set GOOGLE_APPLICATION_CREDENTIALS to the key path, e.g. (PowerShell):
 *        $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\serviceAccount.json"
 *
 * Usage:
 *   node add-member.js <clientId> <email> [--name "Client Name"] [--months 6]
 *
 * Examples:
 *   node add-member.js BDA someone@gc.com
 *   node add-member.js BDA sub@trades.com --months 6
 *   node add-member.js Pomerleau pm@pomerleau.com --name "Pomerleau"
 */
'use strict';

const admin = require('firebase-admin');

function parseArgs(argv) {
  const positional = [];
  const opts = { months: 6, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--months') opts.months = parseInt(argv[++i], 10);
    else if (a === '--name') opts.name = argv[++i];
    else positional.push(a);
  }
  return { clientId: positional[0], email: positional[1], opts };
}

async function main() {
  const { clientId, email, opts } = parseArgs(process.argv.slice(2));
  if (!clientId || !email) {
    console.error('Usage: node add-member.js <clientId> <email> [--name "Name"] [--months 6]');
    process.exit(1);
  }
  const emailLc = email.trim().toLowerCase();

  admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS
  const db = admin.firestore();

  const clientRef = db.doc(`clients/${clientId}`);
  const snap = await clientRef.get();
  if (!snap.exists) {
    const grantUntil = new Date();
    grantUntil.setMonth(grantUntil.getMonth() + (opts.months || 6));
    await clientRef.set({
      name: opts.name || clientId,
      grantUntil: admin.firestore.Timestamp.fromDate(grantUntil),
      subscriptionStatus: 'none',
      currentPeriodEnd: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Created client "${clientId}" with a ${opts.months}-month grant (until ${grantUntil.toISOString().slice(0,10)}).`);
  } else if (opts.name) {
    await clientRef.set({ name: opts.name }, { merge: true });
  }

  await clientRef.collection('members').doc(emailLc).set({
    role: 'client',
    addedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`Granted ${emailLc} access to client "${clientId}".`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
