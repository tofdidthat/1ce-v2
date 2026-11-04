import test from 'node:test';
import assert from 'node:assert/strict';
import {createPasswordWorkLimiter,passwordWorkPolicy} from '../dist/login-admission.js';

test('password work admission has a strict burst and replenishes at a bounded rate',()=>{
 let time=0;
 const limit=createPasswordWorkLimiter({capacity:3,refillPerSecond:2,now:()=>time});
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),false);
 time=250;assert.equal(limit.take(),false);
 time=500;assert.equal(limit.take(),true);
 assert.equal(limit.take(),false);
 time=2000;
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),true);
 assert.equal(limit.take(),false);
});

test('clock rollback cannot mint extra verification tokens',()=>{
 let time=1000;
 const limit=createPasswordWorkLimiter({capacity:1,refillPerSecond:1,now:()=>time});
 assert.equal(limit.take(),true);
 time=0;assert.equal(limit.take(),false);
 time=1000;assert.equal(limit.take(),false);
 time=2000;assert.equal(limit.take(),true);
});

test('invalid policies and clock failure fail closed',()=>{
 assert.throws(()=>createPasswordWorkLimiter({capacity:0}),/Invalid/);
 assert.throws(()=>createPasswordWorkLimiter({refillPerSecond:0}),/Invalid/);
 assert.throws(()=>createPasswordWorkLimiter({now:()=>NaN}),/Invalid admission clock/);
 let count=0;
 const limit=createPasswordWorkLimiter({capacity:1,now:()=>++count===1?0:NaN});
 assert.equal(limit.take(),false);
 assert.equal(passwordWorkPolicy.sharedPerMinute,480);
});
