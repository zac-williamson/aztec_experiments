// Presentation of authoritative escrow state. No service database or provider coupling.
export function requestStatus({postId,state,call,reserved,charged,deadline},chainTime) {
 const terminal={3:'Reply published',4:'Cancelled',5:'Expired funds released',6:'Stopped without a reply',7:'Stopped; provider outcome uncertain'};
 const expired=(state===2||state===7)&&chainTime>=deadline;
 return {postId,state,call,reserved:String(reserved),charged:String(charged),deadline,
  status:expired?'Expired; release reserved funds':terminal[state]??(state===1?'Waiting for the operator':state===2?'Processing':'Unknown request'),
  canCancel:(state===1||state===2)&&BigInt(reserved)===0n,
  canRelease:expired};
}
