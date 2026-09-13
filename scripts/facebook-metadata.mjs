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

/** Only the public page URL is exposed to the client. */
export function facebookPageUrl(value, required = false) {
  const text = value?.trim();
  if (!text) {
    if (required) throw new Error('FACEBOOK_PAGE_URL repository variable is required for deployment');
    return '';
  }
  const url = new URL(text);
  if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('FACEBOOK_PAGE_URL must be an HTTPS Facebook page URL');
  return url.href;
}
