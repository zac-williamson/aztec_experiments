import test from 'node:test';import assert from 'node:assert/strict';
import {createBrowserFatalClassifier} from './c01-browser-fatal.mjs';
test('fixed V8 fatal classifications survive chunk boundaries without exposing stderr',()=>{
 for(const cause of ['Reached heap limit','Ineffective mark-compacts near heap limit']){
 const classifier=createBrowserFatalClassifier(),line='FATAL ERROR: '+cause+' Allocation failed - JavaScript heap out of memory\n';
 classifier.push('PRIVATE SECRET\n');for(let i=0;i<line.length;i+=7)classifier.push(Buffer.from(line.slice(i,i+7)));
 assert.equal(classifier.snapshot().category,'NODE_HEAP_OUT_OF_MEMORY');assert(!JSON.stringify(classifier.snapshot()).includes('PRIVATE'));
 }
});
test('unrelated signals and arbitrary text remain unclassified; retained text is bounded',()=>{
 const classifier=createBrowserFatalClassifier();classifier.push('SECRET'.repeat(100000));classifier.push('\nSIGABRT\nrandom heap out of memory\n');
 assert.deepEqual(classifier.snapshot(),{category:null,retainedCharacters:4096});
 classifier.push('prefix FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n');assert.equal(classifier.snapshot().category,null);
});
test('classification remains available after a large trailing stack',()=>{
 const classifier=createBrowserFatalClassifier();classifier.push('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n'+'secret stack'.repeat(10000));assert.equal(classifier.snapshot().category,'NODE_HEAP_OUT_OF_MEMORY');assert(classifier.snapshot().retainedCharacters<=4096);
});
