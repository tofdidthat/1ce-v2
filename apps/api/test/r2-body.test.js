import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {isR2ReadableBody} from '../dist/r2-body.js';

test('R2 stream guard recognizes actual iterable bodies, not asserted SDK shapes',()=>{
 assert.equal(isR2ReadableBody(Readable.from([Buffer.from('private-media')])),true);
 for(const invalid of [null,undefined,{},'bytes',[],{[Symbol.asyncIterator]:true},
  {[Symbol.asyncIterator]:async function*(){},destroy:'not-a-function'}])
  assert.equal(isR2ReadableBody(invalid),false);
});
