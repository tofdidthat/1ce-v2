import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {isAccountUserV2,type AccountUserV2} from './account-identity-v2';

const api=import.meta.env.VITE_API_URL;
const codePattern=/^[A-Za-z0-9_-]{43}$/;

export default function DesktopUploadConsent(){
 const [params]=useSearchParams();
 const challenge=params.get('code_challenge')||'';
 const state=params.get('state')||'';
 const port=params.get('port')||'';
 const valid=window.self===window.top&&codePattern.test(challenge)&&codePattern.test(state)&&/^[1-9]\d{0,4}$/.test(port)
  &&Number(port)>=1024&&Number(port)<=65535;
 const [account,setAccount]=useState<AccountUserV2|null>();
 const [notice,setNotice]=useState('');
 const [sending,setSending]=useState(false);

 useEffect(()=>{
  if(!valid||!api)return;
  let request:AbortController|undefined;
  async function checkAccount(){
   request?.abort();
   const controller=new AbortController();
   request=controller;
   try{
    const response=await fetch(api+'/auth/me',{credentials:'include',signal:controller.signal,cache:'no-store'});
    if(controller.signal.aborted)return;
    if(response.status===401){setNotice('');setAccount(null);return;}
    if(!response.ok)throw Error('Unable to check your session.');
    const data=await response.json();
    if(!controller.signal.aborted){setNotice('');setAccount(isAccountUserV2(data?.user)?data.user:null);}
   }catch{
    if(!controller.signal.aborted){setAccount(undefined);setNotice('Unable to check your session. Reload to retry.');}
   }
  }
  void checkAccount();
  window.addEventListener('focus',checkAccount);
  return()=>{request?.abort();window.removeEventListener('focus',checkAccount);};
 },[valid]);

 async function authorize(){
  if(!valid||!api||!account||sending)return;
  setSending(true);
  setNotice('');
  try{
   const response=await fetch(api+'/auth/desktop-upload/authorize',{
    method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({codeChallenge:challenge,accountId:account.id})
   });
   const data=await response.json();
   if(!response.ok||typeof data.code!=='string'||!codePattern.test(data.code)){
    throw Error(data.error||'Unable to authorize desktop upload.');
   }
   const callback=new URL('http://127.0.0.1:'+port+'/callback');
   callback.searchParams.set('code',data.code);
   callback.searchParams.set('state',state);
   window.location.replace(callback.href);
  }catch(error){
   setNotice(error instanceof Error?error.message:'Unable to authorize desktop upload.');
   setSending(false);
  }
 }

 return <section className="auth-card">
  <h1>Authorize 1CE desktop upload</h1>
  {!valid||!api?<p>Open a new upload from the 1CE menu in Windows.</p>:<>
   <p>Allow the desktop app to upload audio and stems as private beats for up to 30 minutes.</p>
   {account===null&&<p><Link to="/login" target="_blank" rel="noopener noreferrer">Sign in</Link> and return to this tab.</p>}
   {account&&<>
    <p>Uploading as <strong>{account.email}</strong></p>
    <button className="button" type="button" disabled={sending} onClick={()=>void authorize()}>
     {sending?'Authorizing…':'Authorize upload'}
    </button>
   </>}
   {notice&&<p role="alert">{notice}</p>}
  </>}
 </section>;
}
