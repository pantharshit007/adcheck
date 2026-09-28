import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function evaluate(context, path, exports = '') {
  let source = readFileSync(path, 'utf8');
  if (exports) source = source.replace(/\}\)\(\);\s*$/, `globalThis.api = {${exports}}; })();`);
  vm.runInContext(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText, context);
}
function fixture(kind = 'background') {
  const listeners = {};
  const event = name => ({addListener(fn) {listeners[name] = fn;}});
  let rules = [], dynamic = [], writes = 0, notifications = 0;
  const timers = new Map(); let timerId = 0; const microtasks = [];
  const chrome = {
    runtime: {onInstalled: event('installed'), onMessage: event('message')},
    storage: {onChanged: event('settings'), sync: {get: async () => ({}), set: async () => {}}, session: {get: async () => ({}), set: async () => {writes++;}, remove: async () => {}}},
    tabs: {onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed'), query: async () => [{id: 1, url: 'https://publisher.test/'}], sendMessage: async () => {notifications++;}},
    webRequest: {onBeforeRequest: event('before'), onCompleted: event('completed'), onErrorOccurred: event('error')},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setIcon: async () => {}},
    declarativeNetRequest: {
      getSessionRules: async () => rules, getDynamicRules: async () => dynamic,
      updateDynamicRules: async () => {dynamic = [];},
      updateSessionRules: async options => {rules = options.addRules;},
      isRegexSupported: async ({regex}) => ({isSupported: !regex.includes('(?='), reason: 'syntaxError'})
    }
  };
  const warnings = [];
  const context = vm.createContext({chrome, console: {...console, warn: (...args) => warnings.push(args)}, URL, queueMicrotask(fn) {microtasks.push(fn);}, navigator: {userAgent: 'Chrome/140'}, self: {importScripts() {}}, setTimeout(fn) {timers.set(++timerId, fn); return timerId;}, clearTimeout(id) {timers.delete(id);}, window: {__ADCHECK_BOOTSTRAPPED__: true, location: {hostname: 'publisher.test'}}, document: {cookie: '', getElementById: () => null, querySelector: selector => {if(selector === '[') throw Error('Invalid selector');return null;}}});
  evaluate(context, 'src/shared/defaults.ts');
  if (kind === 'background') evaluate(context, 'src/background.ts', 'settingsCache, getTabState, pendingRequests, syncBlockedRouteRules, ensureSettings, unready: () => {trackingReady = false;}, ready: () => {trackingReady = true; for (const event of earlyEvents.splice(0)) event();}, getStatus: () => blockingStatus, earlyEventCount: () => earlyEvents.length');
  else if (kind === 'popup') evaluate(context, 'src/popup.ts', 'parseBackup');
  else evaluate(context, 'src/content.ts', 'state, buildBundleResults, buildWindowGlobalResults, runChecks, applySettings, executeOverrideScriptsInOrder, teardownSiteOverride, tryApplySiteOverride');
  if (kind === "background") context.api.ready();
  return {context, chrome, warnings, listeners, microtasks, api: context.api, shared: context.AdCheckShared, timers, rules: () => rules, writes: () => writes, notifications: () => notifications};
}
const request = (id, extra = {}) => ({tabId: 1, requestId: String(id), type: 'script', url: 'https://cdn.test/script.js?secret=123', timeStamp: 100, ...extra});

test('parallel requests retain every result and persist in bounded batches', async () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  for (let i = 0; i < 100; i++) f.listeners.before(request(i));
  for (let i = 0; i < 100; i++) f.listeners.completed(request(i, {timeStamp: 130, statusCode: 200}));
  const state = f.api.getTabState(1);
  assert.equal(state.history.length, 100); assert.equal(state.activeRequests.length, 0);
  assert.equal(state.history[0].loadTimeMs, 30); assert.equal(state.history[0].url, 'https://cdn.test/script.js');
  assert.equal(f.timers.size, 1); assert.equal(f.writes(), 0);
  for (const timer of f.timers.values()) timer(); await flush();
  assert.equal(f.writes(), 1); assert.equal(f.notifications(), 1);
});

