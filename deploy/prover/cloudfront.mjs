/** Pure distribution update: one private origin and one uncached API behavior. */
export function withProverOrigin(current,{originId='board-prover',vpcOriginId,privateDnsName}){
 if(!vpcOriginId||!privateDnsName)throw Error('Resolved VPC origin required');
 const config=structuredClone(current);
 const origins=(config.Origins.Items??[]).filter(o=>o.Id!==originId);
 origins.push({Id:originId,DomainName:privateDnsName,OriginPath:'',CustomHeaders:{Quantity:0},ConnectionAttempts:1,ConnectionTimeout:10,VpcOriginConfig:{VpcOriginId:vpcOriginId,OriginReadTimeout:30,OriginKeepaliveTimeout:5}});
 config.Origins={Quantity:origins.length,Items:origins};
 const items=(config.CacheBehaviors.Items??[]).filter(b=>b.PathPattern!=='/prover/*');
 items.unshift({PathPattern:'/prover/*',TargetOriginId:originId,TrustedSigners:{Enabled:false,Quantity:0},TrustedKeyGroups:{Enabled:false,Quantity:0},ViewerProtocolPolicy:'https-only',AllowedMethods:{Quantity:7,Items:['GET','HEAD','OPTIONS','PUT','PATCH','POST','DELETE'],CachedMethods:{Quantity:2,Items:['GET','HEAD']}},SmoothStreaming:false,Compress:false,LambdaFunctionAssociations:{Quantity:0},FunctionAssociations:{Quantity:0},FieldLevelEncryptionId:'',CachePolicyId:'4135ea2d-6df8-44a3-9df3-4b5a84be39ad',OriginRequestPolicyId:'216adef6-5c7f-47e4-b989-5492eafa07d3'});
 config.CacheBehaviors={Quantity:items.length,Items:items};
 return config;
}

/** Operator data-plane only. Origin service independently authenticates all calls.
 * Actual VPC-origin protocol/port and managed security group require readback.
 */
export function withQueryOperatorOrigin(current,{vpcOriginId,privateDnsName}) {
 if(typeof vpcOriginId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(vpcOriginId)
   ||typeof privateDnsName!=='string'||! /^ip-(?:[0-9]{1,3}-){3}[0-9]{1,3}(?:\.[a-z0-9-]+)?\.(?:compute|ec2)\.internal$/.test(privateDnsName))throw Error('Resolved private query origin required');
 const octets=privateDnsName.match(/^ip-([0-9]+)-([0-9]+)-([0-9]+)-([0-9]+)/).slice(1).map(Number);
 if(octets.some(n=>n>255)||!(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)))throw Error('Private query address required');
 const originId='rolling-query-operator',config=structuredClone(current);
 const origins=(config.Origins.Items??[]).filter(o=>o.Id!==originId);
 origins.push({Id:originId,DomainName:privateDnsName,OriginPath:'',CustomHeaders:{Quantity:0},ConnectionAttempts:1,ConnectionTimeout:10,VpcOriginConfig:{VpcOriginId:vpcOriginId,OriginReadTimeout:30,OriginKeepaliveTimeout:5}});
 config.Origins={Quantity:origins.length,Items:origins};
 const items=(config.CacheBehaviors.Items??[]).filter(b=>b.PathPattern!=='/v1/node');
 // This managed all-viewer-except-host policy forwards x-aztec-api-key. No key
 // is a CloudFront custom header, URL, cache key, log field or config literal.
 items.unshift({PathPattern:'/v1/node',TargetOriginId:originId,TrustedSigners:{Enabled:false,Quantity:0},TrustedKeyGroups:{Enabled:false,Quantity:0},ViewerProtocolPolicy:'https-only',AllowedMethods:{Quantity:7,Items:['GET','HEAD','OPTIONS','PUT','PATCH','POST','DELETE'],CachedMethods:{Quantity:2,Items:['GET','HEAD']}},SmoothStreaming:false,Compress:false,LambdaFunctionAssociations:{Quantity:0},FunctionAssociations:{Quantity:0},FieldLevelEncryptionId:'',CachePolicyId:'4135ea2d-6df8-44a3-9df3-4b5a84be39ad',OriginRequestPolicyId:'b689b0a8-53d0-40ab-baf2-68738e2966ac'});
 config.CacheBehaviors={Quantity:items.length,Items:items};return config;
}
