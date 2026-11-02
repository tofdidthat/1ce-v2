import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { TermsPage, PrivacyPage } from './legal';
import { LoginPage } from './login';
import WorkspaceV2 from './workspace-v1';

function Header() { return <header className="site-header"><Link to="/" className="brand"><img src="/1ce-logo.png" alt="1CE" className="brand-logo"/></Link><nav><Link to="/">Home</Link><Link to="/login" className="button">Log in</Link></nav></header> }
function Footer() { return <footer className="site-footer"><span>© 2026 1CE</span><nav><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link></nav></footer> }
function PublicPage({children}:{children:React.ReactNode}) { return <div className="site"><Header/><main className="main">{children}</main><Footer/></div> }
function Landing() { return <PublicPage><div className="empty-landing" aria-label="Landing content reserved for future design"/></PublicPage> }
function Register() { return <PublicPage><section className="auth-card"><h1>Create an account</h1><p>Registration will be enabled when the v2 authentication API is ready.</p><Link to="/login">Back to login</Link></section></PublicPage> }
function ProtectedLibrary(){const [status,setStatus]=useState<'checking'|'authorized'|'unauthorized'>('checking');const [user,setUser]=useState(null);useEffect(()=>{const api=import.meta.env.VITE_API_URL;if(!api){setStatus('unauthorized');return;}fetch(api+'/auth/me',{credentials:'include'}).then(async r=>{if(!r.ok){setStatus('unauthorized');return;}const data=await r.json();setUser(data.user||data);setStatus('authorized')}).catch(()=>setStatus('unauthorized'));},[]);if(status==='checking')return <div className="site"><main className="main">Checking session…</main></div>;if(status==='unauthorized')return <Navigate to="/login" replace/>;return <WorkspaceV2 user={user}/>;}
function GoogleReturn(){
 const [message,setMessage]=useState('Completing Google sign-in…');
 useEffect(()=>{
  const loginCode=new URLSearchParams(window.location.search).get('login_code');
  window.history.replaceState({},'',window.location.pathname);
  const verifier=sessionStorage.getItem('onece_v2_google_verifier');
  sessionStorage.removeItem('onece_v2_google_verifier');
  const api=import.meta.env.VITE_API_URL;
  if(!loginCode||!verifier||!api){setMessage('Google sign-in could not be completed. Please try again.');return;}
  fetch(api+'/auth/google/exchange',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginCode,verifier})})
   .then(async response=>{if(!response.ok)throw new Error('Exchange failed');const check=await fetch(api+'/auth/me',{credentials:'include'});if(!check.ok)throw new Error('Session unavailable');window.location.replace('/app/library');})
   .catch(()=>setMessage('Google sign-in failed. Please try again.'));
 },[]);
 return <div className="site"><main className="main"><p role="status">{message}</p><Link to="/login">Back to login</Link></main></div>;
}

function App() { return <BrowserRouter><Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<Register/>}/><Route path="/terms" element={<TermsPage/>}/><Route path="/privacy" element={<PrivacyPage/>}/><Route path="/app" element={<GoogleReturn/>}/><Route path="/app/library" element={<ProtectedLibrary/>}/><Route path="/app/discover" element={<ProtectedLibrary/>}/><Route path="/app/upload" element={<ProtectedLibrary/>}/><Route path="/app/settings" element={<ProtectedLibrary/>}/><Route path="/app/profile" element={<ProtectedLibrary/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
