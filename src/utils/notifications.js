import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

/**
 * Create a notification for a user
 * @param {string} userId - Target user ID
 * @param {object} options - Notification options
 * @param {string} options.title - Notification title
 * @param {string} [options.body] - Notification body/description
 * @param {string} [options.type] - Type: calendar, staff, file, message, permission, system, task
 * @param {string} [options.link] - Optional route to navigate to
 */
export async function createNotification(userId, { title, body = '', type = 'system', link = '' }) {
  try {
    await addDoc(collection(db, 'notifications'), {
      userId,
      title,
      body,
      type,
      link,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Failed to create notification:', err);
  }
}

/**
 * Create notifications for multiple users
 */
export async function createNotifications(userIds, options) {
  for (const userId of userIds) {
    await createNotification(userId, options);
  }
}
