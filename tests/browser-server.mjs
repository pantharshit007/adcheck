// Local browser fixture: real popup/content code with mocked extension APIs.
// Run with node tests/browser-server.mjs; no installed extension is required.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const mock = `
window.fixture = {sync: {'adcheck-settings': {...AdCheckShared.cloneDefaultSettings(), enabled: true}}, local: {}, listeners: [], messages: [], network: AdCheckShared.createEmptyTabState(), access: false};
const area = name => ({get: async key => key ? {[key]: fixture[name][key]} : fixture[name], set: async values => { const changes = {}; for(const [key,value] of Object.entries(values)) {changes[key]={oldValue:fixture[name][key],newValue:value}; fixture[name][key]=value;} for(const fn of fixture.listeners) fn(changes,name); }, remove: async key => { delete fixture[name][key]; }});
window.chrome = {storage: {sync: area('sync'), local: area('local'), onChanged: {addListener: fn => fixture.listeners.push(fn)}}, runtime: {getManifest: () => ({version:'test'}), onMessage: {addListener() {}}, sendMessage: async msg => {fixture.messages.push(msg); if(msg.type === 'GET_SETTINGS') return {ok:true,settings:fixture.sync['adcheck-settings']}; if(msg.type === 'GET_USER_SCRIPT_STATUS') return {ok:true,status:{available:fixture.access,message:'Window global inspection and inline overrides require Allow User Scripts. Enable it in Chrome extension details and reload AdCheck.'}}; if(msg.type.includes('TAB_NETWORK_STATE')) return {ok:true,state:fixture.network}; if(msg.type==='READ_WINDOW_GLOBALS') return {ok:true,results:msg.windowGlobalPaths.map(path=>({path,type:'number',value:'42'}))}; if(msg.type==='SYNC_BLOCKED_ROUTE_RULES') return {ok:true,installedCount:0,statuses:[]}; return {ok:true}; }}, tabs: {query: async () => [{id:1,url:location.origin}], sendMessage:async()=>({ok:true}), create:async()=>{}}, userScripts:{getScripts:async()=>{if(!fixture.access)throw Error('disabled'); return [];}}};
`;
http.createServer((req,res) => {
  let body, type = 'text/javascript';
  if(req.url === '/popup') {type='text/html'; body=readFileSync('popup.html','utf8').replace('<script src="popup.js">','<script src="mock.js"></script><script src="popup.js">');}
  else if(req.url === '/content') {type='text/html'; body='<html><head><link rel="stylesheet" href="/styles.css"></head><body><h1>Publisher fixture</h1><div id="slot">Ad slot</div><script src="/shared/defaults.js"></script><script src="/shared/build-info.js"></script><script src="/mock.js"></script><script src="/content.js"></script></body></html>';}
  else if(req.url === '/mock.js') body=mock;
  else if(req.url === '/styles.css') {type='text/css';body=readFileSync('styles.css','utf8');}
  else if(['/popup.js','/content.js','/shared/defaults.js','/shared/build-info.js'].includes(req.url)) body=compile('src'+req.url.replace(/\.js$/,'.ts'));
  else {res.writeHead(404);res.end();return;}
  res.writeHead(200, {'content-type': type});res.end(body);
}).listen(8765,'0.0.0.0',()=>console.log('Browser fixtures: http://localhost:8765/popup and /content'));