test('reload generations discard late completions, redirects retain timing, tab closure clears pending', () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  f.listeners.before(request('old'));
  f.listeners.before(request('nav', {type: 'main_frame', url: 'https://publisher.test/'}));
  f.listeners.completed(request('old', {statusCode: 200}));
  assert.equal(f.api.getTabState(1).history.length, 0);
  f.listeners.before(request('new'));
  f.listeners.before(request('new', {url: 'https://cdn.test/redirected.js', timeStamp: 120}));
  f.listeners.completed(request('new', {url: 'https://cdn.test/redirected.js', timeStamp: 150, statusCode: 200}));
  assert.equal(f.api.getTabState(1).history[0].loadTimeMs, 50);
  f.listeners.before(request('pending')); f.listeners.removed(1);
  assert.equal(f.api.pendingRequests.size, 0); assert.equal(f.timers.size, 0);
  f.listeners.completed(request('pending')); assert.equal(f.api.getTabState(1).history.length, 0);
});

test('paused, non-script, and empty configurations retain no requests', () => {
  const f = fixture(); f.listeners.before(request(1)); assert.equal(f.api.pendingRequests.size, 0);
  f.api.settingsCache.current.enabled = true;
  f.listeners.before(request(2, {type: 'image'}));
  f.api.settingsCache.current.bundles = []; f.listeners.before(request(4));
  assert.equal(f.api.pendingRequests.size, 0); assert.equal(f.writes(), 0);
});

test('unmatched scripts are retained so renamed bundles match without a reload', async () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  f.listeners.before(request(1, {url: 'https://cdn.test/apinstreambundle.js?v=2'}));
  f.listeners.completed(request(1, {url: 'https://cdn.test/apinstreambundle.js?v=2', statusCode: 200}));
  const [entry] = f.api.getTabState(1).history;
  assert.deepEqual([...entry.matchedChecks], []);
  // Unmatched scripts are persisted but do not wake the widget.
  for (const timer of f.timers.values()) timer(); f.timers.clear(); await flush();
  assert.equal(f.notifications(), 0);
  // Renaming the bundle keeps the history.
  f.listeners.settings({'adcheck-settings': {newValue: {...f.api.settingsCache.current, bundles: ['apinstreambundle']}}}, 'sync');
  assert.equal(f.api.getTabState(1).history.length, 1);
  const c = fixture('content');
  c.api.state.settings.bundles = ['apinstreambundle'];
  c.api.state.networkState.history = [{...entry}];
  assert.equal(c.api.buildBundleResults()[0].status, 'pass');
});

test('history eviction keeps matched bundle entries', () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  f.listeners.before(request('bundle')); f.listeners.completed(request('bundle', {statusCode: 200}));
  for (let i = 0; i < f.shared.MAX_NETWORK_HISTORY + 5; i++) {
    const url = `https://cdn.test/other-${i}.js`;
    f.listeners.before(request(i, {url})); f.listeners.completed(request(i, {url, statusCode: 200}));
  }
  const history = f.api.getTabState(1).history;
  assert.equal(history.length, f.shared.MAX_NETWORK_HISTORY);
  assert.equal(history[0].requestId, 'bundle');
});

test('bundle matching modes and malformed cookies', () => {
  const {shared} = fixture();
  assert.equal(shared.matchesBundle('script.js', 'https://test/other?script.js', 'script'), false);
  assert.equal(shared.matchesBundle('script.js', 'https://test/script.js?v=1', 'xmlhttprequest'), false);
  assert.equal(shared.matchesBundle('apinstreambundle', 'https://cdn.test/js/apInstreamBundle.js', 'script'), true);
  assert.equal(shared.matchesBundle('prebid', 'https://cdn.test/prebid.min.js', 'script'), true);
  assert.equal(shared.matchesBundle('cdn.test/tag/gpt', 'https://cdn.test/tag/gpt.js', 'script'), true);
  assert.equal(shared.matchesBundle('filename:gpt.js', 'https://cdn.test/mygpt.js', 'script'), false);
  assert.equal(shared.matchesBundle('filename:gpt.js', 'https://cdn.test/GPT.js', 'script'), true);
  assert.equal(shared.matchesBundle('url:other', 'https://test/other', 'script'), true);
  assert.equal(shared.matchesBundle('url:v=1', 'https://test/a.js?v=1', 'script'), true);
  assert.equal(shared.matchesBundle('regex:script\\.js$', 'https://test/script.js', 'script'), true);
  assert.deepEqual(Array.from(shared.parseCookieString('empty=; eq=a=b; encoded=a%3Bb%3Dc; bad=%ZZ; good=yes'), pair => Array.from(pair)), [['empty',''], ['eq','a=b'], ['encoded','a;b=c'], ['bad','%ZZ'], ['good','yes']]);
});

