import {messageHash, scopeHash} from './protocol.mjs';

/** @param {import('./interfaces.d.ts').WorkerDependencies} dependencies
 * @returns {import('./interfaces.d.ts').PluginWorker}
 */
export function createPluginWorker({scope,payments,board,dispatch,runner}) {
  return {
    async handle(payment) {
      await payments.verify();await payments.verifyEvent(payment);
      const request=await board.readRequest(payment.postId);
      if(!request)return {state:'waiting-for-post'};
      if(!request.finalized)return {state:'waiting-for-finality'};
      if(request.receiver!==scope.receiver||request.flagged||!request.enabled||request.replyPostId) return {state:'ineligible'};
      if(messageHash(request.text)!==payment.messageHash)throw Error('Paid message mismatch');
      const id=scopeHash(scope)+':'+payment.postId;
      if(!await dispatch.claim(id))return {state:'already-dispatched'};
      // Claim deliberately has no lease/retry: a crashed invocation is abandoned.
      const output=await runner.run({id,postId:payment.postId,text:request.text,amountWei:payment.amountWei});
      messageHash(output.replyText);
      const current=await board.readRequest(payment.postId);
      if(!current||current.flagged||!current.enabled||current.replyPostId)return {state:'ineligible'};
      await board.reply(payment.postId,output.replyText);
      return {state:'replied'};
    },
  };
}
