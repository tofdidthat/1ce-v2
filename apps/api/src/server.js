import { createServer } from 'node:http';
const port = Number(process.env.PORT || 3001);
createServer((req,res)=>{if(req.url==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'1ce-v2-api'}));return;}res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Not found'}));}).listen(port,()=>console.log('1CE v2 API listening on',port));
