// Bounded per-replica CPU admission before costly scrypt verification.
// Do not key this budget by a claimed IP, x-forwarded-for, or victim email.
// A high shared PostgreSQL ceiling additionally bounds work across replicas.
export const passwordWorkPolicy=Object.freeze({
 burst:48,
 refillPerSecond:8,
 sharedPerMinute:480
});
export type PasswordWorkOptions={
 capacity?:number;
 refillPerSecond?:number;
 now?:()=>number;
};
export type PasswordWorkLimiter=Readonly<{take():boolean}>;
export function createPasswordWorkLimiter({
 capacity=passwordWorkPolicy.burst,
 refillPerSecond=passwordWorkPolicy.refillPerSecond,
 now=()=>performance.now()
}:PasswordWorkOptions={}):PasswordWorkLimiter{
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>1000||
  !Number.isFinite(refillPerSecond)||refillPerSecond<=0||refillPerSecond>100)
  throw new Error('Invalid password-work admission policy');
 let tokens=capacity;
 let last=now();
 if(!Number.isFinite(last))throw new Error('Invalid admission clock');
 return Object.freeze({
  take(){
   const time=now();
   if(!Number.isFinite(time))return false;
   if(time>last){
    tokens=Math.min(capacity,tokens+(time-last)*refillPerSecond/1000);
    last=time;
   }
   if(tokens<1)return false;
   tokens-=1;
   return true;
  }
 });
}
export const passwordWorkLimiter=createPasswordWorkLimiter();
