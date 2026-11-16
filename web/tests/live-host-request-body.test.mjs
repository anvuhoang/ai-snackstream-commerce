import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_COMMAND_BYTES, HOST_SDP_BYTES, hostJsonLimit, readHostJson, HostBodyTooLarge } from '../src/lib/live/host-request-body.ts';

const url='http://localhost/api';
function streamed(chunks,headers={}) {
  let reads=0,canceled=false;
  const body=new ReadableStream({pull(c){reads++;const chunk=chunks.shift();if(chunk)c.enqueue(chunk);else c.close();},cancel(){canceled=true;}},{highWaterMark:0});
  return {request:new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body,duplex:'half'}),reads:()=>reads,canceled:()=>canceled};
}
test('only existing new host POST JSON routes are bounded; unrelated media, content, callback and SSE routes keep streaming',()=>{
  const json=new Request(url,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'}});
  for(const path of ['/api/admin/live/id/host/action','/api/admin/live/id/host/reply-audio/q','/api/live/id/host/viewers/v/leave'])assert.equal(hostJsonLimit(json,path),HOST_COMMAND_BYTES);
  for(const path of ['/api/admin/live/id/host/offer','/api/live/id/host/viewers/v/answer'])assert.equal(hostJsonLimit(json,path),HOST_SDP_BYTES);
  for(const path of ['/api/live/media-metadata','/api/live/make-answer','/api/admin/live/id/content/script','/api/live/events','/api/catalog/products','/api/admin/live/id/host/unknown'])assert.equal(hostJsonLimit(json,path),null);
  assert.equal(hostJsonLimit(new Request(url),'/api/live/id/host/viewers'),null);
  assert.equal(hostJsonLimit(new Request(url,{method:'POST',headers:{'Content-Type':'video/mp4'}}),'/api/admin/live/id/host/offer'),null);
});
test('over-limit Content-Length is refused without reading the stream',async()=>{
  const f=streamed([new Uint8Array(10)],{'Content-Length':String(HOST_COMMAND_BYTES+1)});
  await assert.rejects(readHostJson(f.request,HOST_COMMAND_BYTES),HostBodyTooLarge);
  assert.equal(f.reads(),0);assert.equal(f.canceled(),true);
});
test('chunked or dishonest lengths cannot bypass the bound; unread remainder is canceled',async()=>{
  for(const headers of [{},{'Content-Length':'1'}]){
    const f=streamed([new Uint8Array(HOST_COMMAND_BYTES),new Uint8Array(1),new Uint8Array(100)],headers);
    await assert.rejects(readHostJson(f.request,HOST_COMMAND_BYTES),HostBodyTooLarge);
    assert.equal(f.reads(),2);assert.equal(f.canceled(),true);
  }
});
test('exact boundary preserves every byte including SDP CRLF and Unicode split across chunks',async()=>{
  const payload=new TextEncoder().encode(JSON.stringify({sdp:'v=0\r\n'+'\u0000'.repeat(99995),offerId:'x'.repeat(80),clientId:'y'.repeat(80),viewerId:'z'.repeat(80)}));
  assert.ok(payload.length<=HOST_SDP_BYTES);
  const f=streamed([payload.subarray(0,123),payload.subarray(123)]);
  assert.deepEqual(await readHostJson(f.request,HOST_SDP_BYTES),payload);
  const edge=new Uint8Array(HOST_COMMAND_BYTES);edge.fill(199);
  assert.deepEqual(await readHostJson(streamed([edge]).request,HOST_COMMAND_BYTES),edge);
});
test('a single oversized chunk is canceled instead of being collected, and empty bodies stay empty',async()=>{
  const f=streamed([new Uint8Array(HOST_COMMAND_BYTES+1)]);
  await assert.rejects(readHostJson(f.request,HOST_COMMAND_BYTES),HostBodyTooLarge);assert.equal(f.canceled(),true);
  assert.deepEqual(await readHostJson(new Request(url,{method:'POST'}),HOST_COMMAND_BYTES),new Uint8Array());
});
