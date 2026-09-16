import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connectPublicFeed} from './public-feed-connection.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
// Reuse the atomic private-directory file primitive for a separate PUBLIC cache.
// Values are public JSON, not encrypted wallet journals; never share directories.
export function publicFeedFileStorage(directory){
 const files=createFileJournalStorage(directory),previous=new Map(),keyOf=key=>createHash('sha256').update(key).digest('hex');
 return {async get(key){const value=await files.read(keyOf(key));previous.set(key,value);return value;},async set(key,value){await files.compareAndSwap(keyOf(key),previous.get(key)??null,value);previous.set(key,value);}};
}
export async function listPublicFeed({root,nodeUrl,ethereumUrl,portalAddress,cacheDirectory=path.join(root,'.public-feed-cache')}){
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'apps/dist/public-feed-metadata.json'),'utf8'));
 const {feed}=await connectPublicFeed({nodeUrl,ethereumUrl,portalAddress,metadata,storage:publicFeedFileStorage(cacheDirectory)}),progress=await feed.sync();
 if(!progress.complete)throw Object.assign(new Error(`Public feed backfill reached block ${progress.lastBlock}; retry to continue saved progress.`),{code:'BB_PUBLIC_FEED_BACKFILL'});
 let cursor=null,posts=[],policies;
 do {const page=await feed.page({limit:200,cursor});policies=page.policies;posts.push(...page.posts);cursor=page.nextCursor;if(posts.length>10000)throw Error('Public moderation input exceeds its10000-post limit; configure a bounded moderation queue.');}while(cursor);
 const policy=policies.at(-1);if(!policy)throw Error('Public moderation policy is unavailable.');
 return {count:posts.length,posts:posts.map(p=>{const index=Number(p.orderIndex),timestamp=Number(p.publishedAt);if(!Number.isSafeInteger(index)||!Number.isSafeInteger(timestamp))throw Error('Public post index is out of range.');return {index,postId:p.postId,text:p.text,flagged:p.flagged,timestamp,policyVersion:p.policyVersion,flagDeadline:p.flagDeadline,censorResponse:p.flag?.reason??null,flaggedBy:p.flag?.censorAddress??null};}),policy:policy.text,policyVersion:policy.policyVersion,censorWindow:Number(policy.censorWindow),policies,checkpoint:progress.lastBlock};
}
