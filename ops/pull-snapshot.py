#!/usr/bin/env python3
"""Root timer imports one private, sanitized aggregate snapshot using the host role."""
import argparse, datetime, grp, importlib.util, json, os, pathlib, tempfile

def project(value, now=None):
 spec=importlib.util.spec_from_file_location('external_probe',pathlib.Path(__file__).with_name('external-probe.py'))
 external=importlib.util.module_from_spec(spec);spec.loader.exec_module(external)
 if not isinstance(value,dict) or value.get('schemaVersion')!=1:raise ValueError('Invalid snapshot')
 timestamp=datetime.datetime.fromisoformat(value['observedAt'].replace('Z','+00:00'))
 now=now or datetime.datetime.now(datetime.timezone.utc)
 if timestamp.tzinfo is None or not -30<=(now-timestamp).total_seconds()<=180:raise ValueError('Snapshot unavailable')
 source=value.get('external',{});observed=source.get('observedAt')
 ext_time=datetime.datetime.fromisoformat(observed.replace('Z','+00:00'))
 if ext_time.tzinfo is None or not -30<=(now-ext_time).total_seconds()<=180:raise ValueError('External observation unavailable')
 out={'hosts':{},'external':{'schemaVersion':1,'observedAt':ext_time.isoformat()}}
 for role in ('core','bok'):
  host=external.sanitize_host(value.get('hosts',{}).get(role),role,now)
  if host:out['hosts'][role]=host
 for key in ('website','prover','feed'):
  item=source.get(key,{})
  if type(item.get('ok')) is not bool:continue
  out['external'][key]={'ok':item['ok']}
  if external.numeric(item.get('latencyMs'),60000):out['external'][key]['latencyMs']=item['latencyMs']
 return out

def add_local_projections(value, directory):
 def read(name):
  try:
   path=directory/name
   if path.stat().st_size>4096:return {}
   source=json.loads(path.read_text());return source if isinstance(source,dict) else {}
  except (OSError,ValueError):return {}
 def timestamp(value):
  try:
   dt=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
   return dt.isoformat() if dt.tzinfo else None
  except (AttributeError,ValueError,TypeError):return None
 source=read('spending.json');spending={}
 if timestamp(source.get('observedAt')):spending['observedAt']=timestamp(source['observedAt'])
 for key in ('limitUsd','forecastUsd','incurredUsd'):
  candidate=source.get(key)
  if type(candidate) in (int,float) and 0<=candidate<1e12:spending[key]=candidate
 if spending:value['spending']=spending
 source=read('backup-status.json');backup={}
 if source.get('configured') is True:backup['configured']=True
 for key in ('lastSuccessAt','lastVerifiedRestoreAt'):
  if timestamp(source.get(key)):backup[key]=timestamp(source[key])
 if backup:value['backup']=backup
 return value

def main():
 from botocore.config import Config
 import boto3
 parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
 config=json.loads(pathlib.Path(args.config).read_text())
 response=boto3.client('s3',region_name=config['region'],config=Config(connect_timeout=3,read_timeout=5,retries={'total_max_attempts':1})).get_object(Bucket=config['bucket'],Key='snapshots/latest.json')
 stream=response['Body']
 try:raw=stream.read(65537)
 finally:stream.close()
 if len(raw)>65536:raise ValueError('Snapshot too large')
 destination=pathlib.Path('/var/lib/rolling-ops/reliability-inputs.json');value=add_local_projections(project(json.loads(raw)),destination.parent)
 # Optional local projections are configured by the trusted operator separately.
 # A failed pull leaves the previous observation timestamp unchanged; dashboard expires it.
 fd,temporary=tempfile.mkstemp(prefix='.inputs-',dir=destination.parent)
 try:
  os.fchmod(fd,0o640);os.fchown(fd,0,grp.getgrnam('rolling-ops').gr_gid)
  with os.fdopen(fd,'w') as output:json.dump(value,output,separators=(',',':'),allow_nan=False);output.flush();os.fsync(output.fileno())
  os.replace(temporary,destination)
 finally:
  if os.path.exists(temporary):os.unlink(temporary)
if __name__=='__main__':
 try:main()
 except Exception:raise SystemExit('Aggregate snapshot unavailable; previous observation will expire.')
