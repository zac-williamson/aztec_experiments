// Mock public API for the rollingchat review preview. Serves synthetic boards, names
// and a seeded conversation under the same /api/* routes the live reader uses, and a
// /__mock/post sink that the mock wallet runtime publishes to. Posts created during a
// review are kept in Netlify Blobs so they survive cold starts; they read as pending
// for a few seconds and then confirmed. No real chain, custody or proofs are involved.
import type {Config, Context} from '@netlify/functions';
import {getStore} from '@netlify/blobs';

type Post={id:string;record:{root:string;parent:string;reference:string;kind:string;subboard:string;name_id:string};text:string|null;likes:string;timestamp:string;mainVersion:string;localVersion:string;position:{blockNumber:string;blockHash:string;txHash:string;txIndexWithinBlock:string;logIndexWithinTx:string};bot?:unknown;confirmation?:string;removal?:unknown;created?:number};

const hex=(seed:number,len=64)=>{let s='';let x=seed*2654435761>>>0;while(s.length<len){x=(x*1103515245+12345)>>>0;s+=x.toString(16).padStart(8,'0');}return '0x'+s.slice(0,len);};
const BOK='0x0000000000000000000000000000000000000000000000000000000000626f6b';

const names:Record<string,unknown>={
 '7':{id:'7',first:'River',last:'Lane',profile:{bio:{text:'Learning by making. Sharing a few things along the way.',version:'1'},avatar:{version:'0'}}},
 '8':{id:'8',first:'Ellis',last:'Moss',profile:{bio:{text:'Making small tools for a more interesting internet.',version:'1'},avatar:{version:'0'}}},
 '9':{id:'9',first:'Mira',last:'Vale',profile:{bio:{text:'Collecting questions. Sometimes finding answers.',version:'2'},avatar:{version:'0'}}},
 '10':{id:'10',first:'Rowan',last:'Lake',profile:{bio:{text:'',version:'0'},avatar:{version:'0'}}},
 '11':{id:'11',first:'Jules',last:'Reed',profile:{bio:{text:'Cities, maps, and the spaces between.',version:'1'},avatar:{version:'0'}}}
};
const mainPolicy={version:'3',text:'1. Make room for disagreement. Critique ideas, not people.\n2. Do not publish private personal information.\n3. No spam, scams or threats.'};
const policies=[mainPolicy,{version:'2',text:'1. Critique ideas, not people.\n2. No private personal information.'}];
const board=(id:string,slug:string,name:string,description:string,rules:string,extra:Record<string,unknown>={})=>({id,slug,name,description,rules,mainRules:mainPolicy.text,mainVersion:mainPolicy.version,creationVersion:'2',rejected:false,rejection:null,...extra});
const boards:Record<string,ReturnType<typeof board>>={
 '20':board('20','building','Building things','Show the rough edges. Share what you are making and build together with Bok.','Describe what you are building and give useful context.'),
 '21':board('21','ideas','Unfinished ideas','A home for the questions you have not quite worked out yet.','Welcome questions and constructive uncertainty.'),
 '22':board('22','field-notes','Field notes','Interesting things noticed away from the screen.','Include context for observations.'),
 '23':board('23','open-data','Open data','Explore public datasets and make them useful.','Cite the source of a dataset.'),
 '24':board('24','no-rules','No rules','Rejected subboard. Content is unavailable.','',{rejected:true,rejection:{reason:'The proposed local rules contradicted the main board policy on private personal information.',mainVersion:'2'}})
};

