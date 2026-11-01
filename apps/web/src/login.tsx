import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './login.css';

function GoogleMark(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.13H3.06v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.93A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.93V7.45H3.06A10 10 0 0 0 2 12c0 1.61.38 3.14 1.06 4.55l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.45l3.35 2.62C7.2 7.7 9.4 5.94 12 5.94Z"/></svg>}
async function startGoogleLogin(){
 const api=import.meta.env.VITE_API_URL;
 if(!api)throw new Error('Google login is not configured.');
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
 const verifier=btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
 sessionStorage.setItem('onece_v2_google_verifier',verifier);
 window.location.assign(api+'/auth/google?challenge='+encodeURIComponent(challenge));
}

export function LoginPage(){
 const [email,setEmail]=useState(''); const [password,setPassword]=useState('');const [notice,setNotice]=useState('');const [loading,setLoading]=useState(false);const navigate=useNavigate();
 return <div className="v1-auth">
  <header className="v1-auth-header"><Link to="/" className="v1-auth-identity"><img src="/1ce-logo.png" alt="1CE"/><span className="v1-auth-rule"/><span>One Content Engine</span></Link><Link to="/register">Sign up</Link></header>
  <main className="v1-auth-center"><section className="v1-auth-card"><h1>Welcome back.</h1><p className="v1-auth-subtitle">Continue where you left off.</p>
  <button className="v1-google" type="button" onClick={()=>{setNotice('');startGoogleLogin().catch(e=>setNotice(e instanceof Error?e.message:'Unable to start Google login'))}}><GoogleMark/>Continue with Google</button>
  <div className="v1-auth-divider"><span/>Or<span/></div>
  <form onSubmit={async e=>{e.preventDefault();if(loading)return;setLoading(true);setNotice('');try{const api=import.meta.env.VITE_API_URL;if(!api)throw new Error('Login service is not configured yet.');const response=await fetch(api+'/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to sign in');navigate('/app/library',{replace:true});}catch(error){setNotice(error instanceof Error?error.message:'Unable to sign in')}finally{setLoading(false)}}}>
   <label className="v1-auth-field"><span>Email</span><input type="email" required placeholder="you@email.com" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label className="v1-auth-field v1-auth-password"><span className="v1-auth-password-label"><span>Password</span><button type="button" onClick={()=>setNotice('Password reset will be available with v2 authentication.')}>Forgot password?</button></span><input type="password" required placeholder="Your password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button className="v1-auth-submit" type="submit" disabled={loading}>{loading?"Signing in…":"Log in →"}</button>
  </form>
  {notice&&<p role="status" className="v1-auth-notice">{notice}</p>}
  <p className="v1-auth-signup">Don't have an account? <Link to="/register">Sign up</Link></p>
  <p className="v1-auth-agreement">By continuing, you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</p>
  </section></main>
  <footer className="v1-auth-footer"><span>© 2026 1CE</span><nav><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></nav></footer>
 </div>
}