test('HTTP errors and blocked requests fail immediately; successful scripts pass', () => {
  const f = fixture('content');
  const state = f.api.state;
  state.networkState.history = [{...request(1), resourceType: 'script', status: 'completed', statusCode: 404}];
  assert.equal(f.api.buildBundleResults()[0].status, 'fail');
  state.networkState.history[0].statusCode = 200;
  assert.equal(f.api.buildBundleResults()[0].status, 'pass');
  state.networkState.history[0].status = 'error'; state.networkState.history[0].error = 'net::ERR_BLOCKED_BY_CLIENT';
  assert.equal(f.api.buildBundleResults()[0].status, 'fail');
});

test('DNR rejects unsupported regex and flags while retaining valid rules; scope, ignore and pause apply', async () => {
  const f = fixture(); Object.assign(f.api.settingsCache.current, {enabled: true, blockingHostname: 'publisher.test', blockedRoutes: [{value: 'ads.js', enabled: true}, {value: '/(?=bad)/', enabled: true}, {value: '/ads/g', enabled: true}]});
  await f.api.syncBlockedRouteRules();
  assert.equal(f.rules().length, 1); assert.deepEqual([...f.rules()[0].condition.tabIds], [1]);
  assert.equal(f.api.getStatus().filter(x => x.state === 'invalid').length, 2);
  f.api.settingsCache.current.ignoredDomains = ['publisher.test']; await f.api.syncBlockedRouteRules(); assert.equal(f.rules().length, 0);
  f.api.settingsCache.current.ignoredDomains = []; f.api.settingsCache.current.enabled = false;
  await f.api.syncBlockedRouteRules(); assert.equal(f.rules().length, 0);
});

test('blocked routes use regex only when explicit and keep URL-filter syntax', async () => {
  const f = fixture(); Object.assign(f.api.settingsCache.current, {enabled: true, blockingHostname: 'publisher.test', blockedRoutes: [
    {value: '/ads\\/|tracking/i', enabled: true}, {value: '||ads.example.com^', enabled: true}, {value: 'regex:track(ing)?', enabled: true}, {value: '/ads\\/|tracking', enabled: true}
  ]});
  await f.api.syncBlockedRouteRules();
  const [slash, filter, prefixed, notRegex] = f.rules().map(rule => rule.condition);
  assert.equal(slash.regexFilter, 'ads\\/|tracking'); assert.equal(slash.isUrlFilterCaseSensitive, false);
  assert.equal(filter.urlFilter, '||ads.example.com^'); assert.equal(filter.regexFilter, undefined);
  assert.equal(prefixed.regexFilter, 'track(ing)?');
  assert.equal(notRegex.urlFilter, '/ads\\/|tracking');
  assert.equal(f.api.getStatus().every(status => status.state === 'installed'), true);
});

