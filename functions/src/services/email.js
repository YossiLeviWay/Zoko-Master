import { defineSecret, defineString } from 'firebase-functions/params';
import { publicError } from './errors.js';

export const EMAIL_PROVIDER_API_KEY = defineSecret('EMAIL_PROVIDER_API_KEY');
export const EMAIL_FROM = defineString('EMAIL_FROM', { default: 'Zoko-Master <noreply@example.invalid>' });
export const APP_BASE_URL = defineString('APP_BASE_URL', { default: 'http://localhost:5173' });

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function emulatorMode() {
  return process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

async function sendEmail({ to, subject, html }) {
  if (emulatorMode()) return { delivery: 'emulated' };
  const apiKey = EMAIL_PROVIDER_API_KEY.value();
  if (!apiKey || EMAIL_FROM.value().endsWith('@example.invalid>')) {
    throw publicError('failed-precondition', 'email-provider-error', 'שירות הדוא״ל טרם הוגדר.');
  }
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM.value(), to: [to], subject, html }),
    });
  } catch {
    throw publicError('unavailable', 'email-provider-error', 'שירות הדוא״ל אינו זמין כרגע.');
  }
  if (!response.ok) throw publicError('unavailable', 'email-provider-error', 'שירות הדוא״ל אינו זמין כרגע.');
  return { delivery: 'sent' };
}

export function invitationUrl(invitationId, token) {
  return `${APP_BASE_URL.value().replace(/\/$/, '')}/#/register?invitation=${encodeURIComponent(`${invitationId}.${token}`)}`;
}

export async function sendInvitationEmail({ email, fullName, schoolName, invitationId, token, expiresAt }) {
  const url = invitationUrl(invitationId, token);
  return sendEmail({
    to: email,
    subject: `הזמנה להצטרפות אל ${schoolName}`,
    html: `<div dir="rtl" lang="he"><p>שלום ${escapeHtml(fullName)},</p><p>הוזמנת להצטרף אל ${escapeHtml(schoolName)}.</p><p><a href="${escapeHtml(url)}">קבלת ההזמנה והגדרת סיסמה</a></p><p>הקישור חד־פעמי ותקף עד ${escapeHtml(expiresAt.toDate().toLocaleDateString('he-IL'))}.</p></div>`,
  });
}

export async function sendPasswordResetLinkEmail({ email, fullName, resetLink }) {
  return sendEmail({
    to: email,
    subject: 'איפוס סיסמה ל־Zoko-Master',
    html: `<div dir="rtl" lang="he"><p>שלום ${escapeHtml(fullName || '')},</p><p>התקבלה בקשה לאיפוס הסיסמה.</p><p><a href="${escapeHtml(resetLink)}">יצירת סיסמה חדשה</a></p><p>אם לא ביקשתם זאת, ניתן להתעלם מהודעה זו.</p></div>`,
  });
}
