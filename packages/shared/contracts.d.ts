// Shared types only; imported with "import type" by the browser and API.
// Server authorization and data validation are runtime responsibilities.
export type ProjectKindV2='beat'|'pack';
export type AccountIdV2=number;
export type ProjectIdV2=string;
export type LibraryFileIdV2=number;
export type ProjectIdentityV2={
 ownerId:AccountIdV2;
 kind:ProjectKindV2;
 projectId:ProjectIdV2;
};
export type AccountSummaryV2={
 id:AccountIdV2;
 name:string|null;
 picture:string|null;
 username:string|null;
};
export type ProjectSummaryV2=ProjectIdentityV2 & {title:string};
export type MediaReferencesV2={
 audioFileId:LibraryFileIdV2|null;
 coverFileId:LibraryFileIdV2|null;
 stemsFileId:LibraryFileIdV2|null;
};
export type DbQueryResultV2={
 rows:Array<Record<string,unknown>>;
 rowCount?:number|null;
};
export type QueryableV2={
 query(sql:string,params?:readonly unknown[]):Promise<DbQueryResultV2>;
};
