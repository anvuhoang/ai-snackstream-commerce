import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
test("audio render quantum chooses one input; host and reply are never summed",async()=>{
  let Processor;
  const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:()=>{}};}},
    currentTime:0,sampleRate:48000,registerProcessor:(_name,ctor)=>Processor=ctor};
  vm.runInNewContext(await readFile(new URL("../public/live/simli-output-worklet.js",import.meta.url),"utf8"),context);
  const processor=new Processor(),host=new Float32Array(128).fill(0.25),reply=new Float32Array(128).fill(0.75);
  const out=[new Float32Array(128),new Float32Array(128)];
  for(const [owner,expected] of [["none",0],["host",0.25],["reply",0.75],["none",0]]) {
    processor.port.onmessage({data:{kind:"select",owner,id:1}});
    processor.process([[host],[reply]],[out]);
    assert.ok(out.every(channel=>channel.every(value=>value===expected)));
  }
});
