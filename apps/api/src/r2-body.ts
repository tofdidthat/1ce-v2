// R2 GetObject bodies vary by runtime and must be checked before iteration.
export type R2ReadableBody=AsyncIterable<Uint8Array>&{destroy?:(error?:Error)=>unknown};
export function isR2ReadableBody(value:unknown):value is R2ReadableBody{
 if(value===null||typeof value!=='object')return false;
 const stream=value as Record<PropertyKey,unknown>;
 return typeof stream[Symbol.asyncIterator]==='function'&&
  (stream.destroy===undefined||typeof stream.destroy==='function');
}
