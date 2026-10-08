import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedProjection} from '../../shared/public-feed-projection.mjs';
test('authenticated reply labels and censor flags roll back with their public events',()=>{
 const projection=createFeedProjection(message=>Error(message));
 const event=(type,payload)=>({type,payload,position:{blockNumber:'1'}});
 const policy=event('PolicyPublished',{policyVersion:'policy',text:'No threats'});
 const plugin=event('PluginConfigured',{handle:'bok',receiver:'adapter',descriptor:'pinned',enabled:true});
 const post=(postId,orderIndex)=>event('PostPublished',{postId,orderIndex,policyVersion:'policy',text:postId});
 projection.stage([policy,plugin,post('human','0'),event('PluginInvoked',{postId:'human',handle:'bok'})]).apply();
 const reply=projection.stage([post('reply','1'),event('PluginReplyLinked',{postId:'reply',parentId:'human',handle:'bok'}),event('PostFlagged',{postId:'reply',policyVersion:'policy',reason:'Removed'})]);reply.apply();
 let rows=projection.page(10,null,null).posts;
 assert.equal(rows[0].pluginReply.parentId,'human');assert.equal(rows[0].flagged,true);assert.equal(rows[1].replyPostId,'reply');assert.equal(rows[1].flagged,false);
 reply.undo();rows=projection.page(10,null,null).posts;assert.equal(rows.length,1);assert.equal(rows[0].replyPostId,undefined);
 assert.throws(()=>projection.stage([post('other','1'),event('PluginReplyLinked',{postId:'other',parentId:'human',handle:'wrong'})]),/Invalid plugin reply/);
});