test('failed settings initialization still drains a bounded early-event queue', async () => {
  const f = fixture(); f.api.unready(); f.api.settingsCache.current.enabled = true;
  for (let i = 0; i < 1500; i++) f.listeners.before(request(i));
  f.chrome.storage.sync.get = async () => { throw Error('sync unavailable'); };
  assert.equal(f.api.earlyEventCount(), 1000);
  f.microtasks[0](); await flush();
  assert.equal(f.api.earlyEventCount(), 0); assert.equal(f.api.pendingRequests.size, 1000);
  f.listeners.before(request('after')); assert.equal(f.api.pendingRequests.size, 1001);
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
test('single-flight checks coalesce notifications and manual refresh discards older results', async () => {
  const f = fixture('content');
  Object.assign(f.context.window, {setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}});
  Object.assign(f.api.state.settings, {enabled: true, bundles: [], windowGlobals: [{path:'player', awaitBundle:''}]});
  let release, reads = 0;
  f.chrome.runtime.sendMessage = async msg => {
    if (msg.type.includes('TAB_NETWORK_STATE')) return {state: f.shared.createEmptyTabState()};
    if (msg.type === 'GET_USER_SCRIPT_STATUS') return {status:{available:true}};
    if (msg.type === 'READ_WINDOW_GLOBALS') {
      reads++;
      if (reads === 1) return new Promise(resolve => { release = resolve; });
      return {results:[{path:'player', type:'number', value:'new'}]};
    }
  };
  const run = f.api.runChecks(false); await flush();
  for (let i = 0; i < 30; i++) void f.api.runChecks(false);
  void f.api.runChecks(true); await flush();
  assert.equal(reads, 1);
  assert.equal(f.api.state.snapshot.windowGlobals.length, 0);
  release({results:[{path:'player',type:'number',value:'old'}]}); await run;
  assert.equal(reads, 2); assert.equal(f.api.state.snapshot.windowGlobals[0].rawValue, 'new');
});

test('user-script capability failure is immediate even when waiting for a bundle', async () => {
  const f = fixture('content');
  f.api.state.settings.windowGlobals = [{path:'player',awaitBundle:'script.js'}];
  f.chrome.runtime.sendMessage = async () => ({status:{available:false,message:'Enable Allow User Scripts for window global inspection.'}});
  const results = await f.api.buildWindowGlobalResults(f.api.state.snapshot);
  assert.equal(results[0].status, 'fail'); assert.match(results[0].detail, /window global/);
});

test('override teardown cancels the remaining script sequence', async () => {
  const f = fixture('content'); let release, executions = 0;
  f.chrome.runtime.sendMessage = async msg => {
    if (msg.type === 'EXECUTE_SITE_OVERRIDE_SCRIPT') { executions++; return new Promise(resolve => {release=resolve;}); }
  };
  const run = f.api.executeOverrideScriptsInOrder([{kind:'inline',scriptCode:'first()'}, {kind:'inline',scriptCode:'second()'}], 0);
  await flush(); assert.equal(executions, 1);
  f.api.teardownSiteOverride(); release({ok:true}); await run;
  assert.equal(executions, 1);
});

test('DNR limits report omitted rules and later synchronization recovers after rejection', async () => {
  const f = fixture(); f.chrome.declarativeNetRequest.MAX_NUMBER_OF_SESSION_RULES = 1;
  Object.assign(f.api.settingsCache.current, {enabled:true,blockingHostname:'publisher.test',blockedRoutes:[{value:'first',enabled:true},{value:'second',enabled:true}]});
  await f.api.syncBlockedRouteRules(); assert.equal(f.rules().length, 1);
  assert.equal(f.api.getStatus()[1].state, 'omitted-due-to-limit');
  const update = f.chrome.declarativeNetRequest.updateSessionRules;
  f.chrome.declarativeNetRequest.updateSessionRules = async () => {throw Error('temporary failure');};
  await f.api.syncBlockedRouteRules(); assert.match(f.api.getStatus()[0].message, /Installation failed/);
  f.chrome.declarativeNetRequest.updateSessionRules = update;
  await f.api.syncBlockedRouteRules(); assert.equal(f.api.getStatus()[0].state,'installed');
});

test('worker startup restores session history before queued requests and storage failures do not stop tracking', async () => {
  const f = fixture(); f.api.unready();
  const settings = {...f.shared.cloneDefaultSettings(), enabled:true};
  f.chrome.storage.sync.get = async () => ({'adcheck-settings':settings});
  f.chrome.storage.session.get = async () => ({'adcheck-tab-state:1': {version:1,state:{history:[{requestId:'restored',url:'https://cdn.test/script.js',resourceType:'script',status:'completed',statusCode:200}],activeRequests:[],lastUpdatedAt:1}}});
  f.listeners.before(request('early'));
  f.listeners.completed(request('early',{statusCode:200}));
  await f.api.ensureSettings();
  assert.equal(f.api.getTabState(1).history.length, 2);
  const save = f.chrome.storage.session.set;
  f.chrome.storage.session.set = async () => {throw Error('storage unavailable');};
  for (const timer of f.timers.values()) timer(); f.timers.clear(); await flush();
  f.chrome.storage.session.set = save;
  f.listeners.before(request('later')); f.listeners.completed(request('later',{statusCode:200}));
  for (const timer of f.timers.values()) timer(); await flush();
  assert.equal(f.api.getTabState(1).history.length, 3); assert.equal(f.writes(), 1); assert.equal(f.warnings.length, 1);
});

test('pause cancels queued persistence and widget-only settings preserve history', async () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  f.listeners.before(request(1)); f.listeners.completed(request(1,{statusCode:200}));
  f.listeners.settings({'adcheck-settings':{newValue:{...f.api.settingsCache.current,widgetCollapsed:true}}},'sync');
  assert.equal(f.api.getTabState(1).history.length, 1);
  f.listeners.settings({'adcheck-settings':{newValue:{...f.api.settingsCache.current,enabled:false}}},'sync');
  for (const timer of f.timers.values()) timer(); await flush();
  assert.equal(f.writes(), 0); assert.equal(f.api.pendingRequests.size, 0);
});

