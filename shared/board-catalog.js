// Optional operator labels. Chain identity and addresses are still verified by the public reader.
(function(root){
 let request;
 async function load(network){
  request??=fetch('board-catalog.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)}).then(async response=>{
   if(!response.ok)throw Error('Catalog unavailable');const data=await response.json();
   if(data.schemaVersion!==1||typeof data.network!=='string'||!Array.isArray(data.boards)||data.boards.length>1000)throw Error('Invalid catalog');
   for(const board of data.boards)if(!/^0x[0-9a-f]{64}$/.test(board.address)||typeof board.name!=='string'||board.name.length>100||typeof board.description!=='string'||board.description.length>500||!['current','retired'].includes(board.status))throw Error('Invalid board label');
   return data;
  });
  const data=await request;if(data.network!==[network.chainId,network.rollupAddress,network.rollupVersion].join(':'))return [];
  return data.boards.map(board=>Object.freeze({...board}));
 }
 root.BillboardCatalog=Object.freeze({load});
})(globalThis);
