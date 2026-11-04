import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import './styles.css';
import { TermsPage, PrivacyPage } from './legal';
import { LoginPage } from './login';
import WorkspaceV2 from './workspace-v1';
import {notifyV2DataChanged} from './data-refresh-v2';
import {setProjectSavedV2} from './project-requests-v2';

function Header() { return <header className="site-header"><Link to="/" className="brand"><img src="/1ce-logo.png" alt="1CE" className="brand-logo"/></Link><nav><Link to="/">Home</Link><Link to="/login" className="button">Log in</Link></nav></header> }
function Footer() { return <footer className="site-footer"><span>© 2026 1CE</span><nav><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link></nav></footer> }
function PublicPage({children}:{children:React.ReactNode}) { return <div className="site"><Header/><main className="main">{children}</main><Footer/></div> }
function Landing() {
 const [enter,setEnter]=useState(false);
 useEffect(()=>{
  const api=import.meta.env.VITE_API_URL;
  if(!api)return;
  const controller=new AbortController();
  (async()=>{
   for(let attempt=0;attempt<2;attempt++){
    try{
     const response=await fetch(api+'/auth/me',{credentials:'include',signal:controller.signal,cache:'no-store'});
     if(response.ok){const result=await response.json();if(!controller.signal.aborted&&result?.user)setEnter(true);return;}
     if(response.status===401)return;
    }catch{if(controller.signal.aborted)return;}
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,800));
   }
  })();
  return()=>controller.abort();
 },[]);
 if(enter)return <Navigate to="/app/library" replace/>;
 return <PublicPage><div className="empty-landing" aria-label="Landing content reserved for future design"/></PublicPage>;
}
function Register() { return <PublicPage><section className="auth-card"><h1>Create an account</h1><p>Registration will be enabled when the v2 authentication API is ready.</p><Link to="/login">Back to login</Link></section></PublicPage> }
function WorkspaceRoute(){
 const {id}=useParams();
 const location=useLocation();
 const publicProfile=location.pathname.startsWith('/u/');
 const [session,setSession]=useState<{status:'checking'|'ready';viewer:any}>({status:'checking',viewer:null});
 useEffect(()=>{
  const api=import.meta.env.VITE_API_URL;
  if(!api){setSession({status:'ready',viewer:null});return;}
  const controller=new AbortController();
  (async()=>{
   for(let attempt=0;attempt<2;attempt++){
    try{
     const response=await fetch(api+'/auth/me',{credentials:'include',signal:controller.signal,cache:'no-store'});
     if(response.ok||response.status===401){
      const result=response.ok?await response.json():null;
      if(!controller.signal.aborted)setSession({status:'ready',viewer:result?.user||null});
      return;
     }
    }catch{if(controller.signal.aborted)return;}
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,800));
   }
   if(!controller.signal.aborted)setSession({status:'ready',viewer:null});
  })();
  return()=>controller.abort();
 },[]);
 if(session.status==='checking')return null;
 if(!publicProfile&&!session.viewer)return <Navigate to="/login" replace/>;
 return <WorkspaceV2 user={session.viewer} profileId={publicProfile?id:undefined}/>;
}
function SharedProjectPage(){
 const {token}=useParams();
 const [status,setStatus]=useState('Checking shared project…');
 const [project,setProject]=useState<{owner_id:number;kind:'beat'|'pack';id:string}|null>(null);
 useEffect(()=>{
  const api=import.meta.env.VITE_API_URL;
  if(!api||!token)return;
  fetch(api+'/api/public/redeem/'+token,{method:'POST',credentials:'include'}).then(async r=>{
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(r.status===401?'Sign in to access this project':data.error||'Unable to access project');
   setProject(data);setStatus('Access granted. You can save this project to your Home.');
   notifyV2DataChanged(['shares']);
  }).catch(e=>setStatus(e.message));
 },[token]);
 const save=async()=>{
  if(!project)return;
  try{
   await setProjectSavedV2(project.owner_id,project.kind,project.id,false);
   setStatus('Saved to your profile.');
   notifyV2DataChanged(['saves']);
  }catch{setStatus('Unable to save project.');}
 };
 return <div style={{minHeight:'100vh',background:'#0b0911',color:'#f6f4fa',padding:'100px 24px',textAlign:'center'}}>
  <h1>Shared project</h1><p>{status}</p>
  {project&&<button type="button" onClick={()=>void save()} style={{padding:'12px 20px',borderRadius:10,cursor:'pointer'}}>Save to Home</button>}
  <p><Link to="/app/profile">My profile</Link></p>
 </div>;
}

function App() { return <BrowserRouter><Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<Register/>}/><Route path="/terms" element={<TermsPage/>}/><Route path="/privacy" element={<PrivacyPage/>}/><Route path="/app" element={<LoginPage/>}/><Route path="/app/library" element={<WorkspaceRoute/>}/><Route path="/app/discover" element={<WorkspaceRoute/>}/><Route path="/app/upload" element={<WorkspaceRoute/>}/><Route path="/app/settings" element={<WorkspaceRoute/>}/><Route path="/app/profile" element={<WorkspaceRoute/>}/><Route path="/app/profile/edit" element={<WorkspaceRoute/>}/><Route path="/u/:id" element={<WorkspaceRoute/>}/><Route path="/shared/:token" element={<SharedProjectPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
