import { HttpsError } from 'firebase-functions/v2/https';
import { ZodError } from 'zod';

export function invalidArgument() {
  return new HttpsError('invalid-argument', 'הבקשה אינה תקינה.');
}

export function permissionDenied() {
  return new HttpsError('permission-denied', 'אין הרשאה לבצע פעולה זו.');
}

export function unauthenticated() {
  return new HttpsError('unauthenticated', 'נדרשת התחברות מחדש.');
}

export function failedPrecondition() {
  return new HttpsError('failed-precondition', 'לא ניתן לבצע את הפעולה במצב הנוכחי.');
}

export function publicError(code, reason, message = 'לא ניתן להשלים את הפעולה כעת.') {
  return new HttpsError(code, message, { reason });
}

export function toPublicError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof ZodError) return invalidArgument();
  return new HttpsError('internal', 'לא ניתן להשלים את הפעולה כעת.');
}
