export function dedicatedReleaseHash(file:string):Promise<string>;
export function verifyDedicatedRelease(directory:string,expectedManifestSha256:string,options?:{executable?:string;nodeVersion?:string}):Promise<{
 root:string;manifestSha256:string;manifest:{version:1;kind:'demian-dedicated-work-release';nativeRevision:string;trackRevision:string;node:{version:string;sha256:string};files:Array<{path:string;bytes:number;sha256:string}>;links:Array<{path:string;target:string}>};
 apiEntry:string;workerEntry:string;runtimeEntry:string;
}>;
