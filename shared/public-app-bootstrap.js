// Public settings only. No network or wallet action occurs during bootstrap.
(function(root){
  root.loadHostedSettings=async function(){
    const response=await fetch('board-reader-config.json',{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Board settings unavailable');
    return root.BillboardConfig.parse(await response.text());
  };
  root.loadHostedBoard=async function(link){
    const explicit=link!==undefined;let fragment;try{const parsed=explicit?new URL(link):new URL(location.href);if(explicit&&(!['https:','http:'].includes(parsed.protocol)||!parsed.hash))throw Error();fragment=parsed.hash;}catch{throw Object.assign(Error('Invalid board link'),{code:'BB_BOARD_LINK_INVALID'});}
    const hosted=await root.loadHostedSettings();
    const networkId=[hosted.network.chainId,hosted.network.rollupAddress,hosted.network.rollupVersion].join(':');
    const match=fragment.match(/^#network=([0-9]+:0x[0-9a-f]{40}:[0-9]+)&board=(0x[0-9a-f]{64})$/);
    if(fragment&&!match)throw Object.assign(Error('Invalid board link'),{code:'BB_BOARD_LINK_INVALID'});
    if(match&&match[1]!==networkId)throw Object.assign(Error('Unsupported network'),{code:'BB_BOARD_NETWORK_UNSUPPORTED'});
    const boardAddress=match?match[2]:hosted.board.contractAddress;
    const result=await root.BillboardPublic.connectPublicBoard({network:hosted.network,boardAddress,metadata:root.BillboardPublic.metadata,storage:root.BillboardPublic.browserPublicFeedStorage()});
    return {...result,config:root.BillboardConfig.validate({...result.config,privateFee:hosted.privateFee,...(boardAddress===hosted.board.contractAddress&&hosted.remoteProver?{remoteProver:hosted.remoteProver}:{})}),fragment:'network='+networkId+'&board='+boardAddress};
  };
  root.boardConnectionFailure=error=>({BB_BOARD_LINK_INVALID:{message:'This board link is incomplete or invalid. Choose a board from the directory.',retry:false},BB_BOARD_NETWORK_UNSUPPORTED:{message:'This site does not serve the network in that link. Open it on the board operator’s site.',retry:false},BB_BOARD_INCOMPATIBLE:{message:'This board uses a different contract version. Ask its operator for the matching app.',retry:false},BB_BOARD_NOT_FOUND:{message:'No board was found at this address. Check the link with its operator.',retry:false}}[error?.code]||{message:'The board could not be reached. Your account and messages are unchanged. Try again.',retry:true});
  if(document.body?.hasAttribute('data-public-board-reader'))return;
  if(document.body?.hasAttribute('data-hosted-board')){
    // Page-local settings cannot inherit or overwrite another board's saved settings.
    root.billboardConfigStore=root.BillboardConfig.createStore({persistence:'page'});
    root.initializeHostedBoard=async function(initialize){
      const status=document.getElementById('setupStatus');status.textContent='Loading board…';
      try{
        const requestedHash=location.hash,result=await root.loadHostedBoard();
        if(location.hash!==requestedHash){location.reload();return;}
        const link=new URL(location.href);link.hash=result.fragment;history.replaceState(null,'',link);
        for(const anchor of document.querySelectorAll('[data-board-link]')){const target=new URL(anchor.href);target.hash=result.fragment;anchor.href=target.href;anchor.hidden=!result.config.privateFee&&target.pathname.split('/').pop()!=='feed.html';}
        root.addEventListener('hashchange',()=>location.reload(),{once:true});
        if(!result.config.privateFee){status.textContent='Posting and fee funding are not enabled for this board. You can still read messages.';return;}
        root.billboardConfigStore.install(result.config);
        status.textContent='Board ready. Connect your wallet to continue.';initialize();
      }catch(error){const failure=root.boardConnectionFailure(error);status.textContent=failure.message;if(failure.retry){const retry=document.createElement('button');retry.className='secondary';retry.textContent='Try again';retry.onclick=()=>root.initializeHostedBoard(initialize);status.append(retry);}}
    };
    return;
  }
  let storage;try{storage=root.localStorage;}catch{}
  const moderatorPage=document.body?.hasAttribute('data-moderator-board');
  const selectedFragment=c=>'#network='+[c.network.chainId,c.network.rollupAddress,c.network.rollupVersion].join(':')+'&board='+c.board.contractAddress;
  root.rememberSelectedBoard=function(config){config=root.BillboardConfig.validate(config);history.replaceState({...history.state,billboardSelectedConfiguration:config},'',selectedFragment(config));};
  root.forgetSelectedBoard=function(){const state={...history.state,billboardSelectedConfiguration:null};history.replaceState(state,'',location.pathname+location.search);};
  root.reloadSelectedBoard=async function(){
    const selected=root.billboardConfigStore.snapshot(),config=root.BillboardConfig.validate(selected.config);
    await root.BillboardAccount.endSession();
    root.billboardConfigStore.assertCurrent(selected);root.rememberSelectedBoard(config);
    location.reload();
  };
  const incomingModerator=moderatorPage&&!!location.hash;
  root.billboardConfigStore=root.BillboardConfig.createStore({storage:storage||null,persistence:incomingModerator||(moderatorPage&&Object.hasOwn(history.state??{},'billboardSelectedConfiguration'))?'page':'device',eventTarget:root});
  root.initializeSelectedBoard=async function(initialize){
    if(!incomingModerator){initialize();return;}
    const navigation=history.state?.billboardSelectedConfiguration;
    if(navigation){try{const config=root.BillboardConfig.validate(navigation);if(selectedFragment(config)===location.hash){root.billboardConfigStore.install(config);initialize();return;}}catch{}}
    const requested=location.href,before=root.billboardConfigStore.snapshot(),status=document.getElementById('setupStatus');status.textContent='Loading the selected board…';
    try{const result=await root.loadHostedBoard(requested);
      if(location.href!==requested||root.billboardConfigStore.snapshot().revision!==before.revision)return;
      root.billboardConfigStore.install(result.config);status.textContent='';initialize();
    }catch(error){if(location.href!==requested||root.billboardConfigStore.snapshot().revision!==before.revision)return;const failure=root.boardConnectionFailure(error);status.textContent=failure.message;if(failure.retry){const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>root.initializeSelectedBoard(initialize);status.append(retry);}}
  };
  if(document.body?.hasAttribute('data-moderator-board'))root.addEventListener('hashchange',()=>location.reload());
  const mount=()=>{
    if(document.getElementById('deploymentManifest'))return;
    const container=document.createElement('div');container.id='boardConfiguration';container.className='card';
    (document.getElementById('boardSelection')||document.querySelector('main')||document.body).prepend(container);root.BillboardConfigUI.mount(container,root.billboardConfigStore);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(globalThis);
