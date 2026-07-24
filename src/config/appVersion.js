export const APP_VERSION = 'v1.03';

export const APP_BUILD_INFO = Object.freeze({
  buildDate: import.meta.env.APP_BUILD_DATE || '',
  commit: import.meta.env.APP_COMMIT_SHA || 'local',
  environment: import.meta.env.MODE || 'development',
});
