import test from 'node:test';
import assert from 'node:assert/strict';
import {captureThreadAction,linkThreadDrafts} from './thread-action.mjs';
const action=()=>({type:'thread',deposit:'1',contents:['First','Second'],budgets:['0','0']});
test('thread capture binds dense plain values without invoking accessors',()=>{
 const input=action(),captured=captureThreadAction(input);input.contents[0]='Changed';input.budgets[0]='9';
 assert.deepEqual(captured,action());
 let calls=0;const getter=action();Object.defineProperty(getter.contents,'1',{get(){calls++;return 'secret';}});
 assert.throws(()=>captureThreadAction(getter),{code:'ROLLING_INVALID_ACTION'});assert.equal(calls,0);
});
test('thread input rejects malformed or oversized members and unaligned budgets',()=>{
 const bad=[{contents:['one']},{contents:Array(5).fill('post')},{contents:['one','']},{contents:['one','   ']},{contents:['one','\ud800']},{contents:['one','\0']},{contents:['one','🙂'.repeat(249)]},{contents:['one',,'three']},{budgets:['0']},{budgets:['0','01']},{budgets:['0',String(1n<<128n)]},{budget:'5'},{parent:1},{contents:Object.assign(['one','two'],{extra:'secret'})}];
 for(const input of bad)assert.throws(()=>captureThreadAction({...action(),...input}),{code:'ROLLING_INVALID_ACTION'});
 assert.equal(captureThreadAction({...action(),contents:['a'.repeat(992),'🙂'.repeat(248)]}).contents.length,2);
});
test('new thread links every later post to its predecessor and the first root',async()=>{
 const baseDraft={parent:'0',root_reference:'0',name_id:'7',subboard:'8',kind:1};
 const drafts=await linkThreadDrafts({contents:['first','second','third'],nonces:['101','102','103'],baseDraft,postId:async nonce=>String(BigInt(nonce)+1000n),encodeContent:value=>[[value],value.length]});
 assert.deepEqual(drafts.map(({parent,root_reference})=>[parent,root_reference]),[['0','0'],['1101','1101'],['1102','1101']]);
 assert(drafts.every(draft=>draft.name_id==='7'&&draft.subboard==='8'));
});
test('reply thread retains the existing root while its later replies chain locally',async()=>{
 const drafts=await linkThreadDrafts({contents:['first','second'],nonces:['101','102'],baseDraft:{parent:'44',root_reference:'33'},postId:async nonce=>String(BigInt(nonce)+1000n),encodeContent:value=>[[value],value.length]});
 assert.deepEqual(drafts.map(({parent,root_reference})=>[parent,root_reference]),[['44','33'],['1101','33']]);
});
test('thread Bok mix stays within the supported atomic call budget',()=>{
 assert.equal(captureThreadAction({...action(),contents:['one','two','three'],budgets:['0','250000','0']}).budgets[1],'250000');
 for(const input of [{...action(),budgets:['1','2']},{...action(),contents:['one','two','three','four'],budgets:['0','0','1','0']}])assert.throws(()=>captureThreadAction(input),{code:'ROLLING_THREAD_BOK_LIMIT'});
});