test('versioned backups validate per hostname and legacy settings remain importable', () => {
  const f = fixture('popup');
  const valid = {hostname:'publisher.test',selector:'#slot',placement:'afterend',htmlSnippet:'<div>Ad</div>',enabled:true,updatedAt:1};
  const backup = f.api.parseBackup(JSON.stringify({version:1,settings:{enabled:true},overrides:[valid,{...valid,hostname:'bad.test',selector:'['}]}));
  assert.equal(backup.overrides.length,1); assert.match(backup.errors[0],/bad.test/);
  assert.equal(f.api.parseBackup(JSON.stringify({enabled:true,bundles:['ad.js']})).settings.enabled,true);
  assert.equal(f.api.parseBackup('{"version":2,"settings":{}}'),null);
  assert.equal(f.api.parseBackup('[]'),null);
});

test('settings normalization rejects malformed entries and does not mutate defaults', () => {
  const {shared} = fixture();
  const settings = shared.mergeSettings({bundles:[' ad.js ','ad.js',null,5],blockedRoutes:[null,{value:'ad.js',enabled:false}],blockingHostname:'HTTPS://Publisher.Test/path'});
  assert.deepEqual([...settings.bundles],['ad.js']); assert.equal(settings.blockedRoutes[0].enabled,false);
  assert.equal(settings.blockingHostname,'publisher.test');
  const globals = shared.mergeSettings({windowGlobals:[{path:'window.a.b',awaitBundle:'',label:' Section '},{path:'window.c',awaitBundle:'',label:'window.c'},{path:'window.d',awaitBundle:''}]}).windowGlobals;
  assert.equal(globals[0].label,'Section'); assert.equal('label' in globals[1],false); assert.equal('label' in globals[2],false);
  settings.bundles.push('another.js'); assert.deepEqual([...shared.cloneDefaultSettings().bundles],['script.js']);
});

test('pausing during a slow check prevents the older result from restoring the snapshot', async () => {
  const f = fixture('content');
  Object.assign(f.context.window, {removeEventListener() {}, clearTimeout() {}, clearInterval() {}});
  Object.assign(f.api.state.settings, {enabled:true,bundles:[],windowGlobals:[{path:'player',awaitBundle:''}]});
  let release;
  f.chrome.runtime.sendMessage = async msg => {
    if (msg.type.includes('TAB_NETWORK_STATE')) return {state:f.shared.createEmptyTabState()};
    if (msg.type === 'GET_USER_SCRIPT_STATUS') return {status:{available:true}};
    if (msg.type === 'READ_WINDOW_GLOBALS') return new Promise(resolve => {release=resolve;});
    return {ok:true};
  };
  const run = f.api.runChecks(false); await flush();
  await f.api.applySettings({...f.api.state.settings,enabled:false});
  release({results:[{path:'player',type:'number',value:'obsolete'}]}); await run;
  assert.equal(f.api.state.snapshot.windowGlobals.length,0);
});

test('tab closure queues removal after an in-flight storage write', async () => {
  const f = fixture(); f.api.settingsCache.current.enabled = true;
  let release; const stored = {};
  f.chrome.storage.session.set = async value => {await new Promise(resolve => {release=resolve;}); Object.assign(stored,value);};
  f.chrome.storage.session.remove = async key => {delete stored[key];};
  f.listeners.before(request(1)); f.listeners.completed(request(1,{statusCode:200}));
  for (const timer of f.timers.values()) timer(); await flush();
  f.listeners.removed(1); release(); await flush();
  assert.deepEqual(stored,{}); assert.equal(f.api.pendingRequests.size,0);
});
