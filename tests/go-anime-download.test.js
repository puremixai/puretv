/** @jest-environment node */
require('./web-globals');
jest.mock('../src/lib/openlist.client', () => ({ OpenListClient: jest.fn() }));
const { OpenListClient } = require('../src/lib/openlist.client');
const { addOpenListOfflineDownload } = require('../src/lib/openlist-offline-download');
const originalFetch=global.fetch;
const config={OpenListConfig:{Enabled:true,URL:'https://openlist.example',Username:'account',Password:'SECRET'}};
beforeEach(()=>{jest.clearAllMocks();jest.replaceProperty(process,'env',{NODE_ENV:'test',PURETV_GO_ANIME_DOWNLOADS:'true',PURETV_GO_URL:'http://worker:8081',PURETV_GO_TOKEN:'s'.repeat(32)});global.fetch=jest.fn(async()=>Response.json({code:200,replayed:false}));OpenListClient.mockImplementation(()=>({getToken:jest.fn(async()=>'node-token')}));});
afterEach(()=>{global.fetch=originalFetch;jest.restoreAllMocks()});
test('native Go receives original OpenList operation with owner and key',async()=>{await addOpenListOfflineDownload(config,'/anime','magnet:?xt=abc','aria2',{owner:'alice',key:'episode'});expect(OpenListClient).not.toHaveBeenCalled();const [url,init]=global.fetch.mock.calls[0];expect(url).toBe('http://worker:8081/v1/anime/download');expect(JSON.parse(init.body)).toEqual({owner:'alice',key:'episode',operation:{url:'https://openlist.example',username:'account',password:'SECRET',path:'/api/fs/add_offline_download',method:'POST',body:JSON.stringify({path:'/anime',urls:['magnet:?xt=abc'],tool:'aria2'}),headers:{}}});});
test('uncertain never falls back and exposes only receipt id',async()=>{const id='a'.repeat(64);global.fetch.mockResolvedValue(Response.json({error:'UPSTREAM-SECRET',receiptId:id},{status:409}));await expect(addOpenListOfflineDownload(config,'/anime','magnet:x','aria2',{owner:'alice',key:'ep'})).rejects.toThrow(id);expect(OpenListClient).not.toHaveBeenCalled();expect(global.fetch).toHaveBeenCalledTimes(1);});
test('flag off preserves direct Node submission',async()=>{process.env.PURETV_GO_ANIME_DOWNLOADS='false';await addOpenListOfflineDownload(config,'/anime','magnet:x','aria2',{owner:'alice',key:'ep'});expect(OpenListClient).toHaveBeenCalled();expect(global.fetch.mock.calls[0][0]).toBe('https://openlist.example/api/fs/add_offline_download');});
test('expired guard cannot dispatch',async()=>{await expect(addOpenListOfflineDownload(config,'/anime','magnet:x','aria2',{owner:'alice',key:'ep',assertActive:()=>{throw new Error('lease expired')}})).rejects.toThrow('lease expired');expect(global.fetch).not.toHaveBeenCalled();});
test('replayed result propagated to suppress duplicate notification',async()=>{global.fetch.mockResolvedValue(Response.json({code:200,replayed:true}));expect(await addOpenListOfflineDownload(config,'/anime','magnet:x','aria2',{owner:'alice',key:'ep'})).toEqual({replayed:true});});
