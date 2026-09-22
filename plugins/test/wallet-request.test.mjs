import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {PAYMENT_ABI,messageHash} from '../protocol.mjs';
import {validatePluginWalletRequest} from '../devnet/wallet-harness.mjs';
const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),postId='0x'+'03'.repeat(32),text='@bok inspect PR 1';
const descriptor={scope:{chainId:'31337'},payment:{contractAddress:target,amountWei:'1000000000000000'}};
const tx={from:account,to:target,value:'0x38d7ea4c68000',chainId:'0x7a69',data:new Interface(PAYMENT_ABI).encodeFunctionData('pay',[postId,messageHash(text)])};
test('wallet automation approves only the expected local payment request',()=>{
 assert.equal(validatePluginWalletRequest({request:[tx],descriptor,account,text}),postId);
 for(const change of [{from:target},{to:account},{value:'0x1'},{chainId:'0x1'},{data:new Interface(PAYMENT_ABI).encodeFunctionData('pay',[postId,messageHash('different')])}])assert.throws(()=>validatePluginWalletRequest({request:[{...tx,...change}],descriptor,account,text}));
 assert.throws(()=>validatePluginWalletRequest({request:[tx,tx],descriptor,account,text}));
 assert.throws(()=>validatePluginWalletRequest({request:[tx],descriptor:{...descriptor,scope:{chainId:'1'}},account,text}));
});
