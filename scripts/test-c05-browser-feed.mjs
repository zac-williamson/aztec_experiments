// Actual browser feed functions and actual reason codec, with DOM/RPC doubles.
// This checks presentation/ABI integration, not network execution or proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const engine = vm.createContext({performance, console, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout });
vm.runInContext(source('apps/src/billboard/user/engine.js'), engine);
const codec = engine.BillboardModerationCodec;
const ids = [(1n << 240n) + 31n, (1n << 241n) + 47n];
const text = 'Visible <message> with Unicode café 🌍';
const flaggedText = 'Flagged content preserved for explicit viewing';
const reason = 'Policy reason: ' + 'é'.repeat(75);
const packedReason = codec.packModerationReason(reason);
class Element {
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.dataset={};this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this.attributes[name]=value;}
  querySelectorAll(selector){assert.equal(selector,'article[data-post-id]');return this.children.filter(node=>node.tag==='article'&&node.dataset.postId);}
}
for (const app of ['user', 'censor']) {
  test(app + ' renders stable public IDs, Unicode and moderation reasons without wallet reads', () => {
    const container=new Element('div'),moderated=[];
    // Exercise the presentation interface both controllers use. No wallet/RPC is available.
    const context=vm.createContext({URL,location:new URL('https://board.test/'+app+'.html#board=example'),document:{activeElement:null,createElement:tag=>new Element(tag)}});
    vm.runInContext(source('shared/board-view.js'),context);
    const posts=[{orderIndex:'0',postId:ids[0].toString(),text,flagged:false},{orderIndex:'1',postId:ids[1].toString(),text:flaggedText,flagged:true,flag:{reason:codec.decodeModerationReason(packedReason.fields,packedReason.byteLength),censorAddress:'0x1234'}}];
    context.BillboardView.renderMessages(container,posts,app==='censor'?{onModerate:post=>moderated.push(post.postId)}:{});
    const [visible,flagged]=container.children;
    assert.equal(visible.dataset.postId,ids[0].toString());assert.equal(flagged.dataset.postId,ids[1].toString());
    assert.equal(visible.children[0].children[1].href.searchParams.get('message'),ids[0].toString());
    assert.equal(visible.children[1].textContent,text);
    assert.equal(flagged.children[1].textContent,'Message removed by moderator.');
    assert.equal(flagged.children[2].textContent,'Reason: '+reason);
    if(app==='censor'){
      const details=flagged.children[3];assert.equal(details.tag,'details');assert.equal(details.children[0].tag,'summary');
      assert.equal(details.children[1].textContent,flaggedText);
      visible.children[2].onclick();assert.deepEqual(moderated,[ids[0].toString()]);
    }else{
      assert(!JSON.stringify(flagged).includes(flaggedText));
    }
    context.BillboardView.renderMessages(container,posts,app==='censor'?{onModerate:post=>moderated.push(post.postId)}:{});
    assert.equal(container.children[0],visible,'unchanged messages retain their DOM identity');
  });
}
