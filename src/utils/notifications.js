import { createServerNotifications } from '../services/adminUserService';

/**
 * Create a notification for a user
 * @param {string} userId - Target user ID
 * @param {object} options - Notification options
 * @param {string} options.title - Notification title
 * @param {string} [options.body] - Notification body/description
 * @param {string} [options.type] - Type: calendar, staff, file, message, permission, system, task
 * @param {string} [options.link] - Optional route to navigate to
 */
export async function createNotification(userId, options) {
  return createNotifications([userId], options);
}

/**
 * Create notifications through the authorized server boundary.
 */
export async function createNotifications(userIds, {
  schoolId,
  title,
  body = '',
  type = 'system',
  link = '',
}) {
  try {
    if (!schoolId || userIds.length === 0) return;
    await createServerNotifications({
      schoolId,
      userIds,
      title,
      body,
      type,
      link,
    });
  } catch {
    console.warn('Unable to create notification.');
  }
}
