import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedObservation} from './feed-preferences.mjs';

test('feed measurements survive rerenders without transmitting card identity',()=>{
 const reports=[],view=createFeedObservation({report:(...args)=>reports.push(args)});
 view.observe('private-post-id');view.observe('private-post-id');view.open('private-post-id');view.open('private-post-id');
 assert.deepEqual(reports,[['feed_impression'],['feed_open']]);
 view.reset();view.observe('private-post-id');assert.equal(reports.length,3);
});
test('an immediate click has a denominator and a bounded session stops new counts',()=>{
 const reports=[],view=createFeedObservation({limit:1,report:n=>reports.push(n)});
 assert.equal(view.open('one'),true);assert.equal(view.observe('two'),false);assert.equal(view.open('two'),false);assert.equal(view.open('one'),false);
 assert.deepEqual(reports,['feed_impression','feed_open']);
});
test('invalid cards and reporting failures cannot break reader actions',()=>{
 const view=createFeedObservation({report:()=>{throw Error('offline');}});
 for(const id of ['',null,{},'x'.repeat(101)])assert.equal(view.open(id),false);
 assert.doesNotThrow(()=>view.observe('one'));assert.doesNotThrow(()=>view.open('one'));
});
