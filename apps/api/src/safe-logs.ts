const fields='access_token|refresh_token|client_secret|signed_request|capability|token|code|state|signature|sig|upload_id|x-amz-signature|x-amz-credential|x-amz-security-token|authorization|cookie|set-cookie';
const sensitiveParameter=new RegExp('(\\b(?:'+fields+')\\s*=\\s*)[^&#\\s]*','gi');
const sensitiveJsonField=new RegExp('((?:"|\')?(?:'+fields+')(?:"|\')?\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^\\r\\n,}]+)','gi');
const authorization=/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi;

// Keep the diagnostic context while preventing URL/query and auth-header
// values from entering application logs when an upstream error echoes them.
export function redactSensitiveLogText(value:string):string{
 // Strip every URL query, including unknown capabilities and URL-encoded
 // nested redirects. Host/path remain useful; query values never are logged.
 return value.replace(/https?:\/\/[^\s"'<>]+/gi,url=>url.replace(/[?#].*$/,'?[REDACTED]'))
  .replace(/https?%3a%2f%2f[^\s"'<>]+/gi,url=>url.replace(/(?:%3f|%23).*$/i,'%3F[REDACTED]'))
  .replace(sensitiveParameter,'$1[REDACTED]').replace(sensitiveJsonField,'$1[REDACTED]')
  .replace(authorization,'$1[REDACTED]');
}
