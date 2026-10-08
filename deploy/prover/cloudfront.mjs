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
