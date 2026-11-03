import test from 'node:test';
import assert from 'node:assert/strict';
import {InvalidMedia} from '../src/upload-security.js';
test('invalid media error has stable class',()=>assert.equal(new InvalidMedia('invalid').name,'InvalidMedia'));
