import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGoogleAccessToken,parseVerifiedGoogleUser} from '../dist/google-identity.js';

test('Google token parsing accepts only a nonempty string access token',()=>{
 assert.equal(parseGoogleAccessToken({access_token:'test-token'}),'test-token');
 for(const candidate of [null,[],{},'token',{access_token:0},{access_token:''}]){
  assert.throws(()=>parseGoogleAccessToken(candidate),/Google access token missing/);
 }
});
test('Google identity decoder accepts verified userinfo with optional text fields',()=>{
 const data={sub:'google-sub-42',email:'artist@example.test',email_verified:true,name:'Artist',picture:null};
 assert.deepEqual(parseVerifiedGoogleUser(data),data);
 const minimum=parseVerifiedGoogleUser({sub:'google-sub-42',email:'artist@example.test',email_verified:true});
 assert.equal(minimum.sub,'google-sub-42');
 assert.equal(minimum.name,undefined);
});
test('Google identity decoder rejects malformed or unverified userinfo before account linkage',()=>{
 const valid={sub:'sub',email:'artist@example.test',email_verified:true};
 for(const bad of [null,[],{}, {sub:'sub',email:'artist@example.test',email_verified:false},
  {...valid,sub:42},{...valid,email:42},{...valid,name:{}},{...valid,picture:[]},
  {...valid,email_verified:'true'}]){
  assert.throws(()=>parseVerifiedGoogleUser(bad),/Google identity not verified/);
 }
});
