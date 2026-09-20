let directory,networkId,count=0;
const el=id=>document.getElementById(id);
async function findBoards(){
 el('more').hidden=true;el('status').textContent='Finding boards…';
 try{
  let result;
  // A bounded batch keeps discovery resumable without an indexer service.
  for(let page=0;page<20;page++){
   result=await directory.next();
   for(const board of result.boards){
    const card=document.createElement('article');card.className='card';const link=document.createElement(board.ready?'a':'span');
    const url=new URL('feed.html',location.href);url.hash='network='+networkId+'&board='+board.address;if(board.ready)link.href=url.href;
    link.textContent='Board '+board.address.slice(0,10)+'…'+board.address.slice(-6);card.append(link);if(!board.ready){const status=document.createElement('p');status.textContent=board.unavailable?'This board is unavailable.':'Setup is not complete yet.';card.append(status);}el('boards').append(card);count++;
   }
   el('status').textContent=count+' board'+(count===1?'':'s')+' found. Searching…';
   if(result.complete)break;
  }
  el('more').hidden=result.complete;
  el('status').textContent=result.complete?(count?count+' board'+(count===1?'':'s')+' found.':'No compatible boards found.')+' Search complete through block '+result.block+'.':count+' boards found so far. More history remains to search.';
 }catch(error){if(error.code==='BB_DIRECTORY_REORG'){el('boards').replaceChildren();count=0;}el('status').textContent='Could not finish finding boards. Reload to start a new search. The list above may be incomplete.';}
}
(async()=>{
 try{
  const config=await loadHostedSettings();networkId=[config.network.chainId,config.network.rollupAddress,config.network.rollupVersion].join(':');
  el('network').textContent='Aztec on '+(config.network.chainId==='11155111'?'Sepolia':config.network.chainId==='1'?'Ethereum mainnet':'Ethereum network '+config.network.chainId)+'.';
  directory=BillboardPublic.createBoardDirectory({network:config.network,metadata:BillboardPublic.metadata});await findBoards();
 }catch{el('status').textContent='The board directory is unavailable. Reload to try again.';}
})();
el('more').onclick=findBoards;
