import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerPreviewV2,previewSecondsV2} from '../src/player-preview-v2.ts';
import {nextQueueTrackV2} from '../src/playback-queue-v2.ts';

test('initially disabled, then counts 29 seconds from the current media position',()=>{
 const clock=new PlayerPreviewV2();
 clock.resume(0);
 assert.equal(clock.sample(43),false);
 clock.setEnabled(true,43);
 assert.equal(clock.sample(43+previewSecondsV2-.01),false);
 assert.equal(clock.sample(43+previewSecondsV2),true);
});

test('pause, buffering and a seek leave the amount played intact',()=>{
 const clock=new PlayerPreviewV2();
 clock.setEnabled(true,0);
 clock.suspend(10);
 assert.equal(clock.sample(20),false);
 clock.resume(10);
 assert.equal(clock.sample(18),false);
 clock.suspend();
 assert.equal(clock.sample(110),false);
 clock.resume(110);
 clock.suspend(116);
 assert.equal(clock.sample(126),false);
 clock.resume(116);
 assert.equal(clock.sample(120),false);
 assert.equal(clock.sample(121),true);
});

test('turning off cancels the old countdown; each subsequent track starts fresh',()=>{
 const clock=new PlayerPreviewV2();
 clock.setEnabled(true,0);
 assert.equal(clock.sample(28),false);
 clock.setEnabled(false,null);
 assert.equal(clock.sample(33),false);
 clock.setEnabled(true,33);
 assert.equal(clock.sample(61),false);
 assert.equal(clock.sample(62),true);
 assert.equal(clock.claimTransition(),true);
 assert.equal(clock.claimTransition(),false);
 assert.equal(clock.sample(63),false);
 clock.resetTrack();
 clock.resume(0);
 assert.equal(clock.sample(28),false);
 assert.equal(clock.sample(29),true);
});

test('short tracks can end normally and preview uses existing queue and repeat rules',()=>{
 const a={id:'a',owner_id:2},b={id:'b',owner_id:2},c={id:'c',owner_id:3};
 const queue=[a,b,c];
 const clock=new PlayerPreviewV2();
 clock.setEnabled(true,0);
 assert.equal(clock.sample(8),false);
 assert.equal(nextQueueTrackV2(queue,a,'off',false),b);
 assert.equal(clock.claimTransition(),true);
 assert.equal(clock.claimTransition(),false);
 assert.equal(nextQueueTrackV2(queue,c,'off',false),null);
 assert.equal(nextQueueTrackV2(queue,c,'all',false),a);
 assert.equal(nextQueueTrackV2(queue,c,'one',false),c);
 assert.equal(nextQueueTrackV2([a],a,'all',false),a);
 assert.equal(nextQueueTrackV2(queue,b,'off',true,()=>.9),c);
});
