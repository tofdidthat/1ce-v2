import test from 'node:test';
import assert from 'node:assert/strict';
import {redactSensitiveLogText} from '../dist/safe-logs.js';

test('sensitive query values and authorization headers are redacted without losing diagnostics',()=>{
 const message='GET https://graph.example/refresh?grant_type=ig_refresh_token&access_token=synthetic-access&client_secret=synthetic-secret; Authorization: Bearer synthetic-bearer';
 const safe=redactSensitiveLogText(message);
 assert.match(safe,/graph\.example\/refresh\?grant_type=ig_refresh_token/);
 assert.equal((safe.match(/\[REDACTED\]/g)||[]).length,3);
 assert.doesNotMatch(safe,/synthetic-access|synthetic-secret|synthetic-bearer/);
});

test('capabilities, OAuth codes, state and signed requests never survive log redaction',()=>{
 const safe=redactSensitiveLogText('token=one&capability=two&code=three&state=four&signed_request=five&refresh_token=six');
 assert.doesNotMatch(safe,/one|two|three|four|five|six/);
 assert.equal((safe.match(/\[REDACTED\]/g)||[]).length,6);
});

test('structured provider errors also redact sensitive JSON fields',()=>{
 const safe=redactSensitiveLogText('{"access_token":"synthetic-access","client_secret":"synthetic-secret","X-Amz-Signature":"synthetic-signature","error":"upstream failed"}');
 assert.doesNotMatch(safe,/synthetic-access|synthetic-secret|synthetic-signature/);
 assert.match(safe,/upstream failed/);
 assert.equal((safe.match(/\[REDACTED\]/g)||[]).length,3);
});

test('temporary media and R2 URLs redact query capabilities and signatures',()=>{
 const safe=redactSensitiveLogText('https://api.invalid/media?token=temporary-capability https://r2.invalid/file?X-Amz-Credential=temporary-credential&X-Amz-Signature=temporary-signature');
 assert.doesNotMatch(safe,/temporary-capability|temporary-credential|temporary-signature/);
 assert.equal((safe.match(/\[REDACTED\]/g)||[]).length,3);
});