type Seed={root?:string;parent?:string;reference?:string;kind?:string;subboard?:string;name?:string;text:string|null;likes?:string;age?:number;bot?:unknown;confirmation?:string|null;removal?:unknown};
function seeded(now:number){
 let block=10240;
 const post=(id:string,{root=id,parent='0',reference='0',kind='1',subboard='0',name='0',text,likes='0',age=3600,bot=null,confirmation='confirmed',removal}:Seed):Post=>{
  block-=3;
  return {id,record:{root,parent,reference,kind,subboard,name_id:name},text,likes,timestamp:String(now-age),mainVersion:'3',localVersion:subboard==='0'?'0':'1',
   position:{blockNumber:String(block),blockHash:hex(Number(id)+7),txHash:hex(Number(id)+99),txIndexWithinBlock:'0',logIndexWithinTx:'0'},
   ...(bot?{bot}:{}),...(confirmation?{confirmation}:{}),...(removal?{removal}:{})};
 };
 const posts=[
  post('106',{subboard:'22',name:'10',text:'Noticed this morning that the fountain in the square only runs on weekdays. Someone, somewhere, is paying for the water.',age:240,confirmation:'pending'}),
  post('103',{root:'101',parent:'102',subboard:'20',text:'Here is a self-contained map page. It reads readings.csv from the same folder, projects points with an equirectangular transform and colours them by temperature.\nApp: https://example.com/t/map/index.html\nSource: https://example.com/t/map/source.json',likes:'5',age:1500,bot:{requestId:hex(3),pluginId:BOK}}),
  post('102',{root:'101',parent:'101',subboard:'20',name:'8',text:'@bok could you sketch a single-page map that reads a CSV of lat/lon/temperature and plots it with no dependencies?',likes:'2',age:2100}),
  post('110',{subboard:'20',name:'8',text:'Looking for two people to test a small tool that turns a thread into a printable zine. Rough, but it works. Reply here and I will share the link.',likes:'4',age:5400}),
  post('107',{kind:'2',reference:'105',subboard:'21',name:'11',text:'This is the question. Rules you can read, rules you can trust, rules nobody can quietly change.',likes:'9',age:7000}),
  post('101',{subboard:'20',name:'7',text:'Spent the weekend wiring a tiny weather station to a solar panel. The board stays asleep until the sun is up, then posts a reading every ten minutes.\n\nNext step: a shared map of readings from everyone who builds one. [Build log](https://example.com/weather)',likes:'12',age:10800}),
  post('105',{subboard:'21',name:'9',text:'Half-formed thought: what if a board’s rules were versioned like code, and every post carried the version it was published under?\n\nOh wait. That is exactly what this place does. Still: how would you show that to a newcomer without a wall of text?',likes:'21',age:20000}),
  post('108',{kind:'3',reference:'104',name:'7',text:'',age:30000}),
  post('109',{text:null,age:40000,removal:{reason:'Published a private home address.',policy:'3'}}),
  post('104',{text:'A useful conversation can start with a small question and a patient reply. Private participation should still leave the ideas open to everyone.',likes:'8',age:86400*2}),
  // Thread 101 exercises the fold rules: liked deep branch, quiet sibling, depth-5 fold, fan-out, removed reply.
  post('111',{root:'101',parent:'103',subboard:'20',name:'7',text:'That renders fine on the phone. Could the colour scale be fixed so two days are comparable?',likes:'1',age:1800}),
  post('112',{root:'101',parent:'111',subboard:'20',name:'8',text:'Fixed scale, yes. Pick the range once from the first file and keep it.',age:1700}),
  post('113',{root:'101',parent:'112',subboard:'20',name:'7',text:'Agreed. @bok can you pin the scale to -10…40°C and add a legend?',age:1600}),
  post('114',{root:'101',parent:'113',subboard:'20',text:'Pinned the scale and added a legend in the corner; the page still has no dependencies.',age:1500,bot:{requestId:hex(5),pluginId:BOK}}),
  post('115',{root:'101',parent:'102',subboard:'20',name:'11',text:'A CSV is a good choice. Most of these stations end up exporting one anyway.',age:1400}),
  post('116',{root:'101',parent:'115',subboard:'20',text:'Until someone adds a column in the middle of the file.',age:1300}),
  post('117',{root:'101',parent:'115',subboard:'20',name:'9',text:'Header row names, not positions. Then a new column is harmless.',likes:'1',age:1200}),
  post('118',{root:'101',parent:'101',subboard:'20',name:'9',text:'How is the panel holding up in the rain? Mine died in a week.',likes:'3',age:1900}),
  post('119',{root:'101',parent:'118',subboard:'20',name:'7',text:'Under a plastic lid so far. First real storm is next week.',likes:'2',age:1000}),
  post('120',{root:'101',parent:'118',subboard:'20',text:'Silicone around the cable gland. That is where mine let water in.',age:900}),
  post('121',{root:'101',parent:'118',subboard:'20',name:'8',text:'Conformal coating on the board helps more than the box does.',likes:'1',age:800}),
  post('122',{root:'101',parent:'118',subboard:'20',name:'10',text:'Mine survived two winters with a cheap junction box and a drip loop.',age:700}),
  post('123',{root:'101',parent:'118',subboard:'20',name:'11',text:'Drip loop is the whole trick.',age:600}),
  post('124',{root:'101',parent:'118',subboard:'20',text:'Would a tilted panel shed the water better?',age:500}),
  post('125',{root:'101',parent:'118',subboard:'20',name:'9',text:'Tilt helps the panel; the box still needs the loop.',age:400}),
  post('126',{root:'101',parent:'101',subboard:'20',text:null,age:950,removal:{reason:'Published a private phone number.',policy:'3'}}),
  post('127',{root:'101',parent:'126',subboard:'20',name:'10',text:'Replying to the removed post: the station page itself is a good idea.',age:850})
 ];
 return {posts,block};
}

