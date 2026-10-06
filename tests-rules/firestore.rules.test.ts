import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const TEAM = 'neilrgmah@gmail.com';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'avison-young-rental-survey',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowedUsers', TEAM), { added: 'seed' });
    await setDoc(doc(db, 'surveys', 's1'), { title: 'Internal survey', notes: 'secret' });
    await setDoc(doc(db, 'surveys', 's1', 'files', 'workbook'), { data: 'base64' });
    await setDoc(doc(db, 'published', 'abc123'), { title: 'Client snapshot' });
    await setDoc(doc(db, 'published', 'abc123', 'photos', 'p1'), { data: 'jpeg' });
  });
});

const signedOut = () => env.unauthenticatedContext().firestore();
const team = () => env.authenticatedContext('u1', { email: TEAM, email_verified: true }).firestore();
const teamUpperCase = () => env.authenticatedContext('u1', { email: 'NeilRGMah@Gmail.com', email_verified: true }).firestore();
const stranger = () => env.authenticatedContext('u2', { email: 'someone@gmail.com', email_verified: true }).firestore();
const unverified = () => env.authenticatedContext('u3', { email: TEAM, email_verified: false }).firestore();

describe('surveys (internal)', () => {
  it('signed-out user cannot read or write', async () => {
    const db = signedOut();
    await assertFails(getDoc(doc(db, 'surveys', 's1')));
    await assertFails(getDocs(collection(db, 'surveys')));
    await assertFails(setDoc(doc(db, 'surveys', 's2'), { title: 'x' }));
    await assertFails(getDoc(doc(db, 'surveys', 's1', 'files', 'workbook')));
  });

  it('signed-in user who is not on the list cannot read or write', async () => {
    const db = stranger();
    await assertFails(getDoc(doc(db, 'surveys', 's1')));
    await assertFails(getDocs(collection(db, 'surveys')));
    await assertFails(setDoc(doc(db, 'surveys', 's2'), { title: 'x' }));
    await assertFails(deleteDoc(doc(db, 'surveys', 's1')));
    await assertFails(getDoc(doc(db, 'surveys', 's1', 'files', 'workbook')));
    await assertFails(setDoc(doc(db, 'surveys', 's1', 'files', 'new'), { data: 'x' }));
  });

  it('listed user with an unverified email is refused', async () => {
    await assertFails(getDoc(doc(unverified(), 'surveys', 's1')));
  });

  it('listed user can read, list, write and delete surveys and files', async () => {
    const db = team();
    await assertSucceeds(getDoc(doc(db, 'surveys', 's1')));
    await assertSucceeds(getDocs(collection(db, 'surveys')));
    await assertSucceeds(setDoc(doc(db, 'surveys', 's2'), { title: 'new' }));
    await assertSucceeds(setDoc(doc(db, 'surveys', 's1', 'files', 'photo1'), { data: 'x' }));
    await assertSucceeds(getDoc(doc(db, 'surveys', 's1', 'files', 'workbook')));
    await assertSucceeds(deleteDoc(doc(db, 'surveys', 's2')));
  });

  it('email matching ignores case', async () => {
    await assertSucceeds(getDoc(doc(teamUpperCase(), 'surveys', 's1')));
  });
});

describe('published snapshots', () => {
  it('anyone, signed out included, can get a snapshot and photo by id', async () => {
    await assertSucceeds(getDoc(doc(signedOut(), 'published', 'abc123')));
    await assertSucceeds(getDoc(doc(signedOut(), 'published', 'abc123', 'photos', 'p1')));
    await assertSucceeds(getDoc(doc(stranger(), 'published', 'abc123')));
  });

  it('nobody can list the published collection or its photos', async () => {
    for (const db of [signedOut(), stranger(), team()]) {
      await assertFails(getDocs(collection(db, 'published')));
      await assertFails(getDocs(collection(db, 'published', 'abc123', 'photos')));
    }
  });

  it('only listed users can publish, change or unpublish', async () => {
    for (const db of [signedOut(), stranger(), unverified()]) {
      await assertFails(setDoc(doc(db, 'published', 'new1'), { title: 'x' }));
      await assertFails(setDoc(doc(db, 'published', 'abc123'), { title: 'tampered' }));
      await assertFails(deleteDoc(doc(db, 'published', 'abc123')));
      await assertFails(setDoc(doc(db, 'published', 'abc123', 'photos', 'p2'), { data: 'x' }));
      await assertFails(deleteDoc(doc(db, 'published', 'abc123', 'photos', 'p1')));
    }
    const db = team();
    await assertSucceeds(setDoc(doc(db, 'published', 'new1'), { title: 'x' }));
    await assertSucceeds(setDoc(doc(db, 'published', 'new1', 'photos', 'p1'), { data: 'x' }));
    await assertSucceeds(deleteDoc(doc(db, 'published', 'new1')));
  });
});

describe('allowedUsers', () => {
  it('nobody can write it from a client, not even a listed user', async () => {
    await assertFails(setDoc(doc(team(), 'allowedUsers', 'friend@gmail.com'), { x: 1 }));
    await assertFails(setDoc(doc(stranger(), 'allowedUsers', 'someone@gmail.com'), { x: 1 }));
    await assertFails(deleteDoc(doc(team(), 'allowedUsers', TEAM)));
  });

  it('nobody can list it', async () => {
    await assertFails(getDocs(collection(team(), 'allowedUsers')));
    await assertFails(getDocs(collection(signedOut(), 'allowedUsers')));
  });

  it('a user can check only their own entry', async () => {
    await assertSucceeds(getDoc(doc(team(), 'allowedUsers', TEAM)));
    await assertFails(getDoc(doc(stranger(), 'allowedUsers', TEAM)));
    await assertFails(getDoc(doc(signedOut(), 'allowedUsers', TEAM)));
  });
});

describe('everything else', () => {
  it('unknown collections are denied for everyone', async () => {
    await assertFails(getDoc(doc(team(), 'misc', 'x')));
    await assertFails(setDoc(doc(team(), 'misc', 'x'), { a: 1 }));
  });
});
