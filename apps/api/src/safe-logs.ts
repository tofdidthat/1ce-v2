const sensitiveParameter=/(\b(?:access_token|refresh_token|client_secret|signed_request|capability|token|code|state|signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token)\s*=\s*)[^&#\s]*/gi;
const sensitiveJsonField=/((?:"|')?(?:access_token|refresh_token|client_secret|signed_request|capability|token|code|state|signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token)(?:"|')?\s*:\s*(?:"|')?)[^"'\s,}]+/gi;
const authorization=/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi;

// Keep the diagnostic context while preventing URL/query and auth-header
// values from entering application logs when an upstream error echoes them.
export function redactSensitiveLogText(value:string):string{
 return value.replace(sensitiveParameter,'$1[REDACTED]').replace(sensitiveJsonField,'$1[REDACTED]')
  .replace(authorization,'$1[REDACTED]');
}
