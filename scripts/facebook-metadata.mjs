/** Public configuration only: the Facebook App Secret must never reach this build. */
export function facebookMetadata(appId, required = false) {
  const id = appId?.trim();
  if (!id) {
    if (required) throw new Error('FACEBOOK_APP_ID repository variable is required for deployment');
    return [];
  }
  if (!/^[0-9]+$/.test(id)) throw new Error('FACEBOOK_APP_ID must contain only digits');
  return [{ tag: 'meta', attrs: { property: 'fb:app_id', content: id }, injectTo: 'head' }];
}
