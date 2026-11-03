// Read-only inspection of S2 server-verified R2 objects.
// R2 listing and SQL reads are not an atomic snapshot. Never delete on a match.
import {createHash} from 'node:crypto';

export const ORPHAN_AUDIT_GRACE_HOURS=72;
const pattern=/^users\/[1-9]\d*\/assets\/(audio|cover|stems)\/verified\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp3|wav|jpg|jpeg|png|webp|zip)$/i;
const extensions={
 audio:new Set(['mp3','wav']),
 cover:new Set(['jpg','jpeg','png','webp']),
 stems:new Set(['zip'])
};
export function isS2VerifiedKey(key){
 const match=typeof key==='string'?pattern.exec(key):null;
 return !!match&&extensions[match[1].toLowerCase()].has(match[2].toLowerCase());
}
export function validAuditPrefix(prefix){
 return typeof prefix==='string'&&/^users\/(?:[1-9]\d*\/)?$/.test(prefix);
}

export async function auditVerifiedOrphans({
 listPage,findReferences,prefix='users/',now=new Date(),
 minAgeHours=ORPHAN_AUDIT_GRACE_HOURS,maxPages=20,maxKeys=1000,sampleLimit=20
}={}){
 if(typeof listPage!=='function'||typeof findReferences!=='function')
  throw new Error('R2 listing and DB reference lookup are required');
 if(!validAuditPrefix(prefix))
  throw new Error('Audit prefix must be users/ or users/<numeric-id>/');
 if(!Number.isSafeInteger(minAgeHours)||minAgeHours<72||minAgeHours>8760)
  throw new Error('Audit grace must be at least 72 hours');
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100||
  !Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>1000||
  !Number.isSafeInteger(sampleLimit)||sampleLimit<0||sampleLimit>100)
  throw new Error('Invalid bounded audit configuration');
 const current=new Date(now).getTime();
 if(!Number.isFinite(current))throw new Error('Invalid audit clock');
 const cutoff=current-minAgeHours*3600000;
 const stats={
  scope:prefix==='users/'?'all-users':'single-user',graceHours:minAgeHours,pages:0,objectsListed:0,
  verifiedObjects:0,notOldEnough:0,missingMetadata:0,referenced:0,
  suspectedOrphans:0,suspectedBytes:0,sampleFingerprints:[]
 };
 let token,more=false;
 const seen=new Set();
 for(let page=0;page<maxPages;page++){
  const response=await listPage({prefix,continuationToken:token,maxKeys});
  if(!response||!Array.isArray(response.Contents??[]))
   throw new Error('Invalid R2 listing; audit cannot claim completion');
  stats.pages++;
  const eligible=[];
  for(const entry of response.Contents??[]){
   stats.objectsListed++;
   if(typeof entry.Key!=='string'||!entry.Key.startsWith(prefix)||!isS2VerifiedKey(entry.Key))
    continue;
   stats.verifiedObjects++;
   const modified=new Date(entry.LastModified).getTime();
   const size=Number(entry.Size);
   if(!Number.isFinite(modified)||modified>current||
    !Number.isSafeInteger(size)||size<0){stats.missingMetadata++;continue;}
   if(modified>cutoff){stats.notOldEnough++;continue;}
   eligible.push({key:entry.Key,size,modified});
  }
  if(eligible.length){
   const refs=await findReferences(eligible.map(x=>x.key));
   if(!Array.isArray(refs)||refs.some(k=>typeof k!=='string'))
    throw new Error('Invalid database references; audit cannot claim completion');
   const referenced=new Set(refs);
   for(const obj of eligible){
    if(referenced.has(obj.key)){stats.referenced++;continue;}
    stats.suspectedOrphans++;
    stats.suspectedBytes+=obj.size;
    if(stats.sampleFingerprints.length<sampleLimit)
     stats.sampleFingerprints.push({
      keyFingerprint:createHash('sha256').update(obj.key).digest('hex').slice(0,20),
      bytes:obj.size,ageHours:Math.floor((current-obj.modified)/3600000)
     });
   }
  }
  more=response.IsTruncated===true;
  if(!more)break;
  if(typeof response.NextContinuationToken!=='string'||!response.NextContinuationToken||
   seen.has(response.NextContinuationToken))
   throw new Error('R2 pagination failed; audit cannot claim completion');
  token=response.NextContinuationToken;
  seen.add(token);
 }
 const complete=!more&&stats.missingMetadata===0;
 return {
  ...stats,complete,
  status:!complete?'incomplete':stats.suspectedOrphans?'suspected-orphans':'no-candidates',
  readOnly:true,
  note:'Candidates are not proof of safe deletion; R2 listing and DB state are not an atomic snapshot.'
 };
}