// Review posts live in Blobs (site-wide store, strong reads). If Blobs is unavailable
// the function falls back to instance memory and says so in the logs.
const memory:Post[]=[];
let blobsBroken=false;
const store=()=>getStore({name:'review-posts',consistency:'strong'});
async function reviewPosts():Promise<Post[]>{
 if(!blobsBroken)try{
  const {blobs}=await store().list();
  const items=await Promise.all(blobs.map(blob=>store().get(blob.key,{type:'json'}) as Promise<Post|null>));
  return items.filter((item):item is Post=>!!item&&typeof item.id==='string').sort((a,b)=>(b.created??0)-(a.created??0));
 }catch(error){blobsBroken=true;console.warn('review-posts store unavailable, using instance memory:',(error as Error).message);}
 return [...memory];
}
async function saveReviewPost(post:Post){
 if(!blobsBroken)try{await store().setJSON(post.id,post);return;}catch(error){blobsBroken=true;console.warn('review-posts store unavailable, using instance memory:',(error as Error).message);}
 memory.unshift(post);
}

const PENDING_MS=8000;
const fresh=(p:Post):Post=>{if(p.created===undefined)return p;const {created,...rest}=p;return {...rest,confirmation:Date.now()-created<PENDING_MS?'pending':'confirmed'};};

