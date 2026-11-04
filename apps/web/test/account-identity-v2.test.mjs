import test from 'node:test';
import assert from 'node:assert/strict';
import {isAccountUserV2} from '../src/account-identity-v2.ts';

test('v2 session accepts a valid minimal account without assuming optional fields',()=>{
 assert.equal(isAccountUserV2({id:42}),true);
 assert.equal(isAccountUserV2({id:42,email:'a@example.test',name:null,picture:null,username:null}),true);
 assert.equal(isAccountUserV2({id:42,name:'Tof',has_avatar:true,avatar_updated_at:'2026-11-04T00:00:00Z'}),true);
});
test('v2 session rejects malformed account payloads rather than trusting an assertion',()=>{
 for(const value of [null,[],{}, {id:0},{id:-1},{id:1.5},{id:'42'},{id:true},{id:42,username:[]},{id:42,has_avatar:'true'},{id:42,picture:42}]){
  assert.equal(isAccountUserV2(value),false,JSON.stringify(value));
 }
});
