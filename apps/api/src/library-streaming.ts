// Private library streaming GET routes (audio, stems, cover). The facade has
// already checked method, session and R2 configuration before calling this
// function. Do not move those security gates into this module or expose these
// routes publicly.
import {GetObjectCommand} from '@aws-sdk/client-s3';
import {isR2ReadableBody} from './r2-body.js';
import {resolveAuthorizedMediaFile} from './project-media.js';
import {streamAuthorizedAudio} from './audio-stream.js';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {S3Client} from '@aws-sdk/client-s3';
import type {QueryableV2} from '../../../packages/shared/contracts.js';

type SendLibraryJson=(res:ServerResponse,status:number,data:unknown)=>void;

// A false result preserves the facade's existing generic 404 fallback.
export async function handlePrivateLibraryStream(
 req:IncomingMessage,res:ServerResponse,segments:readonly string[],
 pool:QueryableV2,ownerId:number,s3:S3Client,bucket:string,send:SendLibraryJson
):Promise<boolean>{
 // Stems remain private to the authenticated owner; public access is never granted.
 if(segments.length===5&&segments[3]==='stems'&&/^\d+$/.test(segments[4])){
  const file=await resolveAuthorizedMediaFile(pool,{ownerId,viewerId:ownerId,fileId:segments[4],kind:'stems'});
  if(!file){send(res,404,{error:'Stems not found'});return true;}
  await streamAuthorizedAudio(req,res,{file,s3,bucket});return true;
 }
 if(segments.length===5&&segments[3]==='audio'&&/^\d+$/.test(segments[4])){
  const id=segments[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId,viewerId:ownerId,fileId:id,kind:'audio'});
  if(!file){send(res,404,{error:'Audio not found'});return true;}
  await streamAuthorizedAudio(req,res,{file,s3,bucket});return true;
 }
 if(segments.length===5&&segments[3]==='cover'&&/^\d+$/.test(segments[4])){
  const id=segments[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId,viewerId:ownerId,fileId:id,kind:'cover'});
  if(!file){send(res,404,{error:'Cover not found'});return true;}
  const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.object_key}));
  if(!isR2ReadableBody(object.Body)){send(res,503,{error:'Storage unavailable'});return true;}
  res.writeHead(200,{'Content-Type':file.content_type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});
  for await(const chunk of object.Body)res.write(chunk);
  res.end();return true;
 }
 return false;
}
