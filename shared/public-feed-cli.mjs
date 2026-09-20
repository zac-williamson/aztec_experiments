import fs from 'node:fs';
import path from 'node:path';
import {connectPublicFeed} from './public-feed-connection.mjs';
import {publicFeedFileStorage} from './public-feed-file-storage.mjs';
export {publicFeedFileStorage} from './public-feed-file-storage.mjs';
export async function listPublicFeed({root,nodeUrl,ethereumUrl,portalAddress,cacheDirectory=path.join(root,'.public-feed-cache')}){
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'apps/dist/public-feed-metadata.json'),'utf8'));
 const {feed,scope}=await connectPublicFeed({nodeUrl,ethereumUrl,portalAddress,metadata,storage:publicFeedFileStorage(cacheDirectory)}),progress=await feed.sync();
 if(!progress.complete)throw Object.assign(new Error(`Public feed backfill reached block ${progress.lastBlock}; retry to continue saved progress.`),{code:'BB_PUBLIC_FEED_BACKFILL'});
 let cursor=null,posts=[];const byVersion=new Map();
 do {const page=await feed.page({limit:200,cursor});for(const policy of page.policies){const old=byVersion.get(policy.policyVersion);if(old&&JSON.stringify(old)!==JSON.stringify(policy))throw Error('Conflicting public policy across pages');byVersion.delete(policy.policyVersion);byVersion.set(policy.policyVersion,policy);}posts.push(...page.posts);cursor=page.nextCursor;if(posts.length>10000)throw Error('Public moderation input exceeds its10000-post limit; configure a bounded moderation queue.');}while(cursor);
 const policies=[...byVersion.values()],policy=policies.at(-1);if(!policy)throw Error('Public moderation policy is unavailable.');
 return {scope,count:posts.length,posts:posts.map(p=>{const index=Number(p.orderIndex),timestamp=Number(p.publishedAt);if(!Number.isSafeInteger(index)||!Number.isSafeInteger(timestamp))throw Error('Public post index is out of range.');return {index,postId:p.postId,text:p.text,flagged:p.flagged,timestamp,policyVersion:p.policyVersion,flagDeadline:p.flagDeadline,censorResponse:p.flag?.reason??null,flaggedBy:p.flag?.censorAddress??null,publication:p.publication,flagEvent:p.flag?{schemaVersion:1,scope,type:'PostFlagged',position:p.flag.position,payload:{postId:p.flag.postId,reason:p.flag.reason,flaggedAt:p.flag.flaggedAt,censorAddress:p.flag.censorAddress,policyVersion:p.flag.policyVersion}}:null};}),policy:policy.text,policyVersion:policy.policyVersion,censorWindow:Number(policy.censorWindow),policies,checkpoint:progress.checkpoint,revision:progress.revision};
}
