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
