import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRoutePosition, focusRoute, skipToContent} from './navigation.mjs';
function browserFixture() {
  const calls = [];
  const target = {focus: options => calls.push(['post-focus', options]), scrollIntoView: options => calls.push(['post-scroll', options])};
  const main = {focus: () => calls.push(['main-focus'])};
  const browser = {scrollTo: (...args) => calls.push(['scroll', ...args]), document: {
    getElementById: id => id === 'post-r3' ? target : id === 'content' ? main : null,
    querySelector: () => ({focus: () => calls.push(['heading-focus'])}),
    querySelectorAll: () => []
  }};
  return {calls, target, browser};
}
test('skip action suppresses fragment navigation and focuses main', () => {
  const {calls,browser} = browserFixture();
  let prevented = false;
  skipToContent({preventDefault: () => {prevented = true;}}, browser.document);
  assert.equal(prevented,true);
  assert.deepEqual(calls,[['main-focus']]);
});
test('fresh stable reply link focuses and reveals its reply just like in-app navigation', () => {
  for (const initial of [true,false]) {
    const {calls,target,browser} = browserFixture();
    focusRoute('/thread/first-tools/r3', undefined, initial, browser);
    assert.equal(target.tabIndex,-1);
    assert.deepEqual(calls,[['post-focus',{preventScroll:true}],['post-scroll',{block:'center'}]]);
  }
});
test('fresh Home preserves first-Tab skip-link order, while returning feed restores scroll', () => {
  const {calls,browser} = browserFixture();
  focusRoute('/home',undefined,true,browser);
  assert.deepEqual(calls,[]);
  focusRoute('/home',{y:840},false,browser);
  assert.deepEqual(calls,[['scroll',0,840]]);
});

test('captured return anchor is the first visible public post, with scoped link focus',()=>{
 const older={id:'post-1',getBoundingClientRect:()=>({top:-500,bottom:-10})};
 const visible={id:'post-2',getBoundingClientRect:()=>({top:-10,bottom:200})};
 const browser={scrollY:450,innerHeight:500,document:{querySelectorAll:()=>[older,visible],activeElement:{getAttribute:()=> '#/thread/2',closest:()=>visible}}};
 assert.deepEqual(captureRoutePosition(3,browser),{y:450,pages:3,focus:'#/thread/2',focusPost:'post-2',anchor:{id:'post-2',offset:-10}});
});
test('return anchor offsets changed content and restores the link within its own post',()=>{
 const {calls,browser}=browserFixture();browser.scrollY=100;
 const link={getAttribute:()=> '#/thread/2',focus:o=>calls.push(['correct-link',o])};
 browser.document.getElementById=()=>({getBoundingClientRect:()=>({top:300}),querySelectorAll:()=>[link]});
 focusRoute('/home',{y:100,anchor:{id:'post-2',offset:-10},focus:'#/thread/2',focusPost:'post-2'},false,browser);
 assert.deepEqual(calls,[['scroll',0,410],['correct-link',{preventScroll:true}]]);
});
test('a removed return anchor uses an announced heading instead of a wrong saved pixel',()=>{
 const {calls,browser}=browserFixture(),status={};browser.document.getElementById=id=>id==='announcement'?status:null;
 focusRoute('/home',{y:840,anchor:{id:'post-missing',offset:-10}},false,browser);
 assert.deepEqual(calls,[['scroll',0,0],['heading-focus']]);assert.match(status.textContent,/no longer available/);
});
