// Actual settings page/routes with owned config, loopback only, no model request.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [root,out]=process.argv.slice(2);
if(!root||!out)throw Error('source root and owned output required');
for(const key of Object.keys(process.env))if(key.startsWith('MERIDIAN_')||key.startsWith('CLAUDE_PROXY_'))delete process.env[key];
Object.assign(process.env,{MERIDIAN_CONFIG_DIR:join(out,'config'),MERIDIAN_SESSION_DIR:join(out,'sessions'),MERIDIAN_WORKDIR:join(out,'work'),MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_SILENT:'1'});
for(const key of ['MERIDIAN_CONFIG_DIR','MERIDIAN_SESSION_DIR','MERIDIAN_WORKDIR'])mkdirSync(process.env[key],{recursive:true});
const {startProxyServer}=await import(join(root,'src/proxy/server.ts'));
const instance=await startProxyServer({host:'127.0.0.1',port:42546,silent:true,profiles:[]});
writeFileSync(join(out,'ready.json'),JSON.stringify({port:instance.server.address().port}));
let stopping=false;
process.once('SIGTERM',()=>{if(stopping)return;stopping=true;void instance.close().then(()=>process.exit(0),()=>process.exit(1));});