function api(route:string,q:URLSearchParams,all:Post[],block:number){
 const live=all.map(fresh);
 const byId=new Map(live.map(p=>[p.id,p]));
 const checkpoint={number:block+40,hash:hex(1)},confirmationCheckpoint={number:block+30,hash:hex(2)};
 const base=()=>({schemaVersion:1,scope:{chainId:'31337',rollupVersion:'1',boardAddress:hex(42)},complete:true,checkpoint,confirmationCheckpoint,revision:'7',names,boards,nextCursor:null,mainPolicy,policies});
 const limit=Math.min(100,Math.max(1,Number(q.get('limit'))||30));
 if(route==='home')return {...base(),posts:live.filter(p=>p.text!==null||p.removal).slice(0,limit)};
 if(route==='board'){const id=q.get('id')??'';if(id!=='0'&&!boards[id])return null;return {...base(),boardId:id,board:id==='0'?null:boards[id],posts:live.filter(p=>p.record.subboard===id&&p.record.parent==='0')};}
 if(route==='thread'){const root=q.get('root')??'';if(!byId.has(root))return null;return {...base(),posts:live.filter(p=>p.record.root===root).sort((a,b)=>Number(a.id)-Number(b.id))};}
 if(route==='post'){const id=q.get('id')??'';const post=byId.get(id);if(!post)return null;return {...base(),post};}
 if(route==='profile'){const id=q.get('nameId')??'';if(!names[id])return null;return {...base(),identity:names[id],posts:live.filter(p=>p.record.name_id===id)};}
 if(route==='directory'){const query=(q.get('query')||'').toLowerCase();return {...base(),boards:Object.values(boards).filter(b=>!query||(b.name+' '+b.slug+' '+b.description).toLowerCase().includes(query))};}
 if(route==='following'){const bs=(q.get('boards')||'').split(',').filter(Boolean),ns=(q.get('names')||'').split(',').filter(Boolean);return {...base(),posts:live.filter(p=>bs.includes(p.record.subboard)||ns.includes(p.record.name_id)),following:{boards:bs.map(id=>({id,name:id==='0'?'Main board':boards[id]?.name})),names:ns.map(id=>names[id]).filter(Boolean)}};}
 if(route==='bookmarks'){const ids=(q.get('ids')||'').split(',').filter(Boolean);return {...base(),posts:live.filter(p=>ids.includes(p.id))};}
 return null;
}

const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const digits=(value:unknown)=>typeof value==='string'&&/^\d{1,20}$/.test(value);

export default async (req:Request,_context:Context)=>{
 const url=new URL(req.url);
 const path=url.pathname;
 if(path==='/api/events')return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
 const now=Math.floor(Date.now()/1000);
 const {posts:seed,block}=seeded(now);
 if(path==='/__mock/post'){
  if(req.method!=='POST')return json(405,{error:'POST only'});
  let payload:{action?:Record<string,unknown>;txHash?:unknown};
  try{payload=await req.json();}catch{return json(400,{error:'Expected JSON'});}
  const action=payload?.action??{};
  const type=typeof action.type==='string'?action.type:'post';
  if(!['post','reply','quote','repost','bok'].includes(type))return json(400,{error:'Unsupported action'});
  const review=await reviewPosts();
  const known=new Set([...seed,...review].map(p=>p.id));
  const reply=digits(action.parent)&&action.parent!=='0';
  if(reply&&(!known.has(action.parent as string)||!digits(action.root)||!known.has(action.root as string)))return json(400,{error:'Unknown parent or root'});
  const subboard=digits(action.subboard)?action.subboard as string:'0';
  if(subboard!=='0'&&!boards[subboard])return json(400,{error:'Unknown subboard'});
  const content=typeof action.content==='string'?action.content.slice(0,4000):'';
  const id=String(Date.now());
  const created:Post={id,record:{root:reply?action.root as string:id,parent:reply?action.parent as string:'0',reference:digits(action.reference)?action.reference as string:'0',kind:type==='quote'?'2':type==='repost'?'3':'1',subboard,name_id:digits(action.name)?action.name as string:'0'},
   text:content,likes:'0',timestamp:String(now),mainVersion:'3',localVersion:subboard==='0'?'0':'1',
   position:{blockNumber:String(block-3*(review.length+1)),blockHash:hex(review.length+11),txHash:typeof payload.txHash==='string'&&/^0x[0-9a-f]{64}$/i.test(payload.txHash)?payload.txHash:hex(review.length+99),txIndexWithinBlock:'0',logIndexWithinTx:'0'},
   created:Date.now()};
  await saveReviewPost(created);
  return json(200,{id});
 }
 if(path.startsWith('/api/')){
  const review=await reviewPosts();
  const data=api(path.slice(5),url.searchParams,[...review,...seed],block);
  return data?json(200,data):json(404,{});
 }
 return json(404,{});
};

export const config:Config={path:['/api/*','/__mock/post']};
