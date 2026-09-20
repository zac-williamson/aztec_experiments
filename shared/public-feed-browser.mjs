export {createBoardDirectory} from './public-board-directory.mjs';
import metadata from '../.build/public-feed/metadata.json';
import {connectPublicBoard,connectPublicFeed,browserPublicFeedStorage} from './public-feed-connection.mjs';
export {metadata,connectPublicBoard,connectPublicFeed,browserPublicFeedStorage};
const connections=new Map();
export async function readFeed(options){
 const key=JSON.stringify([options.nodeUrl,options.ethereumUrl,options.portalAddress,options.expectedConfig?.network,options.expectedConfig?.board]);
 if(!connections.has(key)){connections.clear();connections.set(key,{connection:connectPublicFeed({...options,metadata,storage:browserPublicFeedStorage()}).catch(e=>{connections.delete(key);throw e;}),sync:null});}
 const entry=connections.get(key),{feed}=await entry.connection;
 entry.sync??=feed.sync().catch(error=>{if(error.code==='PUBLIC_FEED_CONFLICT'&&connections.get(key)===entry)connections.delete(key);throw error;}).finally(()=>{entry.sync=null;});
 const progress=await entry.sync;
 return {...await feed.page({limit:options.limit??50,cursor:options.cursor??null}),progress};
}
