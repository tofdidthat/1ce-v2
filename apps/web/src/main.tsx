import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { TermsPage, PrivacyPage } from './legal';
import { LoginPage } from './login';

function Header() { return <header className="site-header"><Link to="/" className="brand"><img src="/1ce-logo.png" alt="1CE" className="brand-logo"/></Link><nav><Link to="/">Home</Link><Link to="/login" className="button">Log in</Link></nav></header> }
function Footer() { return <footer className="site-footer"><span>© 2026 1CE</span><nav><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link></nav></footer> }
function PublicPage({children}:{children:React.ReactNode}) { return <div className="site"><Header/><main className="main">{children}</main><Footer/></div> }
function Landing() { return <PublicPage><div className="empty-landing" aria-label="Landing content reserved for future design"/></PublicPage> }
function Register() { return <PublicPage><section className="auth-card"><h1>Create an account</h1><p>Registration will be enabled when the v2 authentication API is ready.</p><Link to="/login">Back to login</Link></section></PublicPage> }
function Library() { return <div className="site"><Header/><main className="main library"><aside><h2>Library</h2><button disabled>Upload beat</button><button disabled>Create pack</button></aside><section><h1>Your Library</h1><p>Library controls are visual only in this phase.</p><input placeholder="Search beats" aria-label="Search beats" disabled/><div className="library-empty">Your beats will appear here after the library migration.</div></section></main><Footer/></div> }
function App() { return <BrowserRouter><Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<Register/>}/><Route path="/terms" element={<TermsPage/>}/><Route path="/privacy" element={<PrivacyPage/>}/><Route path="/app/library" element={<Library/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
