// ルールのテストの共通部分（testing.md §3）。npm run test:rules（Firestore Emulator 上）で動く
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

export const projectId = 'demo-maido-ookini';

export function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../firestore.rules'), 'utf8') },
  });
}

// rules-unit-testing の firestore() は compat の型を返すが、modular の関数にそのまま渡せる
export function dbOf(ctx: RulesTestContext): Firestore {
  return ctx.firestore() as unknown as Firestore;
}

// 登場人物（testing.md §3）
export const OWNER = 'owner'; // events/e1 のオーナー
export const ALICE = 'alice'; // events/e1 のメンバー
export const BOB = 'bob'; // ログイン済み・非メンバー
export const CAROL = 'carol'; // 別のイベント（events/e2）のオーナー
export const CREATOR = 'creator'; // creators に登録済み

export const emailOf = (uid: string) => `${uid}@example.com`;

export function as(env: RulesTestEnvironment, uid: string, token: { email?: string; email_verified?: boolean } = {}) {
  return dbOf(env.authenticatedContext(uid, { email: emailOf(uid), email_verified: true, ...token }));
}

export function anon(env: RulesTestEnvironment) {
  return dbOf(env.unauthenticatedContext());
}

export const hoursAgo = (h: number) => Timestamp.fromMillis(Date.now() - h * 60 * 60 * 1000);

export function eventData(ownerUid: string, patch: Record<string, unknown> = {}) {
  return {
    name: '夏祭り',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    floatCash: 10000,
    ownerUid,
    deleting: false,
    createdAt: hoursAgo(48),
    ...patch,
  };
}

export function memberData(uid: string, role: 'owner' | 'member') {
  return { uid, role, displayName: uid, email: emailOf(uid), joinedAt: hoursAgo(48) };
}

// 各テストの前に、Emulator を空にして、基本のデータを入れる（ルールを無視して書く）
export async function seed(env: RulesTestEnvironment, extra?: (db: Firestore) => Promise<void>) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = dbOf(ctx);
    await setDoc(doc(db, 'creators', emailOf(CREATOR)), {});
    await setDoc(doc(db, 'events/e1'), eventData(OWNER));
    await setDoc(doc(db, 'events/e1/members', OWNER), memberData(OWNER, 'owner'));
    await setDoc(doc(db, 'events/e1/members', ALICE), memberData(ALICE, 'member'));
    await setDoc(doc(db, 'events/e2'), eventData(CAROL));
    await setDoc(doc(db, 'events/e2/members', CAROL), memberData(CAROL, 'owner'));
    await extra?.(db);
  });
}

export const DAY = '2026-08-01';

// 注文の行（data-model.md §2.6）
export const orderItems = [{ menuId: 'm1', name: 'たこ焼き', price: 500, qty: 2 }];

// 既存の注文（seed 用。ルールを無視して書くため、時刻は固定値）
export function storedOrder(patch: Record<string, unknown> = {}) {
  return {
    number: 1,
    day: DAY,
    items: orderItems,
    total: 1000,
    payment: 'cash',
    status: 'preparing',
    cancelledFrom: null,
    qr: true,
    createdAt: hoursAgo(1),
    readyAt: null,
    doneAt: null,
    cancelledAt: null,
    createdBy: ALICE,
    updatedBy: ALICE,
    updatedAt: hoursAgo(1),
    ...patch,
  };
}
