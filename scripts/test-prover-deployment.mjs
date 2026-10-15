import test from 'node:test';
import assert from 'node:assert/strict';
import {withProverOrigin} from '../deploy/prover/cloudfront.mjs';
test('private prover API preserves website routing, disables cache and submission retries',()=>{
 const base={Origins:{Quantity:1,Items:[{Id:'website'}]},DefaultCacheBehavior:{TargetOriginId:'website'},CacheBehaviors:{Quantity:0}};
 const result=withProverOrigin(base,{vpcOriginId:'vpco-example',privateDnsName:'ip-10-0-0-1.ec2.internal'});
 assert.deepEqual(result.DefaultCacheBehavior,base.DefaultCacheBehavior);assert.equal(base.Origins.Quantity,1);
 assert.equal(result.Origins.Items[1].ConnectionAttempts,1);
 const api=result.CacheBehaviors.Items[0];assert.equal(api.ViewerProtocolPolicy,'https-only');assert(api.AllowedMethods.Items.includes('POST'));assert.equal(api.CachePolicyId,'4135ea2d-6df8-44a3-9df3-4b5a84be39ad');assert.equal(api.FunctionAssociations.Quantity,0);
 assert.deepEqual(withProverOrigin(result,{vpcOriginId:'vpco-example',privateDnsName:'ip-10-0-0-1.ec2.internal'}),result);
});

import {withQueryOperatorOrigin} from '../deploy/prover/cloudfront.mjs';
test('operator exact node route preserves website and proof routes with no cache or key literal',()=>{
 const base={Origins:{Quantity:1,Items:[{Id:'website'}]},DefaultCacheBehavior:{TargetOriginId:'website'},CacheBehaviors:{Quantity:1,Items:[{PathPattern:'/prover/*',TargetOriginId:'old-proof'}]}};
 const options={vpcOriginId:'vo-controlled',privateDnsName:'ip-10-0-0-4.eu-west-2.compute.internal'};
 const value=withQueryOperatorOrigin(base,options),route=value.CacheBehaviors.Items[0],origin=value.Origins.Items[1];
 assert.equal(route.PathPattern,'/v1/node');assert.equal(route.ViewerProtocolPolicy,'https-only');assert.equal(route.CachePolicyId,'4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
 assert.equal(route.OriginRequestPolicyId,'b689b0a8-53d0-40ab-baf2-68738e2966ac');assert.equal(origin.ConnectionAttempts,1);assert.deepEqual(origin.CustomHeaders,{Quantity:0});
 assert.deepEqual(value.DefaultCacheBehavior,base.DefaultCacheBehavior);assert.deepEqual(value.CacheBehaviors.Items[1],base.CacheBehaviors.Items[0]);assert.equal(base.Origins.Quantity,1);
 assert.deepEqual(withQueryOperatorOrigin(value,options),value);assert(!JSON.stringify(value).includes('operatorAuthSha256'));
});
test('operator origin rejects unresolved public addresses URLs and coercible options',()=>{
 const base={Origins:{Quantity:0},CacheBehaviors:{Quantity:0}};
 for(const privateDnsName of ['https://rpc.invalid','public.example','ip-8-8-8-8.ec2.internal','ip-10-999-0-1.ec2.internal','127.0.0.1','ip-10-0-0-1.ec2.internal/path',{},null])assert.throws(()=>withQueryOperatorOrigin(base,{vpcOriginId:'vo-controlled',privateDnsName}));
 for(const vpcOriginId of ['',{},null,'bad/value'])assert.throws(()=>withQueryOperatorOrigin(base,{vpcOriginId,privateDnsName:'ip-10-0-0-4.ec2.internal'}));
});
