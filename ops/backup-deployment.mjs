/** Pure deployment documents. Root reviews/applies them; importing never calls AWS. */
export function backupCloudConfiguration({bucket,region,accountId,role,kmsKeyArn}){
 if(!/^[-a-z0-9]{3,63}$/.test(bucket)||!/^[-a-z0-9]+-\d$/.test(region)||!/^\d{12}$/.test(accountId)||!['core','bok'].includes(role)||!new RegExp('^arn:aws:kms:'+region+':'+accountId+':key/[a-z0-9-]+$').test(kmsKeyArn))throw Error('Invalid backup deployment');
 const arn='arn:aws:s3:::'+bucket,parameter='arn:aws:ssm:'+region+':'+accountId+':parameter/rolling/operations/backup-key/'+role;
 return {
  publicAccessBlock:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true},
  ownershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},
  lifecycle:{Rules:['core','bok'].map(name=>({ID:'rolling-ops-'+name,Status:'Enabled',Filter:{Prefix:'rolling-ops/'+name+'/'},Expiration:{Days:7},NoncurrentVersionExpiration:{NoncurrentDays:7},AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}}))},
  bucketPolicy:{Version:'2012-10-17',Statement:[{Sid:'RequireTLS',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[arn,arn+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}}]},
  rolePolicy:{Version:'2012-10-17',Statement:[
   {Effect:'Allow',Action:['s3:GetObject','s3:PutObject'],Resource:arn+'/rolling-ops/'+role+'/*'},
   {Effect:'Allow',Action:['s3:GetLifecycleConfiguration','s3:GetBucketPublicAccessBlock','s3:GetBucketVersioning'],Resource:arn},
   {Effect:'Allow',Action:'ssm:GetParameter',Resource:parameter},
   {Effect:'Allow',Action:'kms:Decrypt',Resource:kmsKeyArn,Condition:{StringEquals:{'kms:ViaService':'ssm.'+region+'.amazonaws.com','kms:EncryptionContext:PARAMETER_ARN':parameter}}},
  ]},
 };
}
export function backupUnits({role,nodeBinary,codeDirectory,configFile,analyticsDirectory}){
 const safe=v=>typeof v==='string'&&/^\/[A-Za-z0-9/_.-]+$/.test(v)&&!v.split('/').includes('..');
 if(!['core','bok'].includes(role)||![nodeBinary,codeDirectory,configFile].every(safe)||role==='core'&&!safe(analyticsDirectory))throw Error('Invalid backup unit');
 const runtime='rolling-ops-backup-'+role,state='rolling-ops-backup-'+role;
 return {
  service:`[Unit]\nDescription=Rolling encrypted ${role} backup and restore check\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nUser=root\nUMask=0077\nExecStart=${nodeBinary} ${codeDirectory}/ops/backup-job.mjs ${configFile}\nTimeoutStartSec=10min\nRuntimeDirectory=${runtime}\nRuntimeDirectoryMode=0700\nStateDirectory=${state}\nStateDirectoryMode=0700\nProtectSystem=strict\nProtectHome=read-only\nPrivateTmp=true\nNoNewPrivileges=true\nRestrictSUIDSGID=true\nReadWritePaths=/var/lib/${state} /run/${runtime}${role==='core'?' '+analyticsDirectory:''}\nStandardOutput=null\nStandardError=journal\n`,
  timer:`[Unit]\nDescription=Daily Rolling ${role} backup\n\n[Timer]\nOnCalendar=*-*-* 03:${role==='core'?'10':'25'}:00 UTC\nRandomizedDelaySec=10min\nPersistent=true\nUnit=rolling-ops-backup-${role}.service\n\n[Install]\nWantedBy=timers.target\n`,
 };
}
